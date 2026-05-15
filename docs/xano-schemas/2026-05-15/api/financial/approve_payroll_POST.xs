// Lock a payroll period as approved. Snapshots commission_amount into
// tech_payroll_lines so subsequent rate changes don't retroactively
// alter paid-out commissions. Refuses to approve if any line in the
// period is disputed AND unresolved (business rule §8.1).
//
// Caller: financial-dashboard.html "Approve payroll" button.
//
// See docs/financial-system-design-2026-05-15.md §7.6
query approve_payroll verb=POST {
  api_group = "financial"
  auth      = true   // PIN-gated; owner-only

  input {
    int period_id
    int? approved_by?   // technician id (== owner)
    text? notes?
  }

  stack {
    // Load period.
    db.get tech_payroll_periods {
      field_name  = "id"
      field_value = $input.period_id
    } as $period

    precondition ($period != null) {
      error_type = "notfound"
      error      = "Period not found"
    }

    precondition ($period.status != "approved") {
      error_type = "preconditionerror"
      error      = "Period already approved on " ~ ($period.approved_at|format_date:"Y-m-d H:i")
    }

    // Block approval if there are unresolved disputes inside the window.
    db.query warranty_payment_lines {
      where  = "created_at >= ? AND created_at <= ? AND match_status = 'disputed' AND (resolution_status IS NULL OR resolution_status = 'unresolved')"
      params = [$period.period_start, $period.period_end]
    } as $disputed

    precondition (($disputed|length) == 0) {
      error_type = "preconditionerror"
      error      = "Cannot approve — " ~ ($disputed|length) ~ " unresolved disputed lines must be resolved first"
    }

    // Snapshot every matched payment line in the window into
    // tech_payroll_lines. Idempotency: if a payroll_line already exists
    // for (period_id, warranty_payment_line_id) skip — re-approval call
    // is safe.
    db.query warranty_payment_lines {
      where  = "created_at >= ? AND created_at <= ? AND (match_status = 'matched' OR resolution_status = 'accept_partial') AND tech_id IS NOT NULL"
      params = [$period.period_start, $period.period_end]
    } as $period_lines

    var $tot_labor      { value = 0 }
    var $tot_parts      { value = 0 }
    var $tot_commission { value = 0 }
    var $tot_tax        { value = 0 }
    var $snapshots      { value = 0 }

    foreach ($period_lines) {
      each as $pl {
        // Skip if already snapshotted for this period.
        db.query tech_payroll_lines {
          where  = "period_id = ? AND warranty_payment_line_id = ?"
          params = [$period.id, $pl.id]
          limit  = 1
        } as $existing_rows

        var $existing { value = ($existing_rows|first ?? null) }

        conditional {
          if ($existing == null) {
            // Need vendor company for the warranty_company label.
            var $company { value = "" }
            conditional {
              if ($pl.batch_id != null) {
                db.get warranty_payment_batches {
                  field_name  = "id"
                  field_value = $pl.batch_id
                } as $batch

                conditional {
                  if ($batch != null && $batch.vendor_account_id != null) {
                    db.get warranty_vendor_accounts {
                      field_name  = "id"
                      field_value = $batch.vendor_account_id
                    } as $vend
                    var $company { value = ($vend.company ?? "") }
                  }
                }
              }
            }

            db.add tech_payroll_lines {
              fields = {
                period_id                : $period.id
                tech_id                  : $pl.tech_id
                job_id                   : $pl.job_id
                warranty_payment_line_id : $pl.id
                claim_number             : ($pl.claim_number ?? $pl.dispatch_id)
                warranty_company         : $company
                labor_paid               : ($pl.labor_amount ?? 0)
                commission_rate          : ($pl.commission_rate ?? 0)
                commission_amount        : ($pl.commission_amount ?? 0)
                parts_paid               : ($pl.parts_amount ?? 0)
                tax_collected            : ($pl.tax_amount ?? 0)
                tax_rate                 : ($pl.tax_rate ?? 0)
              }
            }

            var $snapshots { value = ($snapshots + 1) }
          }
        }

        var $tot_labor      { value = ($tot_labor + ($pl.labor_amount ?? 0)) }
        var $tot_parts      { value = ($tot_parts + ($pl.parts_amount ?? 0)) }
        var $tot_commission { value = ($tot_commission + ($pl.commission_amount ?? 0)) }
        var $tot_tax        { value = ($tot_tax + ($pl.tax_amount ?? 0)) }
      }
    }

    // Lock the period.
    db.edit tech_payroll_periods {
      field_name  = "id"
      field_value = $period.id
      fields = {
        status                : "approved"
        approved_by           : $input.approved_by
        approved_at           : now
        total_labor_paid      : $tot_labor
        total_parts_paid      : $tot_parts
        total_commission_owed : $tot_commission
        total_tax_collected   : $tot_tax
        notes                 : ($input.notes ?? null)
      }
    }

    // SMS owner with final summary.
    var $body {
      value = "Payroll approved for period ending %s — $%.2f total commission, %d lines locked."
        |sprintf:($period.period_end|format_date:"Y-m-d"):$tot_commission:$snapshots
    }

    api.request {
      url    = $env.SEND_SMS_URL ~ "/send_sms"
      method = "POST"
      params = {
        to      : $env.OWNER_PHONE
        body    : $body
        purpose : "financial.payroll.approved"
      }
      headers = []
        |push:"Content-Type: application/json"
    } as $sms_resp

    return {
      value = {
        ok                    : true
        period_id             : $period.id
        snapshots_created     : $snapshots
        total_labor           : $tot_labor
        total_commission_owed : $tot_commission
        total_tax_collected   : $tot_tax
      }
    }
  }
}

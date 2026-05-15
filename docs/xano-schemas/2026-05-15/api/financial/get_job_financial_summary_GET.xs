// Full financial picture for a single job — used by the dashboard's
// job-drill modal. Returns the job_financial row plus the linked
// warranty_payment_line and the tech_payroll_line snapshot (if
// payroll has been approved).
//
// See docs/financial-system-design-2026-05-15.md §7.9
query get_job_financial_summary verb=GET {
  api_group = "financial"

  input {
    int job_id
  }

  stack {
    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    db.query job_financial {
      where  = "job_id = ?"
      params = [$input.job_id]
      limit  = 1
    } as $jf_rows

    var $jf { value = ($jf_rows|first ?? null) }

    var $payment_line { value = null }
    var $vendor       { value = null }
    var $payroll_line { value = null }

    conditional {
      if ($jf != null && $jf.warranty_payment_line_id != null) {
        db.get warranty_payment_lines {
          field_name  = "id"
          field_value = $jf.warranty_payment_line_id
        } as $payment_line

        conditional {
          if ($jf.warranty_vendor_account_id != null) {
            db.get warranty_vendor_accounts {
              field_name  = "id"
              field_value = $jf.warranty_vendor_account_id
            } as $vendor
          }
        }

        db.query tech_payroll_lines {
          where  = "warranty_payment_line_id = ?"
          params = [$jf.warranty_payment_line_id]
          limit  = 1
        } as $tpl_rows

        var $payroll_line { value = ($tpl_rows|first ?? null) }
      }
    }

    var $tech { value = null }
    conditional {
      if ($job.technician_id != null) {
        db.get technicians {
          field_name  = "id"
          field_value = $job.technician_id
        } as $tech
      }
    }

    return {
      value = {
        job_id              : $job.id
        external_claim_number: ($job.external_claim_number ?? null)
        warranty_company    : ($job.warranty_company ?? null)
        customer_id         : $job.customer_id
        tech: (
          ($tech != null)
            ? { id: $tech.id, name: ($tech.first_name ~ " " ~ ($tech.last_name ?? "")), commission_rate: ($tech.commission_rate ?? 0) }
            : null
        )
        financial: $jf
        payment_line: $payment_line
        vendor: $vendor
        payroll_line: $payroll_line
      }
    }
  }
}

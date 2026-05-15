// Resolve a disputed warranty_payment_line.
//
// Three resolution modes:
//   'accept_partial' — owner accepts the net_amount as the new "matched"
//                      reality. Commission recomputes on net (using the
//                      original commission_rate snapshot). match_status
//                      moves to 'matched'.
//   'rebill'         — owner intends to invoice the warranty company
//                      for the shortfall. Commission stays at 0; line
//                      stays match_status='disputed' for audit. A
//                      future warranty_payment_line will true-up.
//   'write_off'     —  owner accepts loss. Commission stays at 0;
//                      match_status moves to 'matched' for accounting.
//
// Caller: financial-dashboard.html disputed-jobs modal.
//
// See docs/financial-system-design-2026-05-15.md §7.7
query resolve_dispute verb=POST {
  api_group = "financial"
  auth      = true

  input {
    int payment_line_id
    text resolution           // 'accept_partial' | 'rebill' | 'write_off'
    text? notes?
    int? resolved_by?
  }

  stack {
    db.get warranty_payment_lines {
      field_name  = "id"
      field_value = $input.payment_line_id
    } as $line

    precondition ($line != null) {
      error_type = "notfound"
      error      = "payment_line not found"
    }

    precondition ($line.match_status == "disputed") {
      error_type = "preconditionerror"
      error      = "Line is not in disputed state (current: " ~ $line.match_status ~ ")"
    }

    precondition (
      $input.resolution == "accept_partial"
      || $input.resolution == "rebill"
      || $input.resolution == "write_off"
    ) {
      error_type = "inputerror"
      error      = "Invalid resolution — must be accept_partial | rebill | write_off"
    }

    // Compute new commission based on resolution.
    var $new_commission { value = $line.commission_amount }
    var $new_status     { value = $line.match_status }

    conditional {
      if ($input.resolution == "accept_partial") {
        var $new_commission { value = (($line.net_amount * $line.commission_rate) / 100) }
        var $new_status     { value = "matched" }
      } else if ($input.resolution == "write_off") {
        var $new_commission { value = 0 }
        var $new_status     { value = "matched" }
      }
      // rebill: keep match_status=disputed; commission stays 0
    }

    db.edit warranty_payment_lines {
      field_name  = "id"
      field_value = $line.id
      fields = {
        resolution_status: $input.resolution
        resolved_at      : now
        resolved_by      : $input.resolved_by
        dispute_notes    : ($input.notes ?? $line.dispute_notes)
        commission_amount: $new_commission
        match_status     : $new_status
      }
    }

    // Sync downstream: job_financial commission snapshot + batch counts.
    conditional {
      if ($line.job_id != null) {
        db.query job_financial {
          where  = "job_id = ?"
          params = [$line.job_id]
          limit  = 1
        } as $jf_rows

        var $jf { value = ($jf_rows|first ?? null) }

        conditional {
          if ($jf != null) {
            db.edit job_financial {
              field_name  = "id"
              field_value = $jf.id
              fields = {
                tech_commission_amount: $new_commission
                payment_status        : (($new_status == "matched") ? "paid" : "disputed")
              }
            }
          }
        }
      }
    }

    // Decrement batch.disputed_count, increment matched_count when resolved.
    conditional {
      if ($new_status == "matched" && $line.batch_id != null) {
        db.get warranty_payment_batches {
          field_name  = "id"
          field_value = $line.batch_id
        } as $batch

        conditional {
          if ($batch != null) {
            db.edit warranty_payment_batches {
              field_name  = "id"
              field_value = $batch.id
              fields = {
                disputed_count: (($batch.disputed_count ?? 1) - 1)
                matched_count : (($batch.matched_count  ?? 0) + 1)
              }
            }
          }
        }
      }
    }

    // SMS the owner with the resolution summary.
    var $body {
      value = "Dispute resolved: line %d %s. New commission: $%.2f."
        |sprintf:$line.id:$input.resolution:$new_commission
    }

    api.request {
      url    = $env.SEND_SMS_URL ~ "/send_sms"
      method = "POST"
      params = {
        to      : $env.OWNER_PHONE
        body    : $body
        purpose : "financial.dispute.resolved"
      }
      headers = []
        |push:"Content-Type: application/json"
    } as $sms_resp

    return {
      value = {
        ok               : true
        payment_line_id  : $line.id
        new_commission   : $new_commission
        new_match_status : $new_status
        resolution       : $input.resolution
      }
    }
  }
}

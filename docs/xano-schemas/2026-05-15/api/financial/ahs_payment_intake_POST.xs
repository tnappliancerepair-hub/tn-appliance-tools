// AHS / Frontdoor remittance intake. Same shape as
// squaretrade_payment_intake but matches jobs on dispatch_id rather
// than claim_number. Vendor lookup uses company='ahs'.
//
// Expects payload_json from _lib/parsers/ahs-payment.js with the same
// header/lines shape, where each line carries dispatch_id (and
// optionally invoice_number / claim_number).
//
// See docs/financial-system-design-2026-05-15.md §7.2
query ahs_payment_intake verb=POST {
  api_group = "financial"

  input {
    text payload_json
    text? gmail_message_id?
    text? gmail_thread_id?
    text? sender?
    text? subject?
  }

  stack {
    var $payload { value = $input.payload_json|json_decode }
    var $header  { value = ($payload.header ?? {}) }
    var $lines   { value = ($payload.lines  ?? []) }

    // Idempotency
    conditional {
      if ($input.gmail_message_id != null && $input.gmail_message_id != "") {
        db.get warranty_payment_batches {
          field_name  = "gmail_message_id"
          field_value = $input.gmail_message_id
        } as $existing

        conditional {
          if ($existing != null) {
            return {
              value = { ok: true, duplicate: true, batch_id: $existing.id }
            }
          }
        }
      }
    }

    // Vendor lookup with auto-create-inactive fallback.
    var $vendor_number { value = (($header.vendor_number ?? "")|trim) }

    db.query warranty_vendor_accounts {
      where  = "company = ? AND vendor_number = ?"
      params = ["ahs", $vendor_number]
      limit  = 1
    } as $vendor_rows

    var $vendor_account { value = ($vendor_rows|first ?? null) }

    conditional {
      if ($vendor_account == null) {
        db.add warranty_vendor_accounts {
          fields = {
            company         : "ahs"
            vendor_number   : $vendor_number
            state           : ""
            area_description: "auto-created on first payment — owner to review"
            active          : false
            notes           : "Created by ahs_payment_intake"
          }
        } as $new_vendor
        var $vendor_account { value = $new_vendor }
      }
    }

    // Batch row
    db.add warranty_payment_batches {
      fields = {
        vendor_account_id: $vendor_account.id
        payment_date     : now
        period_ending    : ($header.period_ending ?? null)
        eft_reference    : ($header.eft_reference ?? null)
        advice_number    : ($header.advice_number ?? null)
        total_amount     : ($header.total_amount ?? 0)
        gmail_message_id : $input.gmail_message_id
        gmail_thread_id  : $input.gmail_thread_id
        status           : "parsed"
        parsed_at        : now
        raw_text         : ($payload.raw_text ?? null)
      }
    } as $batch

    var $matched   { value = 0 }
    var $unmatched { value = 0 }
    var $disputed  { value = 0 }
    var $is_tn     { value = ($vendor_account.state == "TN") }
    var $tn_rate   { value = 9.25 }

    foreach ($lines) {
      each as $line {
        var $dispatch_id { value = (($line.dispatch_id ?? "")|trim) }
        var $labor       { value = ($line.labor_amount ?? 0) }
        var $parts       { value = ($line.parts_amount ?? 0) }
        var $other       { value = ($line.other_amount ?? 0) }
        var $net         { value = ($line.total_amount ?? ($line.net_amount ?? 0)) }
        var $gross       { value = (($line.gross_amount ?? null) ?? $net) }

        // Match on dispatch_id (AHS-specific).
        db.query jobs {
          where  = "external_dispatch_id = ?"
          params = [$dispatch_id]
          limit  = 1
        } as $job_rows

        var $job { value = ($job_rows|first ?? null) }

        var $tech_id         { value = null }
        var $commission_rate { value = 0 }
        var $commission_amt  { value = 0 }
        var $match_status    { value = "unmatched" }
        var $dispute_amt     { value = 0 }
        var $tax_amt         { value = 0 }
        var $tax_rate        { value = 0 }

        conditional {
          if ($job != null) {
            var $tech_id { value = $job.technician_id }

            conditional {
              if ($tech_id != null) {
                db.get technicians {
                  field_name  = "id"
                  field_value = $tech_id
                } as $tech
                var $commission_rate { value = (($tech.commission_rate ?? 0) ?? 0) }
              }
            }

            conditional {
              if ($gross != $net && $gross > 0) {
                var $match_status   { value = "disputed" }
                var $dispute_amt    { value = ($gross - $net) }
              } else {
                var $match_status   { value = "matched" }
                var $commission_amt { value = (($labor * $commission_rate) / 100) }
              }
            }

            conditional {
              if ($is_tn == true) {
                var $tax_amt  { value = (($parts * $tn_rate) / 100) }
                var $tax_rate { value = $tn_rate }
              }
            }
          }
        }

        db.add warranty_payment_lines {
          fields = {
            batch_id         : $batch.id
            dispatch_id      : $dispatch_id
            claim_number     : ($line.claim_number ?? null)
            invoice_number   : ($line.invoice_number ?? null)
            customer_name    : ($line.customer_name ?? null)
            address          : ($line.address ?? null)
            model_number     : ($line.model_number ?? null)
            labor_amount     : $labor
            parts_amount     : $parts
            other_amount     : $other
            gross_amount     : $gross
            net_amount       : $net
            total_amount     : $net
            job_id           : (($job != null) ? $job.id : null)
            tech_id          : $tech_id
            match_status     : $match_status
            dispute_amount   : $dispute_amt
            commission_rate  : $commission_rate
            commission_amount: $commission_amt
            tax_amount       : $tax_amt
            tax_rate         : $tax_rate
            raw_line         : ($line.raw_line ?? null)
          }
        } as $new_line

        conditional {
          if ($job != null) {
            db.query job_financial {
              where  = "job_id = ?"
              params = [$job.id]
              limit  = 1
            } as $jf_rows

            var $jf { value = ($jf_rows|first ?? null) }

            conditional {
              if ($jf != null) {
                db.edit job_financial {
                  field_name  = "id"
                  field_value = $jf.id
                  fields = {
                    warranty_payment_line_id   : $new_line.id
                    warranty_vendor_account_id : $vendor_account.id
                    payment_status             : (($match_status == "disputed") ? "disputed" : "paid")
                    paid_date                  : now
                    eft_reference              : ($header.eft_reference ?? null)
                    tech_commission_amount     : $commission_amt
                    tax_collected              : $tax_amt
                    tax_rate                   : $tax_rate
                    warranty_payout_received   : $net
                  }
                }
              }
            }
          }
        }

        conditional {
          if ($match_status == "matched") {
            var $matched { value = ($matched + 1) }
          } else if ($match_status == "disputed") {
            var $disputed { value = ($disputed + 1) }
          } else {
            var $unmatched { value = ($unmatched + 1) }
          }
        }
      }
    }

    db.edit warranty_payment_batches {
      field_name  = "id"
      field_value = $batch.id
      fields = {
        matched_count  : $matched
        unmatched_count: $unmatched
        disputed_count : $disputed
      }
    }

    var $sms_body {
      value = "AHS payment parsed: $%.2f total, %d matched, %d unmatched, %d disputed"
        |sprintf:($header.total_amount ?? 0):$matched:$unmatched:$disputed
    }

    api.request {
      url    = $env.SEND_SMS_URL ~ "/send_sms"
      method = "POST"
      params = {
        to      : $env.OWNER_PHONE
        body    : $sms_body
        purpose : "financial.payment.parsed"
      }
      headers = []
        |push:"Content-Type: application/json"
    } as $sms_resp

    return {
      value = {
        ok              : true
        batch_id        : $batch.id
        total           : ($header.total_amount ?? 0)
        matched_count   : $matched
        unmatched_count : $unmatched
        disputed_count  : $disputed
      }
    }
  }
}

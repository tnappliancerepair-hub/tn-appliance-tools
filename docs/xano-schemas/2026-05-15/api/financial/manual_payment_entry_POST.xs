// Manual payment entry — for 210 paper checks and any other
// payment source that doesn't have a Gmail intake path.
//
// Input is a JSON-stringified shape identical to the email parsers
// produce, except gmail_message_id is omitted (no idempotency anchor —
// the dashboard form is responsible for preventing double-entry by
// checking the (vendor, check_number) tuple before submitting).
//
// Caller: financial-dashboard.html via the manual entry form.
//
// See docs/financial-system-design-2026-05-15.md §7.4
query manual_payment_entry verb=POST {
  api_group = "financial"
  auth      = true   // PIN-gated; owner-only

  input {
    text company              // '210' usually, but accepts any
    text? vendor_number?
    text? check_number?
    timestamp payment_date
    text payload_json         // { lines: [{claim_number, customer_name, labor_amount, parts_amount, total_amount}] }
    text? notes?
  }

  stack {
    var $payload { value = $input.payload_json|json_decode }
    var $lines   { value = ($payload.lines ?? []) }

    // Locate (or create) the vendor account.
    var $vendor_lookup { value = (($input.vendor_number ?? "")|trim) }

    conditional {
      if ($vendor_lookup != "") {
        db.query warranty_vendor_accounts {
          where  = "company = ? AND vendor_number = ?"
          params = [$input.company, $vendor_lookup]
          limit  = 1
        } as $vendor_rows
      } else {
        db.query warranty_vendor_accounts {
          where  = "company = ?"
          params = [$input.company]
          limit  = 1
        } as $vendor_rows
      }
    }

    var $vendor_account { value = ($vendor_rows|first ?? null) }

    conditional {
      if ($vendor_account == null) {
        db.add warranty_vendor_accounts {
          fields = {
            company         : $input.company
            vendor_number   : (($vendor_lookup != "") ? $vendor_lookup : ("AUTO-" ~ $input.company))
            state           : ""
            area_description: "auto-created from manual entry"
            active          : false
          }
        } as $new_vendor
        var $vendor_account { value = $new_vendor }
      }
    }

    // Sum line totals for the batch header.
    var $total { value = 0 }
    foreach ($lines) {
      each as $l {
        var $total { value = ($total + ($l.total_amount ?? 0)) }
      }
    }

    db.add warranty_payment_batches {
      fields = {
        vendor_account_id: $vendor_account.id
        payment_date     : $input.payment_date
        eft_reference    : ($input.check_number ?? null)
        total_amount     : $total
        status           : "parsed"
        parsed_at        : now
        raw_text         : ($input.notes ?? null)
      }
    } as $batch

    var $matched   { value = 0 }
    var $unmatched { value = 0 }
    var $disputed  { value = 0 }
    var $is_tn     { value = ($vendor_account.state == "TN") }
    var $tn_rate   { value = 9.25 }

    foreach ($lines) {
      each as $line {
        var $claim   { value = (($line.claim_number ?? "")|trim) }
        var $labor   { value = ($line.labor_amount ?? 0) }
        var $parts   { value = ($line.parts_amount ?? 0) }
        var $net     { value = ($line.total_amount ?? 0) }
        var $gross   { value = (($line.gross_amount ?? null) ?? $net) }

        db.query jobs {
          where  = "external_claim_number = ?"
          params = [$claim]
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
            claim_number     : $claim
            customer_name    : ($line.customer_name ?? null)
            labor_amount     : $labor
            parts_amount     : $parts
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
                    eft_reference              : ($input.check_number ?? null)
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

    return {
      value = {
        ok              : true
        batch_id        : $batch.id
        total           : $total
        matched_count   : $matched
        unmatched_count : $unmatched
        disputed_count  : $disputed
      }
    }
  }
}

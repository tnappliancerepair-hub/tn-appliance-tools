// SquareTrade / ServicePower remittance intake.
//
// Idempotent on gmail_message_id. Accepts a JSON-stringified
// parsed-payment payload from the extended servicepower-gmail-poller
// (shape produced by _lib/parsers/servicepower-payment.js):
//
//   {
//     header: {
//       vendor_number, eft_reference, advice_number,
//       period_ending,            // ISO date string
//       total_amount              // number
//     },
//     lines: [
//       { claim_number, customer_name, model_number,
//         labor_amount, parts_amount, other_amount, total_amount },
//       ...
//     ]
//   }
//
// Flow:
//   1. Idempotency check on gmail_message_id
//   2. Vendor lookup (auto-create with active=false if unknown)
//   3. Insert warranty_payment_batches row
//   4. Foreach line → insert warranty_payment_lines + try match to jobs
//   5. On match: calc commission (tech.commission_rate * labor / 100)
//                calc tax (parts * 0.0925 for TN, leave 0 + flag for LA)
//                update job_financial with payment linkage
//   6. Update batch counts (matched / unmatched / disputed)
//   7. SMS owner with summary
//
// See docs/financial-system-design-2026-05-15.md §7.1
query squaretrade_payment_intake verb=POST {
  api_group = "financial"

  input {
    text payload_json
    text? gmail_message_id?
    text? gmail_thread_id?
    text? sender?
    text? subject?
  }

  stack {
    // ── Decode payload ────────────────────────────────────────────────
    var $payload {
      value = $input.payload_json|json_decode
    }
    var $header { value = ($payload.header ?? {}) }
    var $lines  { value = ($payload.lines  ?? []) }

    // ── Idempotency: existing batch with same gmail_message_id? ──────
    conditional {
      if ($input.gmail_message_id != null && $input.gmail_message_id != "") {
        db.get warranty_payment_batches {
          field_name = "gmail_message_id"
          field_value = $input.gmail_message_id
        } as $existing_batch

        conditional {
          if ($existing_batch != null) {
            return {
              value = {
                ok       : true
                duplicate: true
                batch_id : $existing_batch.id
                message  : "gmail_message_id already processed"
              }
            }
          }
        }
      }
    }

    // ── Vendor account lookup (auto-create with active=false on miss) ─
    var $vendor_number { value = (($header.vendor_number ?? "")|trim) }

    db.query warranty_vendor_accounts {
      where  = "company = ? AND vendor_number = ?"
      params = ["squaretrade_servicepower", $vendor_number]
      limit  = 1
    } as $vendor_rows

    var $vendor_account { value = ($vendor_rows|first ?? null) }

    conditional {
      if ($vendor_account == null) {
        db.add warranty_vendor_accounts {
          fields = {
            company         : "squaretrade_servicepower"
            vendor_number   : $vendor_number
            state           : ""
            area_description: "auto-created on first payment — owner to review"
            active          : false
            notes           : "Created by squaretrade_payment_intake"
          }
        } as $new_vendor

        var $vendor_account { value = $new_vendor }
      }
    }

    // ── Create the batch row ──────────────────────────────────────────
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
        unmatched_count  : 0
        matched_count    : 0
        disputed_count   : 0
        raw_text         : ($payload.raw_text ?? null)
      }
    } as $batch

    // ── Per-line: insert + match + commission + tax ───────────────────
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
        var $other   { value = ($line.other_amount ?? 0) }
        var $net     { value = ($line.total_amount ?? 0) }
        var $gross   { value = (($line.gross_amount ?? null) ?? $net) }

        // Match the job by claim number against existing jobs.
        db.query jobs {
          where  = "external_claim_number = ?"
          params = [$claim]
          limit  = 1
        } as $job_rows

        var $job { value = ($job_rows|first ?? null) }

        // Resolve tech + commission rate from the matched job.
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

            // Dispute detection — gross != net.
            conditional {
              if ($gross != $net && $gross > 0) {
                var $match_status { value = "disputed" }
                var $dispute_amt  { value = ($gross - $net) }
                var $commission_amt { value = 0 }
              } else {
                var $match_status { value = "matched" }
                var $commission_amt { value = (($labor * $commission_rate) / 100) }
              }
            }

            // Tax — TN only auto-calcs; LA flagged for manual entry.
            conditional {
              if ($is_tn == true) {
                var $tax_amt  { value = (($parts * $tn_rate) / 100) }
                var $tax_rate { value = $tn_rate }
              }
            }
          }
        }

        // Insert the payment line row.
        db.add warranty_payment_lines {
          fields = {
            batch_id         : $batch.id
            claim_number     : $claim
            customer_name    : ($line.customer_name ?? null)
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

        // Update job_financial when matched.
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

        // Tally batch counts.
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

    // ── Update the batch with final counts ────────────────────────────
    db.edit warranty_payment_batches {
      field_name  = "id"
      field_value = $batch.id
      fields = {
        matched_count  : $matched
        unmatched_count: $unmatched
        disputed_count : $disputed
      }
    }

    // ── SMS the owner ─────────────────────────────────────────────────
    var $sms_body {
      value = "SquareTrade payment parsed: $%.2f total, %d matched, %d unmatched, %d disputed"
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

    // ── Response ──────────────────────────────────────────────────────
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

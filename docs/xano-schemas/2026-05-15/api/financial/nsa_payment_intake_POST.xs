// NSA remittance intake — flexible-format edition.
//
// NSA's exact email format is unknown at build time. The parser
// (_lib/parsers/nsa-payment.js) does its best to extract claim_number
// and amount per line, returning format_confidence in the header.
//
// When confidence is below 0.6, this endpoint creates the batch row
// with status='needs_review' and DOES NOT attempt job matching — the
// owner reviews from the dashboard. SMS alert fires immediately
// regardless of confidence, so the owner sees every NSA payment.
//
// See docs/financial-system-design-2026-05-15.md §7.3
query nsa_payment_intake verb=POST {
  api_group = "financial"

  input {
    text payload_json
    text? gmail_message_id?
    text? gmail_thread_id?
    text? sender?
    text? subject?
  }

  stack {
    var $payload    { value = $input.payload_json|json_decode }
    var $header     { value = ($payload.header ?? {}) }
    var $lines      { value = ($payload.lines  ?? []) }
    var $confidence { value = (($header.format_confidence ?? 0) ?? 0) }
    var $low_conf   { value = ($confidence < 0.6) }

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

    // Vendor lookup — NSA always uses the single NSA account.
    db.query warranty_vendor_accounts {
      where  = "company = ?"
      params = ["nsa"]
      limit  = 1
    } as $vendor_rows

    var $vendor_account { value = ($vendor_rows|first ?? null) }

    conditional {
      if ($vendor_account == null) {
        db.add warranty_vendor_accounts {
          fields = {
            company         : "nsa"
            vendor_number   : "AUTO-NSA-1"
            state           : ""
            area_description: "NSA primary — auto-created on first remittance"
            active          : false
            notes           : "Created by nsa_payment_intake"
          }
        } as $new_vendor
        var $vendor_account { value = $new_vendor }
      }
    }

    // Batch row — status depends on parser confidence.
    var $batch_status { value = ($low_conf ? "needs_review" : "parsed") }

    db.add warranty_payment_batches {
      fields = {
        vendor_account_id: $vendor_account.id
        payment_date     : now
        total_amount     : ($header.total_amount ?? 0)
        gmail_message_id : $input.gmail_message_id
        gmail_thread_id  : $input.gmail_thread_id
        status           : $batch_status
        parsed_at        : now
        raw_text         : ($payload.raw_text ?? null)
      }
    } as $batch

    var $matched   { value = 0 }
    var $unmatched { value = 0 }

    // Only attempt matching when confidence high enough.
    conditional {
      if ($low_conf == false) {
        foreach ($lines) {
          each as $line {
            var $claim { value = (($line.claim_number ?? "")|trim) }
            var $net   { value = ($line.total_amount ?? ($line.net_amount ?? 0)) }

            db.query jobs {
              where  = "external_claim_number = ?"
              params = [$claim]
              limit  = 1
            } as $job_rows

            var $job          { value = ($job_rows|first ?? null) }
            var $match_status { value = (($job != null) ? "matched" : "unmatched") }

            db.add warranty_payment_lines {
              fields = {
                batch_id     : $batch.id
                claim_number : $claim
                customer_name: ($line.customer_name ?? null)
                net_amount   : $net
                total_amount : $net
                job_id       : (($job != null) ? $job.id : null)
                match_status : $match_status
                raw_line     : ($line.raw_line ?? null)
              }
            }

            conditional {
              if ($job != null) {
                var $matched { value = ($matched + 1) }
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
          }
        }
      }
    }

    // SMS owner immediately — every NSA payment is novel.
    var $sms_body {
      value = (
        $low_conf
          ? "NSA payment detected — format needs review. Batch %d. $%.2f total."
          : "NSA payment parsed: $%.2f, %d matched, %d unmatched. Batch %d."
      )
    }

    var $sms_filled {
      value = (
        $low_conf
          ? ($sms_body|sprintf:$batch.id:($header.total_amount ?? 0))
          : ($sms_body|sprintf:($header.total_amount ?? 0):$matched:$unmatched:$batch.id)
      )
    }

    api.request {
      url    = $env.SEND_SMS_URL ~ "/send_sms"
      method = "POST"
      params = {
        to      : $env.OWNER_PHONE
        body    : $sms_filled
        purpose : "financial.payment.parsed"
      }
      headers = []
        |push:"Content-Type: application/json"
    } as $sms_resp

    return {
      value = {
        ok               : true
        batch_id         : $batch.id
        needs_review     : $low_conf
        format_confidence: $confidence
        matched_count    : $matched
        unmatched_count  : $unmatched
      }
    }
  }
}

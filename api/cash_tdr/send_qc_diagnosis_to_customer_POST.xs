//  Sends the customer-facing TDR view link via SMS after Teddy completes
//  pre-diagnosis in Teddy Tool. Mints a signed token via Netlify gateway,
//  composes the SMS, dispatches via send_sms (which now returns Twilio's
//  status per Phase 1c step 3b 2026-05-06), updates TDR/job state on
//  Twilio 201, logs detailed failure info on any other status.
// 
//  Locked policies (per design doc + step 3b spec):
//    - Idempotency: refuse second send unless force_resend=true (then mint
//      fresh token; old + new tokens both valid until expiry or Confirm-and-Pay)
//    - Mark sent_to_customer_at + transition job state ONLY on Twilio 201
//    - DO NOT update state on token_mint_failed or sms_failed
//    - All sends (success or failure) write to event_log for audit
//    - TDR.expires_at reflects the most recent token's expiry (cron-friendly)
// 
//  HARDCODED 2026-05-06: same Xano-env-access workaround as qc_diagnosis_view —
//  Netlify URLs in $env aren't being read by api.request. URL is stable.
query send_qc_diagnosis_to_customer verb=POST {
  api_group = "cash_tdr"

  input {
    int tdr_id
    int? technician_id?
    int? expiry_seconds?
    bool? force_resend?
  }

  stack {
    // 1. Load TDR
    db.get technician_decision_report {
      field_name = "id"
      field_value = $input.tdr_id
    } as $tdr
  
    conditional {
      if ($tdr == null) {
        return {
          value = {
            success: false
            reason : "tdr_not_found"
            error  : "TDR not found."
          }
        }
      }
    }
  
    // 2. customer_facing_diagnosis must be populated
    conditional {
      if ($tdr.customer_facing_diagnosis == null || $tdr.customer_facing_diagnosis == "") {
        return {
          value = {
            success: false
            reason : "missing_diagnosis"
            error  : "Compose the customer-facing diagnosis before sending."
          }
        }
      }
    }
  
    // 3. Idempotency check (refuse second click unless force_resend)
    conditional {
      if ($tdr.sent_to_customer_at != null && $input.force_resend != true) {
        return {
          value = {
            success: false
            reason : "already_sent"
            error  : "This TDR was already sent to the customer."
            sent_at: $tdr.sent_to_customer_at
          }
        }
      }
    }
  
    // 4. Load job (for bill_to resolution + sms_consent check)
    db.get jobs {
      field_name = "id"
      field_value = $tdr.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {
            success: false
            reason : "tdr_not_found"
            error  : "Job for this TDR not found."
          }
        }
      }
    }
  
    // 5. Resolve bill_to customer (per multi-party support locked 2026-05-05)
    //    bill_to_customer_id defaults to 0 on quick-check jobs (create_job_from_chat
    //    never sets it), and `0 ?? customer_id` keeps the 0 -> looks up customer #0 ->
    //    "Bill-to customer record not found". Only use bill_to when it's a real id (>0).
    var $bill_to_id {
      value = ((($job.bill_to_customer_id ?? 0) > 0) ? ($job.bill_to_customer_id) : ($job.customer_id))
    }
  
    db.get customer {
      field_name = "id"
      field_value = $bill_to_id
    } as $bill_to
  
    conditional {
      if ($bill_to == null) {
        return {
          value = {
            success: false
            reason : "no_phone"
            error  : "Bill-to customer record not found."
          }
        }
      }
    }
  
    // 6. Phone + consent checks (sms_consent lives on jobs, not customer)
    conditional {
      if ($bill_to.phone == null || $bill_to.phone == "") {
        return {
          value = {
            success: false
            reason : "no_phone"
            error  : "No phone number on file. Update the customer record first."
          }
        }
      }
    }
  
    conditional {
      if ($job.sms_consent != true) {
        return {
          value = {
            success       : false
            reason        : "no_consent"
            error         : "Customer has not consented to SMS. Call them at " ~ $bill_to.phone ~ " instead."
            customer_phone: $bill_to.phone
          }
        }
      }
    }
  
    // 7. Mint token via Netlify gateway
    api.request {
      url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/generate-qc-token"
      method = "POST"
      params = {
        job_id        : $tdr.job_id
        tdr_id        : $tdr.id
        expiry_seconds: ($input.expiry_seconds ?? 604800)
      }
    
      headers = [
        "Content-Type: application/json"
        "X-Internal-Auth: " ~ $env.HCP_INTERNAL_AUTH_SECRET
      ]
    
    } as $token_resp
  
    var $token {
      value = ($token_resp.response.result.token ?? null)
    }
  
    var $expires_at_str {
      value = ($token_resp.response.result.expires_at ?? null)
    }
  
    conditional {
      if ($token == null || $token == "") {
        db.add event_log {
          data = {
            action  : "qc_send_failed"
            metadata: {
            tdr_id        : $tdr.id
            job_id        : $tdr.job_id
            technician_id : $input.technician_id
            reason        : "token_mint_failed"
            netlify_status: $token_resp.response.status
            netlify_error : $token_resp.response.error
          }
          }
        } as $log_token_fail
      
        return {
          value = {
            success: false
            reason : "token_mint_failed"
            error  : "Could not generate link. Try again or contact engineering."
          }
        }
      }
    }
  
    // 8. Compose SMS body (locked copy per spec section 4)
    var $url {
      value = "https://tnapplianceexchange.net/cash-tdr-customer.html?token=" ~ $token
    }
  
    var $first_name {
      value = ($bill_to.first_name ?? "there")
    }
  
    // GSM-7, no emoji / em-dash (Teddy 2026-08-11 cost cut): a single emoji forces
    // the whole text into UCS-2 (70 chars/segment vs 160), and this text already
    // carries a long token URL. Plain-ASCII copy keeps it to ~2 segments, not 5.
    var $sms_body {
      value = "hi " ~ $first_name ~ ", your TN Appliance diagnosis and repair options are ready: " ~ $url
    }
  
    // 9. Send SMS (extended send_sms returns {success, twilio_sid, twilio_status, error})
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {to: $bill_to.phone, message: $sms_body, context_tag: "quick_check_diagnosis"}
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $sms_resp

    var $sms_result {
      value = ($sms_resp.response.result ?? ($sms_resp.response ?? {}))
    }
  
    // 10. SMS failure path: log + return without state changes
    conditional {
      if ($sms_result.success != true) {
        db.add event_log {
          data = {
            action  : "qc_send_failed"
            metadata: {
            tdr_id       : $tdr.id
            job_id       : $tdr.job_id
            technician_id: $input.technician_id
            reason       : "sms_failed"
            twilio_status: $sms_result.twilio_status
            twilio_error : $sms_result.error
            twilio_sid   : $sms_result.twilio_sid
            token_minted : true
            recipient    : $bill_to.phone
          }
          }
        } as $log_sms_fail
      
        return {
          value = {
            success      : false
            reason       : "sms_failed"
            error        : "Could not send. Twilio returned: " ~ ($sms_result.error ?? "unknown error")
            twilio_status: $sms_result.twilio_status
          }
        }
      }
    }
  
    // 11. Twilio 201 -> mark TDR sent, transition job state
    db.edit technician_decision_report {
      field_name = "id"
      field_value = $tdr.id
      data = {
        sent_to_customer_at: now
        public_view_token  : $token
        expires_at         : $expires_at_str
      }
    } as $tdr_updated
  
    db.edit jobs {
      field_name = "id"
      field_value = $tdr.job_id
      data = {qc_status: "diagnosis_sent", qc_diagnosis_sent_at: now}
    } as $job_updated
  
    // 12. Audit log success
    db.add event_log {
      data = {
        action  : "qc_diagnosis_sent_to_customer"
        metadata: {
        tdr_id             : $tdr.id
        job_id             : $tdr.job_id
        technician_id      : $input.technician_id
        bill_to_customer_id: $bill_to_id
        sent_to            : $bill_to.phone
        twilio_sid         : $sms_result.twilio_sid
        force_resend       : ($input.force_resend ?? false)
      }
      }
    } as $log_success
  }

  response = {
    success     : true
    sent_to     : $bill_to.phone
    sent_at     : now
    expires_at  : $expires_at_str
    twilio_sid  : $sms_result.twilio_sid
    customer_url: $url
  }

  guid = "yXByF3ibeuTBHPKgfr8PjnuoLj4"
}
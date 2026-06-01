//  Stripe checkout.session.completed webhook handler (Phase 1c step 3d.3
//  2026-05-06). Receives forwarded events from Netlify gateway after Stripe
//  signature verification. Updates TDR.confirmed_at + payment fields, posts
//  HCP note, SMS Danielle.
// 
//  Auth via shared-secret BODY field (not header) — XanoScript can't reliably
//  read arbitrary HTTP headers in text mode (documented in hcp-webhook-setup.md).
//  Netlify gateway injects _webhook_secret as a top-level body field. The
//  X-Webhook-Shared-Secret header is also sent by Netlify for future-compat
//  when Xano gains header-read support.
// 
//  Idempotency: Stripe occasionally re-delivers the same event. We detect via
//  TDR.confirmed_at — if already set, log a duplicate and return 200 OK.
query stripe_checkout_session_completed verb=POST {
  api_group = "cash_tdr"

  input {
    text? id?
    text? type?
    json? data?
    text? _webhook_secret?
  }

  stack {
    var $expected_secret {
      value = ($env.XANO_WEBHOOK_SHARED_SECRET ?? "")|trim
    }
  
    var $received_secret {
      value = ($input._webhook_secret ?? "")|trim
    }
  
    conditional {
      if ($expected_secret == "" || $received_secret != $expected_secret) {
        db.add event_log {
          data = {
            action  : "stripe_webhook_auth_failed"
            metadata: {
            note            : "shared secret mismatch on stripe webhook"
            has_secret_input: ($received_secret != "")
            event_id        : $input.id
          }
          }
        } as $auth_fail_log
      
        return {
          value = {ok: false, error: "unauthorized"}
        }
      }
    }
  
    conditional {
      if ($input.type != "checkout.session.completed") {
        return {
          value = {
            ok           : false
            error        : "unsupported event type"
            received_type: $input.type
          }
        }
      }
    }
  
    var $session_obj {
      value = ($input.data.object ?? {})
    }
  
    var $tdr_id_raw {
      value = ($session_obj.metadata.tdr_id ?? null)
    }
  
    var $tdr_id_int {
      value = ($tdr_id_raw == null ? 0 : ($tdr_id_raw|to_int))
    }
  
    conditional {
      if ($tdr_id_int <= 0) {
        db.add event_log {
          data = {
            action  : "stripe_webhook_missing_tdr_id"
            metadata: {
            event_id         : $input.id
            session_id       : ($session_obj.id ?? null)
            metadata_received: ($session_obj.metadata ?? null)
          }
          }
        } as $missing_log
      
        return {
          value = {ok: false, error: "tdr_id missing from event metadata"}
        }
      }
    }
  
    db.get technician_decision_report {
      field_name = "id"
      field_value = $tdr_id_int
    } as $tdr
  
    conditional {
      if ($tdr == null) {
        db.add event_log {
          data = {
            action  : "stripe_webhook_tdr_not_found"
            metadata: {
            tdr_id    : $tdr_id_int
            event_id  : $input.id
            session_id: ($session_obj.id ?? null)
          }
          }
        } as $nf_log
      
        return {
          value = {
            ok    : false
            error : "tdr_not_found"
            tdr_id: $tdr_id_int
          }
        }
      }
    }
  
    // Idempotency check: if TDR already has confirmed_at, this is a
    // duplicate Stripe delivery. Log and ack with 200 to stop retries.
    conditional {
      if ($tdr.confirmed_at != null) {
        db.add event_log {
          data = {
            action  : "stripe_webhook_duplicate"
            metadata: {
            tdr_id              : $tdr.id
            event_id            : $input.id
            session_id          : ($session_obj.id ?? null)
            already_confirmed_at: $tdr.confirmed_at
          }
          }
        } as $dup_log
      
        return {
          value = {ok: true, duplicate: true, tdr_id: $tdr.id}
        }
      }
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $tdr.job_id
    } as $job
  
    db.get customer {
      field_name = "id"
      field_value = ($job == null ? 0 : $job.customer_id)
    } as $customer
  
    var $amount_total {
      value = ($session_obj.amount_total ?? 0)
    }
  
    var $payment_intent_id {
      value = ($session_obj.payment_intent ?? "")
    }
  
    db.edit technician_decision_report {
      field_name = "id"
      field_value = $tdr.id
      data = {
        confirmed_at            : now
        stripe_payment_intent_id: $payment_intent_id
        stripe_amount_paid_cents: $amount_total
      }
    } as $tdr_updated
  
    // Post HCP job note (skip silently if no HCP id on the job).
    var $hcp_job_id {
      value = ($job == null ? "" : ($job.housecall_pro_job_id ?? ""))
    }
  
    var $amount_dollars {
      value = ($amount_total / 100)|to_text
    }
  
    var $hcp_note_body {
      value = "Customer paid via Stripe Checkout. Amount: $" ~ $amount_dollars ~ ". Session: " ~ ($session_obj.id ?? "?") ~ ". Payment ready to schedule repair appointment."
    }
  
    conditional {
      if ($hcp_job_id != "" && $hcp_job_id != null) {
        api.request {
          url = $env.HCP_BASE_URL ~ "/jobs/" ~ $hcp_job_id ~ "/notes"
          method = "POST"
          params = {content: $hcp_note_body}
          headers = [
            "Authorization: Token " ~ $env.HCP_API_KEY
            "Content-Type: application/json"
            "Accept: application/json"
          ]
        
          timeout = 30
        } as $hcp_resp
      }
    }
  
    conditional {
      if ($hcp_job_id == "" || $hcp_job_id == null) {
        db.add event_log {
          data = {
            action  : "stripe_webhook_hcp_skipped"
            metadata: {
            tdr_id: $tdr.id
            reason: "no housecall_pro_job_id on job"
          }
          }
        } as $hcp_skip_log
      }
    }
  
    // SMS Danielle
    var $cust_first {
      value = ($customer == null ? "Customer" : ($customer.first_name ?? "Customer"))
    }
  
    var $cust_last {
      value = ($customer == null ? "" : ($customer.last_name ?? ""))
    }
  
    var $job_id_str {
      value = ($job == null ? "?" : ($job.id|to_text))
    }
  
    var $tdr_id_str {
      value = $tdr.id|to_text
    }
  
    var $danielle_msg {
      value = "TDR " ~ $tdr_id_str ~ " paid: " ~ $cust_first ~ " " ~ $cust_last ~ " - $" ~ $amount_dollars ~ ". Job " ~ $job_id_str ~ " ready to schedule."
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {to: "+16154850713", message: $danielle_msg}
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $danielle_sms
  
    // Audit log success
    db.add event_log {
      data = {
        action  : "stripe_webhook_processed"
        metadata: {
        tdr_id           : $tdr.id
        job_id           : ($job == null ? null : $job.id)
        event_id         : $input.id
        session_id       : ($session_obj.id ?? null)
        payment_intent_id: $payment_intent_id
        amount_total     : $amount_total
      }
      }
    } as $success_log
  }

  response = {ok: true, tdr_id: $tdr.id, processed_at: now}
  guid = "fFOgKcs5xFonb-10Xo2maEYe9Q8"
}
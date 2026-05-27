// Inbound call recorder + signal emitter. Designed to be called from a
// Netlify function wired to Telnyx voice webhook (call.initiated) or
// from any frontend that captures inbound caller phone numbers.
//
// On call:
//   - Normalize caller phone, look up matching customer by phone
//     (exact-match in 3 formats: raw, 10-digit, +1 prefixed)
//   - Look up latest job for the customer
//   - Write inbound_call_received audit row
//   - Emit INBOUND_CALL signal so the loop can fan out to:
//       - office SMS with "📞 inbound from {name}, job #X, last visit Yd ago"
//       - future logging / analytics agents
query record_inbound_call verb=POST {
  api_group = "intake"

  input {
    text caller_phone
    text? source?
    text? telnyx_call_id?
  }

  stack {
    var $raw {
      value = ($input.caller_phone ?? "")|trim
    }

    precondition ($raw != "") {
      error_type = "inputerror"
      error      = "caller_phone is required"
    }

    var $digits {
      value = $raw|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":""|replace:".":""
    }

    var $digits_len {
      value = $digits|strlen
    }

    var $last10_start {
      value = ($digits_len - 10)
    }

    var $digits_last10 {
      value = ($digits_len >= 10 ? ($digits|substr:$last10_start) : $digits)
    }

    var $e164 {
      value = ("+1" ~ $digits_last10)
    }

    // Customer lookup (exact-match in 4 phone formats)
    db.query customer {
      where  = $db.customer.phone == $digits || $db.customer.phone == $digits_last10 || $db.customer.phone == $e164 || $db.customer.phone == $raw
      sort   = {customer.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $cust_rows

    var $customer {
      value = (($cust_rows.items|first) ?? null)
    }

    var $latest_job { value = null }

    conditional {
      if ($customer != null) {
        db.query jobs {
          where  = $db.jobs.customer_id == $customer.id
          sort   = {jobs.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $job_rows

        var.update $latest_job {
          value = (($job_rows.items|first) ?? null)
        }
      }
    }

    // Audit row
    var $audit_meta {
      value = {
        caller_phone   : $raw
        caller_e164    : $e164
        customer_id    : ($customer.id ?? 0)
        customer_first : ($customer.first_name ?? "")
        latest_job_id  : ($latest_job.id ?? 0)
        source         : ($input.source ?? "")
        telnyx_call_id : ($input.telnyx_call_id ?? "")
      }
    }

    var $audit_meta_json {
      value = $audit_meta|json_encode
    }

    db.add event_log {
      data = {
        action  : "inbound_call_received"
        metadata: $audit_meta_json
      }
    } as $audit_row

    // Signal emit
    var $signal_payload {
      value = {
        caller_phone   : $e164
        customer_id    : ($customer.id ?? 0)
        first_name     : ($customer.first_name ?? "")
        last_name      : ($customer.last_name ?? "")
        latest_job_id  : ($latest_job.id ?? 0)
        latest_job_status: ($latest_job.scheduling_status ?? "")
        latest_job_created_at: ($latest_job.created_at ?? 0)
        latest_job_appliance: ($latest_job.appliance_type ?? "")
        source         : ($input.source ?? "telnyx_voice")
        telnyx_call_id : ($input.telnyx_call_id ?? "")
      }
    }

    var $signal_payload_json {
      value = $signal_payload|json_encode
    }

    db.add colony_signals {
      data = {
        signal_type     : "INBOUND_CALL"
        signal_strength : 70
        source_colony   : "inbound_call_webhook"
        target_colonies : ""
        payload         : $signal_payload_json
      }
    } as $signal_row
  }

  response = {
    success        : true
    matched        : ($customer != null)
    customer_id    : ($customer.id ?? 0)
    latest_job_id  : ($latest_job.id ?? 0)
    signal_id      : ($signal_row.id ?? 0)
  }

  guid = "record-inbound-call-v1"
}

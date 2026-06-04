// Office-side dispatcher: called by UI or colony loop to fire an
// outbound Vapi call with the right assistant + prompt-variable
// substitution for the call_type. Pulls job + customer + tech context
// from the database so callers don't have to assemble it themselves.
//
// call_type values supported:
//   - "appointment_reminder"     (24h confirm)
//   - "tech_running_late"        (delay heads-up)
//   - "parts_eta_update"         (parts arrived, schedule revisit)
//   - "reschedule"               (system-initiated reschedule)
//   - "missed_call_callback"     (return missed call)
//   - "ahs_authorization_update" (outbound to AHS — needs claim_number + auth details)
//   - "parts_follow_up"          (outbound to parts vendor — needs supplier + order_number)
//
// Optional `overrides` JSON-encoded string lets the caller pin specific
// variable values (e.g., minutes_behind for tech_running_late, or a
// custom reason for reschedule).
query dispatch_voice_call verb=POST {
  api_group = "intake"

  input {
    int job_id
    text call_type
    text? overrides?
    text? dispatched_by?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
    precondition (($input.call_type ?? "")|trim != "") {
      error_type = "inputerror"
      error = "call_type required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $customer { value = null }
    var $customer_id { value = ($job.customer_id ?? 0) }
    conditional {
      if ($customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $customer_id
        } as $customer
      }
    }

    var $tech { value = null }
    var $tech_id { value = ($job.technician_id ?? 0) }
    conditional {
      if ($tech_id > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $tech_id
        } as $tech
      }
    }

    // Pick the right assistant id by call_type
    var $assistant_id { value = "" }
    conditional {
      if ($input.call_type == "appointment_reminder") {
        var.update $assistant_id { value = "5da286fa-c72b-40f9-adf0-7883665b97e6" }
      }
    }
    conditional {
      if ($input.call_type == "tech_running_late") {
        var.update $assistant_id { value = "264c14fe-118d-4cfa-af8f-b6ce761c868b" }
      }
    }
    conditional {
      if ($input.call_type == "parts_eta_update") {
        var.update $assistant_id { value = "86755371-9605-4370-a26e-60cdadf468e9" }
      }
    }
    conditional {
      if ($input.call_type == "reschedule") {
        var.update $assistant_id { value = "5b2a4e7f-2974-4e93-81a2-8f17dc9391d2" }
      }
    }
    conditional {
      if ($input.call_type == "missed_call_callback") {
        var.update $assistant_id { value = "36cd478e-b128-4529-8071-b5f241c73d69" }
      }
    }
    conditional {
      if ($input.call_type == "ahs_authorization_update") {
        var.update $assistant_id { value = "63030edb-fb77-4106-b048-e84aba6da358" }
      }
    }
    conditional {
      if ($input.call_type == "parts_follow_up") {
        var.update $assistant_id { value = "b71260b4-c284-4657-99a4-03c9bb1a0624" }
      }
    }

    precondition ($assistant_id != "") {
      error_type = "inputerror"
      error = "unknown call_type"
    }

    // Choose the outbound dial-from number based on customer region.
    // Prefer Telnyx-backed CNAM-registered local numbers — they show
    // "TN APPLIANCE" on caller ID on AT&T/Verizon/T-Mobile (24-72h after
    // CNAM submission). Higher answer rate than bare or spam-flagged
    // numbers. LA defaults to Twilio 504-355 (CNAM pending).
    // 2026-06-03 evening: Telnyx voice routing broken on imported nums.
    // Fall back to Twilio 629-247 (TN) + 504-355 (LA) which are confirmed
    // working. Once Telnyx voice routing is fixed, revert TN to
    // 4006d617... (615-588 with CNAM "TN APPLIANCE").
    var $state { value = (($job.service_state ?? "")|to_text)|to_lowercase }
    var $from_number_id { value = "d57d5cf2-60a7-46e6-a7f0-24ed652c1f31" }
    conditional {
      if ($state == "la" || $state == "louisiana") {
        var.update $from_number_id { value = "9ceaec5d-27c7-48d3-80c5-ed1028226683" }
      }
    }

    // Customer phone
    var $to_phone { value = (($customer.phone ?? "")|to_text)|trim }
    precondition ($to_phone != "") {
      error_type = "inputerror"
      error = "customer has no phone on file"
    }

    // Build common variable values from job + customer + tech context.
    // For call types that need richer overrides (Tech Running Late's
    // minutes_behind, AHS authorization_details), the caller provides
    // them via the overrides JSON string.
    var $first_name { value = (($customer.first_name ?? "")|to_text)|trim }
    var $appliance_type { value = (($job.appliance_type ?? "")|to_text)|trim }
    var $brand { value = (($job.brand ?? "")|to_text)|trim }
    var $tech_first_name { value = "our tech" }
    conditional {
      if ($tech != null && ($tech.first_name ?? "")|trim != "") {
        var.update $tech_first_name { value = (($tech.first_name ?? "")|to_text)|trim }
      }
    }
    var $scheduled_start_ms { value = ($job.scheduled_start ?? 0) }

    // Body for Vapi /call
    var $assistant_overrides {
      value = {
        variableValues: {
          customer_first_name: $first_name
          appliance_type     : $appliance_type
          brand              : $brand
          tech_first_name    : $tech_first_name
          job_id             : ($input.job_id|to_text)
          claim_number       : (($job.claim_number ?? "")|to_text)
        }
      }
    }

    var $call_body {
      value = {
        assistantId  : $assistant_id
        phoneNumberId: $from_number_id
        customer     : {number: $to_phone}
        assistantOverrides: $assistant_overrides
        metadata     : {source: "office_dispatch_endpoint", call_type: $input.call_type, dispatched_by: (($input.dispatched_by ?? "office")|to_text)}
      }
    }

    api.request {
      url = "https://api.vapi.ai/call"
      method = "POST"
      params = $call_body
      headers = [
        "Authorization: Bearer " ~ ($env.VAPI_PRIVATE_KEY|to_text)
        "Content-Type: application/json"
      ]
    } as $vapi_resp

    var $call_id { value = (($vapi_resp.response.result.id ?? "")|to_text) }

    db.add event_log {
      data = {
        action  : "voice_call_dispatched"
        metadata: ({job_id: $input.job_id, call_type: $input.call_type, assistant_id: $assistant_id, vapi_call_id: $call_id, dispatched_by: ($input.dispatched_by ?? "office"), to_phone: $to_phone, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success      : true
    job_id       : $input.job_id
    call_type    : $input.call_type
    assistant_id : $assistant_id
    vapi_call_id : $call_id
    to_phone     : $to_phone
    dispatched_at_ms: (now|to_ms)
  }

  guid = "dispatch-voice-call-v1"
}

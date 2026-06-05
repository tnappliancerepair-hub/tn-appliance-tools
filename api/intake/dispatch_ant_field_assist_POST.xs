// Office/tech-side dispatcher — places an outbound Vapi call from
// Ant Field Assist to the tech's cell. Tech taps the "🎤 Talk to Ant"
// button on tech-ant-chat and this fires.
//
// RESUME-AWARE: loads existing in-progress TDR draft for (job_id,
// tech_id) and passes captured fields to Brooke so she ACKs prior
// progress instead of re-asking. Fixes Jimmy's "had to repeat the
// report three times" complaint.
query dispatch_ant_field_assist verb=POST {
  api_group = "intake"

  input {
    int job_id
    int tech_id
    text? mode?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    precondition ($tech != null) {
      error_type = "notfound"
      error = "Tech not found"
    }

    var $tech_phone_raw {
      value = ($tech.phone ?? "")
    }
    precondition ($tech_phone_raw != "") {
      error_type = "inputerror"
      error = "Tech has no phone on file"
    }
    // Normalize to E.164. Vapi rejects bare 10-digit numbers.
    var $phone_starts_plus {
      value = (($tech_phone_raw|substr:0:1) == "+")
    }
    var $tech_phone {
      value = ($phone_starts_plus == true) ? $tech_phone_raw : ("+1" ~ $tech_phone_raw)
    }

    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer

    var $tech_first {
      value = ($tech.first_name ?? "brother")
    }
    var $cust_first {
      value = ($customer.first_name ?? "the customer")
    }
    var $appl_brand {
      value = ($job.appliance_brand ?? "")
    }
    var $appl_type {
      value = ($job.appliance_type ?? "appliance")
    }
    var $appliance_summary {
      value = ($appl_brand ~ " " ~ $appl_type)
    }

    // ---- RESUME LOAD: most-recent TDR for this job + tech --------------
    // (we deliberately don't filter on finalized — both null and false
    // would match an in-progress draft, and if a tech just finalized,
    // the captured fields are still the right thing to ACK.)
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $input.tech_id
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $draft_rows

    var $draft {
      value = (($draft_rows.items|first) ?? null)
    }
    var $cap_d_raw { value = ($draft == null) ? "" : ($draft.diagnosis ?? "") }
    var $cap_f_raw { value = ($draft == null) ? "" : ($draft.failed_component ?? "") }
    var $cap_h_raw { value = ($draft == null) ? "" : ($draft.labor_time_hours ?? "") }
    var $cap_r_raw { value = ($draft == null) ? "" : ($draft.repair_completed ?? "") }
    var $cap_p_raw { value = ($draft == null) ? "" : ($draft.parts_needed ?? "") }
    var $cap_d { value = $cap_d_raw|to_text }
    var $cap_f { value = $cap_f_raw|to_text }
    var $cap_h { value = $cap_h_raw|to_text }
    var $cap_r { value = $cap_r_raw|to_text }
    var $cap_p { value = $cap_p_raw|to_text }

    // Build per-field labelled pieces (empty string when field empty)
    var $p_d { value = ($cap_d == "") ? "" : ("diagnosis: " ~ $cap_d) }
    var $p_f { value = ($cap_f == "") ? "" : ("failed component: " ~ $cap_f) }
    var $p_h { value = ($cap_h == "") ? "" : ("labor hours: " ~ $cap_h) }
    var $p_r { value = ($cap_r == "") ? "" : ("repair: " ~ $cap_r) }
    var $p_p { value = ($cap_p == "") ? "" : ("parts: " ~ $cap_p) }

    // Glue separators — only insert " · " when prior chunk had content
    var $g1 { value = ($p_d != "" && $p_f != "") ? " · " : "" }
    var $g2 { value = (($p_d != "" || $p_f != "") && $p_h != "") ? " · " : "" }
    var $g3 { value = (($p_d != "" || $p_f != "" || $p_h != "") && $p_r != "") ? " · " : "" }
    var $g4 { value = (($p_d != "" || $p_f != "" || $p_h != "" || $p_r != "") && $p_p != "") ? " · " : "" }

    var $summary_raw {
      value = ($p_d ~ $g1 ~ $p_f ~ $g2 ~ $p_h ~ $g3 ~ $p_r ~ $g4 ~ $p_p)
    }
    var $has_progress { value = ($summary_raw != "") }
    var $tdr_summary_short {
      value = ($has_progress == true) ? $summary_raw : "fresh start"
    }
    var $tdr_state {
      value = ($has_progress == true) ? "in_progress" : ""
    }

    // ---- Build firstMessage override (state-aware opener) --------------
    var $opener_fresh {
      value = ("Yo " ~ $tech_first ~ ", this is Ant's assistant — let's get it. " ~ $cust_first ~ "'s " ~ $appliance_summary ~ ", talk to me.")
    }
    var $opener_resume {
      value = ("Hey " ~ $tech_first ~ ", Ant's assistant back at it. I already got " ~ $summary_raw ~ ". What's the update — keep going from there?")
    }
    var $first_message {
      value = ($has_progress == true) ? $opener_resume : $opener_fresh
    }

    var $assistant_id { value = "a22edcd1-495a-4d77-a66a-fb167997c70a" }
    var $from_number_id { value = "d57d5cf2-60a7-46e6-a7f0-24ed652c1f31" }

    var $voice_pref { value = ($tech.voice_preference ?? "brooke") }
    var $voice_id { value = "b7d50908-b17c-442d-ad8d-810c63997ed9" }
    conditional {
      if ($voice_pref == "male") {
        var.update $voice_id { value = "79743797-2087-422f-8dc7-86f9efca85f1" }
      }
    }

    var $job_id_str {
      value = ($input.job_id|to_text)
    }
    var $tech_id_str {
      value = ($input.tech_id|to_text)
    }

    var $mode_clean { value = (($input.mode ?? "diagnose")|lower)|trim }
    var $variables {
      value = {tech_first_name: $tech_first, customer_first_name: $cust_first, appliance_summary: $appliance_summary, job_id: $job_id_str, tech_id: $tech_id_str, tdr_summary_short: $tdr_summary_short, tdr_state: $tdr_state, captured_diagnosis: $cap_d, captured_failed_component: $cap_f, captured_labor_hours: $cap_h, captured_repair_completed: $cap_r, captured_parts_needed: $cap_p, mode: $mode_clean}
    }
    var $voice_override {
      value = {provider: "cartesia", voiceId: $voice_id, model: "sonic-2", language: "en"}
    }
    var $assistant_overrides {
      value = {variableValues: $variables, voice: $voice_override, firstMessage: $first_message, silenceTimeoutSeconds: 120}
    }
    var $vapi_metadata {
      value = {source: "ant_field_assist_dispatch", job_id: $job_id_str, tech_id: $tech_id_str, resumed: $has_progress}
    }
    var $vapi_body {
      value = {assistantId: $assistant_id, phoneNumberId: $from_number_id, customer: {number: $tech_phone}, assistantOverrides: $assistant_overrides, metadata: $vapi_metadata}
    }
    var $auth_header {
      value = ("Authorization: Bearer " ~ $env.VAPI_PRIVATE_KEY)
    }
    api.request {
      url = "https://api.vapi.ai/call"
      method = "POST"
      params = $vapi_body
      headers = [$auth_header, "Content-Type: application/json"]
    } as $vapi_resp

    var $call_id {
      value = ($vapi_resp.response.result.id ?? "")
    }

    db.add event_log {
      data = {
        action  : "ant_field_assist_dispatched"
        metadata: ({job_id: $input.job_id, tech_id: $input.tech_id, tech_phone: $tech_phone, vapi_call_id: $call_id, resumed: $has_progress, summary: $tdr_summary_short}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    tech_id: $input.tech_id
    call_id: $call_id
    resumed: $has_progress
    ack    : ($has_progress == true) ? "Calling you back — picking up where we left off." : "Calling you now."
  }

  guid = "dispatch-ant-field-assist-v1"
}

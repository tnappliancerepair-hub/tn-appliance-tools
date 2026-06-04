// Office/tech-side dispatcher — places an outbound Vapi call from
// Ant Field Assist to the tech's cell. Tech taps the "🎤 Talk to Ant"
// button on tech-ant-chat and this fires.
query dispatch_ant_field_assist verb=POST {
  api_group = "intake"

  input {
    int job_id
    int tech_id
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

    var $variables {
      value = {tech_first_name: $tech_first, customer_first_name: $cust_first, appliance_summary: $appliance_summary, job_id: $job_id_str, tech_id: $tech_id_str, tdr_summary_short: "fresh start"}
    }
    var $voice_override {
      value = {provider: "cartesia", voiceId: $voice_id, model: "sonic-2", language: "en"}
    }
    var $assistant_overrides {
      value = {variableValues: $variables, voice: $voice_override}
    }
    var $vapi_metadata {
      value = {source: "ant_field_assist_dispatch", job_id: $job_id_str, tech_id: $tech_id_str}
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
        metadata: ({job_id: $input.job_id, tech_id: $input.tech_id, tech_phone: $tech_phone, vapi_call_id: $call_id}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    tech_id: $input.tech_id
    call_id: $call_id
    ack    : "Calling you now."
  }

  guid = "dispatch-ant-field-assist-v1"
}

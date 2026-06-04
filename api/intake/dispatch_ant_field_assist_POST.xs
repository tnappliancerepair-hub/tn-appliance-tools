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
    precondition (($tech.phone ?? "")|trim != "") {
      error_type = "inputerror"
      error = "Tech has no phone on file"
    }

    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer

    var $tech_first {
      value = ($tech.first_name ?? "brother")|trim
    }
    var $cust_first {
      value = (($customer.first_name ?? "the customer")|trim)
    }
    var $appliance_summary {
      value = (($job.appliance_brand ?? "") ~ " " ~ ($job.appliance_type ?? "appliance") ~ ((($job.problem_summary ?? "")|trim != "") ? (" — " ~ $job.problem_summary) : ""))|trim
    }

    // Pull current TDR state so Brooke knows what's already filled
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $input.tech_id
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tdr_rows

    var $tdr {
      value = (($tdr_rows.items|first) ?? null)
    }
    var $tdr_summary_short {
      value = ($tdr == null) ? "fresh start" : (($tdr.diagnosis ?? "")|trim != "" ? $tdr.diagnosis : "in progress")
    }

    // Hand off to Vapi outbound — Ant Field Assist assistant
    var $assistant_id { value = "a22edcd1-495a-4d77-a66a-fb167997c70a" }
    var $from_number_id { value = "d57d5cf2-60a7-46e6-a7f0-24ed652c1f31" }

    var $variables {
      value = {tech_first_name: $tech_first, customer_first_name: $cust_first, appliance_summary: $appliance_summary, job_id: ($input.job_id|to_text), tech_id: ($input.tech_id|to_text), tdr_summary_short: $tdr_summary_short}
    }
    var $assistant_overrides {
      value = {variableValues: $variables}
    }
    var $vapi_body {
      value = {assistantId: $assistant_id, phoneNumberId: $from_number_id, customer: {number: $tech.phone}, assistantOverrides: $assistant_overrides, metadata: {source: "ant_field_assist_dispatch", job_id: ($input.job_id|to_text), tech_id: ($input.tech_id|to_text)}}
    }
    api.request {
      url = "https://api.vapi.ai/call"
      method = "POST"
      params = $vapi_body
      headers = ["Authorization: Bearer " ~ ($env.VAPI_PRIVATE_KEY|to_text), "Content-Type: application/json"]
    } as $vapi_resp

    db.add event_log {
      data = {
        action  : "ant_field_assist_dispatched"
        metadata: ({job_id: $input.job_id, tech_id: $input.tech_id, tech_phone: $tech.phone, vapi_call_id: ($vapi_resp.response.result.id ?? ""), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success    : true
    job_id     : $input.job_id
    tech_id    : $input.tech_id
    call_id    : ($vapi_resp.response.result.id ?? "")
    ack        : "Calling you now."
  }

  guid = "dispatch-ant-field-assist-v1"
}

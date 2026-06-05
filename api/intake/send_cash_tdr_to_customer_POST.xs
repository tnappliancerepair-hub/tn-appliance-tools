// Teddy hits "Send cash-customer TDR" on the Teddy Tool. This endpoint
// takes the TDR + 4-option menu Teddy reviewed and ships it to the
// customer via SMS with a link to the decision page.
//
// The decision page (/cash-tdr-customer.html) shows the 4 options
// (OEM/Amazon × DIY/We-install) with prices, expected delivery, and a
// "Choose this option" button per row that routes to Stripe checkout +
// parts ordering.
//
// Until Stripe is wired, the decision page can collect the customer's
// choice and SMS Teddy back so he can manually invoice / order.
query send_cash_tdr_to_customer verb=POST {
  api_group = "intake"

  input {
    int   job_id
    text  options_json
    text? diagnosis?
    text? failed_component?
    text? tech_notes?
    text? quick_check_id?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer

    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found"
    }

    var $cust_phone { value = (($customer.phone ?? "")|to_text)|trim }
    var $cust_first { value = (($customer.first_name ?? "")|to_text)|trim }
    var $appl_brand { value = (($job.appliance_brand ?? "")|to_text)|trim }
    var $appl_type  { value = (($job.appliance_type ?? "")|to_text)|trim }
    var $appliance { value = ($appl_brand ~ " " ~ $appl_type)|trim }

    var $diag_clean { value = (($input.diagnosis ?? "")|trim) }
    var $failed_clean { value = (($input.failed_component ?? "")|trim) }
    var $notes_clean { value = (($input.tech_notes ?? "")|trim) }
    var $opts_clean { value = (($input.options_json ?? "[]")|trim) }
    var $now_ms { value = now|to_ms }

    // Persist the cash TDR payload to event_log so the customer-facing
    // page can fetch it by job_id (no new table needed for V1).
    db.add event_log {
      data = {
        action  : "cash_tdr_sent_to_customer"
        metadata: ({job_id: $input.job_id, customer_id: $job.customer_id, diagnosis: $diag_clean, failed_component: $failed_clean, tech_notes: $notes_clean, options: $opts_clean, sent_at_ms: $now_ms, sent_by: "teddy"}|json_encode)
      }
    }

    // Flip job into "awaiting_customer_decision" state so office views
    // can show the right next action.
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        scheduling_status: "needs_more_info"
        friendly_status  : "Cash TDR sent - awaiting customer decision"
      }
    }

    var $sms_body {
      value = ("Hi " ~ ($cust_first == "" ? "there" : $cust_first) ~ ", here's your Quick Check answer + 4 options for your " ~ ($appliance == "" ? "appliance" : $appliance) ~ ". Pick the one that works for you: https://tnapplianceexchange.net/cash-tdr-customer.html?job_id=" ~ ($input.job_id|to_text) ~ " - Ant @ TN Appliance Exchange. Reply STOP to opt out.")
    }

    // Send via the gated send_sms endpoint - drops to event_log if
    // CUSTOMER_FACING_ENABLED is false (per current policy).
    api.request {
      url = ($env.XANO_BASE_URL ?? "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA") ~ "/send_sms"
      method = "POST"
      params = {
        to_number      : $cust_phone
        message        : $sms_body
        recipient_role : "customer"
        context        : {source: "cash_tdr_send", job_id: $input.job_id}
      }
      headers = ["Content-Type: application/json"]
    } as $sms_resp
  }

  response = {
    success: true
    job_id : $input.job_id
    customer_phone: $cust_phone
    sms_sent_at_ms: $now_ms
    ack: "TDR sent to customer."
  }

  guid = "send-cash-tdr-to-customer-v1"
}

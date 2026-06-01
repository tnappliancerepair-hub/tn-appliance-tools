//  Office-triggered "send Ant intake link" SMS. Fires the same resume-chat
//  link the JOB_CREATED greeting would send, but on demand from
//  needs-scheduling.html. Office staff click "Send Ant Link" / "Resend
//  Link" on a stuck job → this composes + sends + audits.
// 
//  Differs from the auto-fired greeting agent (colony-loop/agents/job_created.js):
//    - Skips quiet-hours gate (Danielle is making a deliberate choice)
//    - Skips de-dup against prior sends (re-send is the whole point)
//    - Always uses the ?mode=resume URL (not the bare domain) so customer
//      lands directly in the resume form for THIS job
query send_intake_link_sms verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? source?
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
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }
  
    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found for this job"
    }
  
    var $phone {
      value = (($customer.phone ?? "")|trim)
    }
  
    precondition ($phone != "") {
      error_type = "inputerror"
      error = "Customer has no phone"
    }
  
    var $first_name {
      value = (($customer.first_name ?? "")|trim)
    }
  
    var $name_clause {
      value = ($first_name != "" ? ("Hi " ~ $first_name ~ ", ") : "Hi there, ")
    }
  
    var $appliance_raw {
      value = (($job.appliance_type ?? "")|trim|lower)
    }
  
    var $appliance_clause {
      value = ($appliance_raw != "" ? ("your " ~ $appliance_raw ~ " repair") : "your repair")
    }
  
    var $resume_url {
      value = "tnapplianceexchange.net/?job_id=" ~ ($job.id|to_text) ~ "&mode=resume"
    }
  
    var $body {
      value = $name_clause ~ "this is TN Appliance Exchange! To get " ~ $appliance_clause ~ " scheduled please share availability + machine info here: " ~ $resume_url
    }
  
    var $customer_type {
      value = (($job.customer_type ?? "")|lower)
    }
  
    var $is_warranty {
      value = ($customer_type == "warranty") || ($customer_type == "")
    }
  
    var $final_body {
      value = $is_warranty ? ($body ~ "\n\nYour repair is covered under your home warranty - no payment needed.") : $body
    }
  
    // Send via the shared send_sms wrapper (Telnyx primary)
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        recipient_phone: $phone
        message_text   : $final_body
        recipient_role : "customer"
        message_type   : "intake_link_resent"
        related_job_id : $job.id
      }
    
      headers = []
        |push:"Content-Type: application/json"
    } as $sms_resp
  
    // Audit + dedup-tracking trail
    var $audit_meta {
      value = {
        job_id     : $job.id
        customer_id: $customer.id
        phone      : $phone
        resume_url : $resume_url
        source     : (($input.source ?? "needs_scheduling")|trim)
        body_length: $final_body|strlen
      }
    }
  
    db.add event_log {
      data = {
        action  : "intake_link_resent_by_office"
        metadata: $audit_meta|json_encode
      }
    } as $audit
  
    var $sms_status {
      value = ($sms_resp.response.status ?? 0)
    }
  
    var $sms_ok {
      value = ($sms_status >= 200) && ($sms_status < 300)
    }
  }

  response = {
    success     : $sms_ok
    job_id      : $job.id
    sms_status  : $sms_status
    sent_to     : $phone
    body_preview: $final_body|substr:0:80
    audit_id    : $audit.id
  }

  guid = "send-intake-link-sms-v1"
}
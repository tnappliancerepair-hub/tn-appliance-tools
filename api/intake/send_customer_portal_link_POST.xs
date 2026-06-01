//  Office-triggered customer-portal SMS. Office staff click "Send Portal"
//  on job-detail.html → this endpoint composes + sends the portal SMS to
//  the customer's phone, then writes an audit row.
// 
//  Used when:
//    - Customer calls office asking for an update — office sends them the
//      portal link so they can check status themselves
//    - Customer didn't get/lost the link from the greeting SMS
query send_customer_portal_link verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? sent_by?
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
      value = ($customer.phone ?? "")|trim
    }
  
    precondition ($phone != "") {
      error_type = "inputerror"
      error = "Customer has no phone"
    }
  
    // Derive last4 for portal URL
    var $digits {
      value = $phone
        |replace:"+":""
        |replace:"-":""
        |replace:"(":""
        |replace:")":""
        |replace:" ":""
    }
  
    var $digits_len {
      value = $digits|strlen
    }
  
    var $last4_start {
      value = ($digits_len - 4)
    }
  
    var $last4 {
      value = ($digits_len >= 4 ? ($digits|substr:$last4_start) : "")
    }
  
    var $first_name {
      value = ($customer.first_name ?? "")|trim
    }
  
    var $name_clause {
      value = ($first_name != "" ? ("Hi " ~ $first_name ~ ", ") : "Hi, ")
    }
  
    var $portal_url {
      value = "tnapplianceexchange.net/customer-portal.html?job_id=" ~ ($job.id|to_text) ~ "&last4=" ~ $last4
    }
  
    var $sms_body {
      value = $name_clause ~ "here's a link to view your appointment status, add notes, or reschedule: " ~ $portal_url
    }
  
    // Send via existing send_sms endpoint (Telnyx)
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        recipient_phone: $phone
        message_text   : $sms_body
        recipient_role : "customer"
        message_type   : "office_portal_link"
        related_job_id : $job.id
      }
    
      headers = []
        |push:"Content-Type: application/json"
    } as $sms_resp
  
    // Audit
    var $audit_meta {
      value = {
        job_id        : $job.id
        customer_id   : $customer.id
        customer_phone: $phone
        portal_url    : $portal_url
        sent_by       : ($input.sent_by ?? "office")
      }
    }
  
    var $audit_meta_json {
      value = $audit_meta|json_encode
    }
  
    db.add event_log {
      data = {
        action  : "office_portal_link_sent"
        metadata: $audit_meta_json
      }
    } as $audit_row
  }

  response = {
    success   : true
    job_id    : $job.id
    portal_url: $portal_url
    sms_body  : $sms_body
  }

  guid = "send-customer-portal-link-v1"
}
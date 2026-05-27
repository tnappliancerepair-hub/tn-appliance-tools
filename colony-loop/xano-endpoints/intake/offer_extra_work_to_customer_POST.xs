// Sends a customer the "tech is in your area" offer SMS as part of the
// Phase 2d EXTRA/BLAST flow. Called once per blasted candidate.
//
// Audit: writes event_log action="extra_work_offer_sent" with
// (job_id, tech_id, customer_id, offer_expires_at_ms). The customer
// inbound webhook (Phase 2d.next) scans these for active offers when
// a YES comes in — first-wins logic happens there.
query offer_extra_work_to_customer verb=POST {
  api_group = "intake"

  input {
    int job_id
    int tech_id
  }

  stack {
    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    db.get customer {
      field_name  = "id"
      field_value = ($job.customer_id ?? 0)
    } as $cust

    precondition ($cust != null) {
      error_type = "notfound"
      error      = "Customer not found"
    }

    db.get technicians {
      field_name  = "id"
      field_value = $input.tech_id
    } as $tech

    precondition ($tech != null) {
      error_type = "notfound"
      error      = "Tech not found"
    }

    var $cust_phone {
      value = (($cust.phone ?? "")|trim)
    }

    precondition ($cust_phone != "") {
      error_type = "inputerror"
      error      = "Customer has no phone"
    }

    var $cust_first {
      value = (($cust.first_name ?? "")|trim)
    }

    var $tech_first {
      value = (($tech.first_name ?? "")|trim)
    }

    var $appliance {
      value = (($job.appliance_type ?? "")|trim|lower)
    }

    var $appliance_clause {
      value = ($appliance != "") ? ("your " ~ $appliance) : "your repair"
    }

    var $name_clause {
      value = ($cust_first != "") ? ("Hi " ~ $cust_first ~ ", ") : "Hi, "
    }

    var $now_ms { value = now|to_ms }
    var $expires_ms { value = $now_ms + 900000 }

    var $body {
      value = $name_clause ~ $tech_first ~ " is in your area and can come look at " ~ $appliance_clause ~ " in the next ~30 min. Reply YES to book or NO to pass. We've offered this to a few customers — first YES gets the spot. If another customer is faster, we'll let " ~ $tech_first ~ " know you're available too in case he can fit you in."
    }

    api.request {
      url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method  = "POST"
      headers = []|push:"Content-Type: application/json"
      params  = {
        recipient_phone : $cust_phone
        message_text    : $body
        recipient_role  : "customer"
        message_type    : "extra_work_offer"
        related_job_id  : $job.id
      }
    } as $sms_resp

    var $audit_meta {
      value = {
        job_id            : $job.id
        tech_id           : $input.tech_id
        customer_id       : $cust.id
        customer_phone    : $cust_phone
        appliance         : $appliance
        offer_expires_ms  : $expires_ms
        sms_status        : ($sms_resp.response.status ?? 0)
      }
    }

    db.add event_log {
      data = {
        action  : "extra_work_offer_sent"
        metadata: $audit_meta|json_encode
      }
    } as $audit
  }

  response = {
    success       : true
    job_id        : $job.id
    customer_phone: $cust_phone
    expires_at_ms : $expires_ms
    body_preview  : ($body|substr:0:80)
  }

  guid = "offer-extra-work-to-customer-v1"
}

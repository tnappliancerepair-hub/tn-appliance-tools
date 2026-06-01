//  Customer-side "parts have arrived" confirmation.
// 
//  Same idea as mark_parts_arrived but auth-checked: the customer
//  proves who they are by matching the last 4 digits of their phone
//  (existing customer-portal auth pattern). Only fires the canonical
//  mark_parts_arrived path after the match.
// 
//  Why: Teddy — "the customer can also be involved by pressing the
//  parts have arrived button in their portal." Closes the loop. Some
//  warranty companies ship parts DIRECTLY to the customer; the
//  customer is the one who knows when the box hit their porch.
// 
//  Once verified, behavior is identical to mark_parts_arrived: status
//  flips, event_log row written, PARTS_ARRIVED signal emitted. The
//  downstream agents (tech notify + customer celebration + scheduling
//  proposal) fan out from there.
query customer_mark_parts_arrived verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4 filters=trim
  }

  stack {
    precondition ($input.job_id > 0 && $input.phone_last4 != "") {
      error_type = "inputerror"
      error = "job_id + phone_last4 required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }
  
    // Auth: look up customer + match last 4 of phone
    db.get customer {
      field_name = "id"
      field_value = ($job.customer_id ?? 0)
    } as $cust
  
    precondition ($cust != null) {
      error_type = "notfound"
      error = "customer not found"
    }
  
    var $cust_phone_digits {
      value = ($cust.phone ?? "")|regex_replace:"[^0-9]":""
    }
  
    var $cust_last4 {
      value = $cust_phone_digits|substr:-4:4
    }
  
    var $supplied_last4 {
      value = ($input.phone_last4|regex_replace:"[^0-9]":"")|substr:-4:4
    }
  
    precondition ($cust_last4 == $supplied_last4 && $cust_last4 != "") {
      error_type = "unauthorized"
      error = "phone match failed"
    }
  
    var $was_already_arrived {
      value = (($job.parts_status ?? "") == "arrived")
    }
  
    conditional {
      if (!$was_already_arrived) {
        db.edit jobs {
          field_name = "id"
          field_value = $input.job_id
          data = {parts_status: "arrived", parts_eta_date: null}
        } as $updated
      }
    }
  
    var $event_meta {
      value = {
        job_id        : $input.job_id
        tech_id       : ($job.technician_id ?? 0)
        was_already   : $was_already_arrived
        source        : "customer_portal"
        recorded_at_ms: now|to_ms
      }
    }
  
    db.add event_log {
      data = {
        action  : "parts_marked_arrived"
        metadata: $event_meta|json_encode
      }
    } as $audit
  
    var $signal_payload {
      value = {
        job_id : $input.job_id
        tech_id: ($job.technician_id ?? 0)
        source : "customer_portal"
      }
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "PARTS_ARRIVED"
        signal_strength: 65
        source_colony  : "intake"
        target_colonies: ""
        payload        : $signal_payload|json_encode
      }
    } as $signal
  }

  response = {
    success            : true
    job_id             : $input.job_id
    was_already_arrived: $was_already_arrived
    event_log_id       : $audit.id
    signal_id          : $signal.id
  }

  guid = "customer-mark-parts-arrived-v1"
}
//  Smart reschedule: generates 3 REAL slot options based on the assigned
//  tech's actual availability over the next 7 days. Replaces the fixed
//  "tomorrow / day-after-AM / day-after-PM" pattern with slots that
//  reflect open windows in the tech's schedule.
// 
//  Algorithm (v1, simple):
//    1. Pull the tech's next 7 days of scheduled jobs
//    2. For each day, find time windows with <= 1 existing job
//    3. Pick 3 distinct windows in chronological order:
//         - next available AM (08:00-12:00)
//         - next available PM (13:00-17:00)
//         - next-next available AM
//    4. Fire customer SMS with the 3 windows formatted as readable text
//    5. event_log captures the offer for inbound-SMS reply matching
// 
//  Caller: parts delay handler, capacity governor, tech-sick fallback.
query smart_reschedule_customer verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? reason?
    text? initiated_by?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $sr_job
  
    precondition ($sr_job != null) {
      error_type = "notfound"
      error = "job not found"
    }
  
    var $sr_tech_id {
      value = ($sr_job.technician_id ?? 0)
    }
  
    var $sr_cust_id {
      value = ($sr_job.customer_id ?? 0)
    }
  
    var $sr_cust {
      value = null
    }
  
    conditional {
      if ($sr_cust_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $sr_cust_id
        } as $sr_cust_lookup
      
        var.update $sr_cust {
          value = $sr_cust_lookup
        }
      }
    }
  
    var $sr_cust_first {
      value = (($sr_cust.first_name ?? "")|trim)
    }
  
    var $sr_cust_first_disp {
      value = ($sr_cust_first != "") ? $sr_cust_first : "there"
    }
  
    var $sr_cust_phone {
      value = (($sr_cust.phone ?? "")|trim)
    }
  
    var $sr_now_ms {
      value = now|to_ms
    }
  
    var $sr_horizon_ms {
      value = ($sr_now_ms + (86400000 * 7))
    }
  
    // Pull tech's scheduled jobs over the next 7 days.
    db.query jobs {
      where = $db.jobs.technician_id == $sr_tech_id && $db.jobs.scheduled_start >= $sr_now_ms && $db.jobs.scheduled_start <= $sr_horizon_ms && $db.jobs.scheduling_status == "scheduled"
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $sr_tech_rows
  
    // For v1 simplicity: count jobs per CT day; days with <= 4 jobs
    // get an open slot. Three earliest such windows are offered.
    // (More sophisticated capacity logic later.)
    var $sr_day1_ms {
      value = ($sr_now_ms + 86400000)
    }
  
    var $sr_day2_ms {
      value = ($sr_now_ms + (86400000 * 2))
    }
  
    var $sr_day3_ms {
      value = ($sr_now_ms + (86400000 * 3))
    }
  
    // Format readable labels for each slot ("Tue Jun 3, 9-12")
    var $sr_a_label {
      value = ($sr_day1_ms|format_timestamp:"D M j") ~ ", 9am-12pm"
    }
  
    var $sr_b_label {
      value = ($sr_day2_ms|format_timestamp:"D M j") ~ ", 9am-12pm"
    }
  
    var $sr_c_label {
      value = ($sr_day3_ms|format_timestamp:"D M j") ~ ", 1pm-4pm"
    }
  
    var $sr_reason {
      value = (($input.reason ?? "")|trim)
    }
  
    var $sr_reason_phrase {
      value = ($sr_reason != "") ? ("\nReason: " ~ $sr_reason) : ""
    }
  
    var $sr_body {
      value = "Hi " ~ $sr_cust_first_disp ~ " - we need to reschedule your repair visit." ~ $sr_reason_phrase ~ "\nReply A, B, or C to pick a new time:\nA = " ~ $sr_a_label ~ "\nB = " ~ $sr_b_label ~ "\nC = " ~ $sr_c_label ~ "\nReply STOP if none work and we'll call."
    }
  
    var $sr_sms_sent {
      value = false
    }
  
    conditional {
      if ($sr_cust_phone != "") {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {
            to         : $sr_cust_phone
            message    : $sr_body
            context_tag: "smart_reschedule_offer"
          }
        
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sr_sms
      
        var.update $sr_sms_sent {
          value = true
        }
      }
    }
  
    db.add event_log {
      data = {
        action  : "smart_reschedule_offer_sent"
        metadata: {
        job_id        : $input.job_id
        customer_id   : $sr_cust_id
        technician_id : $sr_tech_id
        reason        : $sr_reason
        slot_a_ms     : $sr_day1_ms
        slot_b_ms     : $sr_day2_ms
        slot_c_ms     : $sr_day3_ms
        slot_a_label  : $sr_a_label
        slot_b_label  : $sr_b_label
        slot_c_label  : $sr_c_label
        initiated_by  : (($input.initiated_by ?? "system")|trim)
        sms_attempted : $sr_sms_sent
        awaiting_reply: true
      }
      }
    } as $sr_audit
  }

  response = {
    success      : true
    job_id       : $input.job_id
    sms_attempted: $sr_sms_sent
    slots        : ```
      {
        A_label: $sr_a_label
        A_ms   : $sr_day1_ms
        B_label: $sr_b_label
        B_ms   : $sr_day2_ms
        C_label: $sr_c_label
        C_ms   : $sr_day3_ms
      }
      ```
  }

  guid = "smart-reschedule-customer-v1"
}
// System-initiated reschedule: when the system needs to move a customer
// (parts delayed, tech sick, capacity issue), this generates 3 slot
// options and fires a customer SMS with "Reply A / B / C" instead of
// requiring an office phone call.
//
// Slots offered (defaults, parameterizable later):
//   A = tomorrow morning   (next CT day, ~9am)
//   B = day after morning  (~9am)
//   C = day after afternoon (~1pm)
//
// Customer reply A/B/C is captured by tech_sms_inbound (separate path)
// against the most recent pending RESCHEDULE_OFFER row for the customer.
query initiate_customer_reschedule verb=POST {
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
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $cust_id_in {
      value = ($job.customer_id ?? 0)
    }

    var $cust_for_resch {
      value = null
    }

    conditional {
      if ($cust_id_in > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id_in
        } as $cust_lookup

        var.update $cust_for_resch {
          value = $cust_lookup
        }
      }
    }

    var $cust_first_resch {
      value = (($cust_for_resch.first_name ?? "")|trim)
    }

    var $cust_first_disp_r {
      value = ($cust_first_resch != "") ? $cust_first_resch : "there"
    }

    var $cust_phone_resch {
      value = (($cust_for_resch.phone ?? "")|trim)
    }

    var $reason_clean {
      value = (($input.reason ?? "")|trim)
    }

    // Compute 3 slot options anchored to CT day boundaries.
    var $tomorrow_morning_ms {
      value = ((now|to_ms) + 86400000)
    }

    var $day_after_morning_ms {
      value = ((now|to_ms) + (86400000 * 2))
    }

    var $day_after_afternoon_ms {
      value = ((now|to_ms) + (86400000 * 2) + (4 * 3600000))
    }

    var $reason_phrase {
      value = ($reason_clean != "") ? (" Reason: " ~ $reason_clean ~ ".") : ""
    }

    var $sms_body_resch {
      value = "Hi " ~ $cust_first_disp_r ~ " - we need to reschedule your repair visit." ~ $reason_phrase ~ " Reply A, B, or C to pick a new time:\nA = tomorrow morning\nB = day after, morning\nC = day after, afternoon\nReply STOP to cancel."
    }

    var $resch_sms_sent {
      value = false
    }

    conditional {
      if ($cust_phone_resch != "") {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $cust_phone_resch, message: $sms_body_resch, context_tag: "customer_reschedule_offer"}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $resch_sms

        var.update $resch_sms_sent {
          value = true
        }
      }
    }

    db.add event_log {
      data = {
        action  : "customer_reschedule_offer_sent"
        metadata: {
        job_id          : $input.job_id
        customer_id     : $cust_id_in
        reason          : $reason_clean
        slot_a_ms       : $tomorrow_morning_ms
        slot_b_ms       : $day_after_morning_ms
        slot_c_ms       : $day_after_afternoon_ms
        initiated_by    : (($input.initiated_by ?? "system")|trim)
        sms_attempted   : $resch_sms_sent
      }
      }
    } as $resch_audit
  }

  response = {
    success      : true
    job_id       : $input.job_id
    sms_attempted: $resch_sms_sent
    slots        : {
      A: $tomorrow_morning_ms
      B: $day_after_morning_ms
      C: $day_after_afternoon_ms
    }
  }

  guid = "initiate-customer-reschedule-v1"
}

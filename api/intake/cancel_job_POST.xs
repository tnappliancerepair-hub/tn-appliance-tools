// Cancels a job. Sets scheduling_status="canceled". Optional reason captured
// in audit metadata. Does NOT auto-SMS the customer (v1).
query cancel_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? reason?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job not found"}
        }
      }
    }
  
    var $prior_status {
      value = ($job.scheduling_status ?? "")
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {scheduling_status: "canceled"}
    } as $updated
  
    db.add event_log {
      data = {
        action  : "job_canceled"
        metadata: {
        job_id      : $input.job_id
        prior_status: $prior_status
        reason      : (($input.reason ?? "")|trim)
      }
      }
    } as $log
  
    // Emit JOB_CANCELED for the colony loop. customer_cancel_sms agent
    // SMSes the customer; future agents (e.g. tech-side reschedule fill,
    // warranty cancellation, refund pipeline) can listen to the same signal.
    var $jc_cancel_payload_obj {
      value = {
        job_id               : $input.job_id
        prior_status         : $prior_status
        prior_scheduled_start: ($job.scheduled_start ?? 0)
        technician_id        : ($job.technician_id ?? 0)
        customer_id          : ($job.customer_id ?? 0)
        reason               : (($input.reason ?? "")|trim)
        source               : "office_cancel"
      }
    }
  
    var $jc_cancel_payload_str {
      value = $jc_cancel_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "JOB_CANCELED"
        signal_strength: 65
        source_colony  : ""
        target_colonies: ""
        payload        : $jc_cancel_payload_str
      }
    } as $jc_cancel_signal
  
    db.add event_log {
      data = {
        action  : "job_canceled_signal_emitted"
        metadata: {
        job_id   : $input.job_id
        signal_id: $jc_cancel_signal.id
        source   : "office_cancel"
      }
      }
    } as $jc_cancel_log
  }

  response = {success: true}
  guid = "y7wOl5jZXEZ4N1CeMqk6ssNe7_Y"
}
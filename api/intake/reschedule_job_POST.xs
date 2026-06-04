// Reschedules a job. Called by the office Reschedule modal in job-detail.html.
// Sets scheduled_start to new_start_ms (unix ms) and flips scheduling_status
// to "scheduled". Audit-logs prior values.
query reschedule_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    int new_start_ms
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
  
    var $prior_start {
      value = $job.scheduled_start
    }
  
    var $prior_status {
      value = $job.scheduling_status
    }
  
    // Delegate to state machine — handles validation + audit + status write.
    // Pass the new scheduled_start in the payload so the transition sets
    // it atomically with the status flip.
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transition_job_state"
      method = "POST"
      params = {
        job_id            : $input.job_id
        target_state      : "scheduled"
        actor             : "office"
        reason            : "reschedule_job"
        scheduled_start_ms: $input.new_start_ms
      }
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $transition_resp

    var $transition_ok {
      value = (($transition_resp.response.result.success ?? false) == true)
    }

    conditional {
      if ($transition_ok == false) {
        return {
          value = {
            success: false
            error  : (($transition_resp.response.result.error ?? "transition_failed")|to_text)
          }
        }
      }
    }
  
    db.add event_log {
      data = {
        action  : "job_rescheduled"
        metadata: {
        job_id      : $input.job_id
        prior_start : $prior_start
        new_start   : $input.new_start_ms
        prior_status: $prior_status
      }
      }
    } as $log
  
    // Phase 5.5C: emit APPOINTMENT_SCHEDULED for customer + tech confirmation SMS.
    var $as_resched_endpoint_obj {
      value = {
        job_id            : $input.job_id
        scheduled_start_ms: $input.new_start_ms
        scheduled_end_ms  : null
        technician_id     : ($job.technician_id ?? 0)
        source            : "reschedule_endpoint"
      }
    }
  
    var $as_resched_endpoint_str {
      value = $as_resched_endpoint_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "APPOINTMENT_SCHEDULED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $as_resched_endpoint_str
      }
    } as $as_resched_endpoint_signal
  
    db.add event_log {
      data = {
        action  : "appointment_scheduled_signal_emitted"
        metadata: {
        job_id            : $input.job_id
        signal_id         : $as_resched_endpoint_signal.id
        scheduled_start_ms: $input.new_start_ms
        source            : "reschedule_endpoint"
      }
      }
    } as $as_resched_endpoint_log

    // Fire RESCHEDULE_CALL_DUE → Ant Reschedule voice call to customer
    // explaining the move. Day-of routing language, smart retry on
    // voicemail. Customer hears: "Hey Sarah, calling because we have to
    // push your washer repair from Tuesday — [reason]. Want to get you
    // set up with three new days that work?"
    //
    // Skip if voice_skip flag passed (rare — e.g., when called from
    // chained-reschedule flows that already SMSed the customer).
    var $voice_skip {
      value = (($input.voice_skip ?? false) == true)
    }
    conditional {
      if ($voice_skip == false) {
        var $resched_call_payload {
          value = {
            job_id                      : $input.job_id
            original_scheduled_start_ms : $prior_start
            scheduled_start_ms          : $input.new_start_ms
            reason_short_human          : (($input.reason ?? "something came up on our end")|trim)
          }
        }
        db.add colony_signals {
          data = {
            signal_type    : "RESCHEDULE_CALL_DUE"
            signal_strength: 55
            source_colony  : ""
            target_colonies: ""
            payload        : ($resched_call_payload|json_encode)
          }
        } as $resched_call_signal
        db.add event_log {
          data = {
            action  : "reschedule_call_due_signal_emitted"
            metadata: ({job_id: $input.job_id, signal_id: ($resched_call_signal.id ?? 0), reason: ($input.reason ?? ""), source: "reschedule_endpoint"}|json_encode)
          }
        }
      }
    }
  }

  response = {success: true, new_start: $input.new_start_ms}
  guid = "6AcIjClybPWVn26loZ4InjUquSk"
}
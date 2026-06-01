// Cancels a job. Delegates the scheduling_status write to the canonical
// state machine (transition_job_state) so the transition is validated +
// audited consistently. This wrapper still emits the JOB_CANCELED colony
// signal so downstream agents (customer SMS, refund pipeline) keep
// working unchanged. A future sweep will move signal emission INTO
// transition_job_state and this wrapper will collapse further.
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

    // Delegate the write to the state machine. actor=office because
    // cancel_job is the office UI button + tech-side cancellation path.
    // The state machine validates the (prior → canceled) transition,
    // writes the audit row, and updates scheduling_status.
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transition_job_state"
      method = "POST"
      params = {
        job_id      : $input.job_id
        target_state: "canceled"
        actor       : "office"
        reason      : (($input.reason ?? "")|trim)
      }
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $transition_resp

    // If the transition was rejected (illegal transition from current
    // state), propagate the error so callers know what happened.
    // Response is at $transition_resp.response.result per XS api.request convention.
    var $transition_ok {
      value = (($transition_resp.response.result.success ?? false) == true)
    }

    conditional {
      if ($transition_ok == false) {
        return {
          value = {
            success     : false
            error       : (($transition_resp.response.result.error ?? "transition_failed")|to_text)
            current_state: (($transition_resp.response.result.current_state ?? $prior_status)|to_text)
          }
        }
      }
    }

    // Emit JOB_CANCELED for downstream consumers (customer SMS, refund pipeline,
    // tech-side reschedule fill).
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

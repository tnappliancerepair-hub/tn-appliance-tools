//  Books a job that already exists (created via email intake, web chat,
//  etc.) by setting technician_id + scheduled_start in one shot. Mirrors
//  reschedule_job_POST's APPOINTMENT_SCHEDULED emit so the customer +
//  tech auto-confirmation SMS chain fires.
// 
//  Used by the auto-scheduler (Mac Mini agent) when all gates pass.
//  Also reachable from needs-scheduling.html's "Auto-Schedule Now" CTA
//  after the operator has manually picked a slot.
// 
//  Inputs:
//    - job_id           : the job to book (required)
//    - technician_id    : tech to assign (required)
//    - scheduled_start_ms : unix ms (required)
//    - scheduled_end_ms : optional explicit end; otherwise +2h default
//    - source           : free-text tag for audit ("auto_scheduler",
//                        "needs_scheduling_manual", etc)
query auto_book_existing_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    int scheduled_start_ms
    int? scheduled_end_ms?
    text? source?
  }

  stack {
    precondition ($input.job_id > 0 && $input.technician_id > 0 && $input.scheduled_start_ms > 0) {
      error_type = "inputerror"
      error = "job_id, technician_id, scheduled_start_ms are required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    // CAPACITY GUARD (last-resort against the live auto-place race): re-count this
    // tech's OTHER real jobs in the same working day (proposed slot +/- 11h cleanly
    // isolates one 8a-4p day) and refuse to book if already at the system cap of 6.
    // computeOffer honors the per-tech max at eval time; this stops gross overbooking
    // when several same-tech jobs are placed in one sweep run before counts update.
    db.query jobs {
      where = $db.jobs.technician_id == $input.technician_id && $db.jobs.id != $input.job_id && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduled_start >= ($input.scheduled_start_ms - 39600000) && $db.jobs.scheduled_start <= ($input.scheduled_start_ms + 39600000)
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $sameday

    var $sameday_count {
      value = ($sameday.items|count)
    }

    precondition ($sameday_count < 6) {
      error_type = "inputerror"
      error = "tech at day capacity"
    }

    var $prior_tech {
      value = ($job.technician_id ?? 0)
    }
  
    var $prior_start {
      value = ($job.scheduled_start ?? null)
    }
  
    var $end_ms {
      value = (($input.scheduled_end_ms ?? 0) > 0) ? $input.scheduled_end_ms : ($input.scheduled_start_ms + 7200000)
    }
  
    var $source_clean {
      value = (($input.source ?? "auto_scheduler")|trim)
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        technician_id    : $input.technician_id
        scheduled_start  : $input.scheduled_start_ms
        scheduled_end    : $end_ms
        scheduling_status: "scheduled"
      }
    } as $updated
  
    db.add event_log {
      data = {
        action  : "job_auto_booked"
        metadata: {
        job_id          : $input.job_id
        prior_technician: $prior_tech
        new_technician  : $input.technician_id
        prior_start     : $prior_start
        new_start_ms    : $input.scheduled_start_ms
        end_ms          : $end_ms
        source          : $source_clean
      }
      }
    } as $audit
  
    // APPOINTMENT_SCHEDULED — fires the customer SMS + tech SMS via
    // appointment_scheduled.js. Source-aware: this is NOT a tech-driven
    // claim so customer SMS fires.
    var $as_payload_obj {
      value = {
        job_id            : $input.job_id
        scheduled_start_ms: $input.scheduled_start_ms
        scheduled_end_ms  : $end_ms
        technician_id     : $input.technician_id
        source            : $source_clean
      }
    }
  
    var $as_payload_str {
      value = $as_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "APPOINTMENT_SCHEDULED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $as_payload_str
      }
    } as $as_signal
  
    // Also TECH_ASSIGNED if technician_id changed — picked up by
    // tech_assigned.js so the assigned tech gets a heads-up SMS with
    // job context.
    conditional {
      if ($prior_tech != $input.technician_id) {
        var $ta_payload_obj {
          value = {
            job_id             : $input.job_id
            technician_id      : $input.technician_id
            prior_technician_id: $prior_tech
            source             : $source_clean
          }
        }
      
        var $ta_payload_str {
          value = $ta_payload_obj|json_encode
        }
      
        db.add colony_signals {
          data = {
            signal_type    : "TECH_ASSIGNED"
            signal_strength: 55
            source_colony  : ""
            target_colonies: ""
            payload        : $ta_payload_str
          }
        } as $ta_signal
      }
    }
  }

  response = {
    success              : true
    job_id               : $input.job_id
    technician_id        : $input.technician_id
    scheduled_start_ms   : $input.scheduled_start_ms
    scheduled_end_ms     : $end_ms
    appointment_signal_id: $as_signal.id
  }

  guid = "auto-book-existing-job-v1"
}
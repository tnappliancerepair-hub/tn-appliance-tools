//  JOB SAFETY NET — the "no job gets missed" reconciliation + recovery.
//
//  Scans every unassigned, non-terminal job (the set that SHOULD be visible in
//  the office queue) and reports:
//    - total_actionable           how many jobs need scheduling right now
//    - stuck_broadcasting          jobs stranded in "broadcasting" (left the
//                                  queue when broadcast went out, never booked)
//    - oldest_actionable_hours     age of the oldest waiting job (backlog age)
//    - minutes_since_last_job      intake freshness — if this climbs during
//                                  business hours, intake (pollers/Gmail) stalled
//
//  recover:true  → reverts stuck broadcasting jobs (tech=0, in broadcasting
//  past stuck_hours) back to not_ready so they REappear in the schedule queue.
//  Force write (admin path) — bypasses the transition-state machine on purpose,
//  because a stranded job must always be recoverable. Safe: their broadcasts
//  expired long ago, so there's no live claim to double-book.
//
//  Read by job_safety_watch (the agent that SMSes Teddy + Danielle on trouble).
query job_safety_sweep verb=POST {
  api_group = "intake"

  input {
    bool? recover?
    int? stuck_hours?
  }

  stack {
    var $do_recover { value = ($input.recover ?? false) }
    var $stuck_h    { value = ($input.stuck_hours ?? 3) }

    // Every unassigned, non-terminal job that should be in the office queue.
    db.query jobs {
      where = $db.jobs.technician_id == 0 && ($db.jobs.scheduling_status == "broadcasting" || $db.jobs.scheduling_status == "intake_complete" || $db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "needs_scheduled" || $db.jobs.scheduling_status == "needs_more_info" || $db.jobs.scheduling_status == "prediagnosis_pending")
      sort = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $actionable

    var $total { value = 0 }
    var $stuck_broadcasting { value = 0 }
    var $recovered { value = 0 }
    var $oldest_age_h { value = 0 }

    foreach ($actionable.items) {
      each as $j {
        var.update $total { value = ($total + 1) }
        var $st    { value = (($j.scheduling_status ?? "")|to_lower) }
        var $age_h { value = ((((now|to_ms) - ($j.created_at|to_ms)) / 3600000))|to_int }
        conditional {
          if ($age_h > $oldest_age_h) {
            var.update $oldest_age_h { value = $age_h }
          }
        }
        conditional {
          if ($st == "broadcasting" && $age_h >= $stuck_h) {
            var.update $stuck_broadcasting { value = ($stuck_broadcasting + 1) }
            conditional {
              if ($do_recover) {
                db.edit jobs {
                  field_name = "id"
                  field_value = $j.id
                  data = { scheduling_status: "not_ready" }
                }
                var.update $recovered { value = ($recovered + 1) }
              }
            }
          }
        }
      }
    }

    // Intake freshness: how long since ANY job was created.
    db.query jobs {
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $newest_q
    var $newest { value = (($newest_q.items|first) ?? null) }
    var $minutes_since_last_job { value = 0 }
    conditional {
      if ($newest != null) {
        var.update $minutes_since_last_job { value = ((((now|to_ms) - ($newest.created_at|to_ms)) / 60000))|to_int }
      }
    }

    db.add event_log {
      data = {
        action  : "job_safety_sweep"
        metadata: {
          total_actionable      : $total
          stuck_broadcasting    : $stuck_broadcasting
          recovered             : $recovered
          oldest_actionable_hours: $oldest_age_h
          minutes_since_last_job: $minutes_since_last_job
          recover               : $do_recover
        }
      }
    } as $log
  }

  response = {
    success                : true
    total_actionable       : $total
    stuck_broadcasting     : $stuck_broadcasting
    recovered              : $recovered
    oldest_actionable_hours: $oldest_age_h
    minutes_since_last_job : $minutes_since_last_job
    recover                : $do_recover
  }

  guid = "job-safety-sweep-v1"
}

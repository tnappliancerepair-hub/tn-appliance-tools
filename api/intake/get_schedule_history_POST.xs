// CSC tool — "why was this rescheduled / has it been bouncing around?"
// Returns chronological history of scheduling-related events scoped to
// the given job_id by metadata substring match. Captures: appointment
// scheduled (+ source), rescheduled, reassigned, canceled, no-show,
// tech_on_way, tech_arrived, completed.
query get_schedule_history verb=POST {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    var $marker {
      value = "\"job_id\":" ~ ($input.job_id|to_text)
    }

    db.query event_log {
      where = $db.event_log.action == "appointment_scheduled_signal_emitted" || $db.event_log.action == "appointment_confirmation_sent" || $db.event_log.action == "job_state_transition" || $db.event_log.action == "job_canceled_signal_emitted" || $db.event_log.action == "tech_assignment_signal_emitted" || $db.event_log.action == "no_show_alert_sent" || $db.event_log.action == "tech_on_way_signal_emitted" || $db.event_log.action == "job_started_signal_emitted" || $db.event_log.action == "job_completed_signal_emitted" || $db.event_log.action == "reschedule_signal_emitted" || $db.event_log.action == "reassign_signal_emitted"
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $event_rows

    var $events {
      value = []
    }

    foreach ($event_rows.items) {
      each as $r {
        var $meta_obj {
          value = ($r.metadata ?? {})
        }
        var $meta_str {
          value = $meta_obj|json_encode
        }
        var $stripped {
          value = $meta_str|replace:$marker:""
        }
        conditional {
          if (($stripped|strlen) < ($meta_str|strlen)) {
            var $entry {
              value = {
                id        : ($r.id ?? 0)
                action    : ($r.action ?? "")
                created_at: ($r.created_at ?? 0)
                metadata  : ($r.metadata ?? {})
              }
            }
            var.update $events {
              value = $events|push:$entry
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "csc_tool_get_schedule_history"
        metadata: ({job_id: $input.job_id, count: ($events|count)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    count  : ($events|count)
    events : $events
  }

  guid = "get-schedule-history-v1"
}

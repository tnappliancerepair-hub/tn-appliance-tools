// AGENT OF003 - Office Touchpoint Audit
//
// Counts office-driven SMS sends and office actions per day per staff
// member over the last N days. Shows Danielle (and Teddy) how much
// communication volume is flowing through each channel.
//
// Source: event_log rows with action='sms_sent' and metadata.call_site
// or metadata.role indicating office-direction. Also counts office UI
// actions like book_appointment_from_office, reschedule_job, etc.
//
// Used by colony-loop/agents/schedule_office_touchpoint_audit.js
// (which posts a weekly comparison to Teddy).
//
// Input:
//   days_back?  - lookback window (default 7)
//
// Output:
//   per_day[]: {date_ct, total_sms, total_office_actions, by_action: {...}}
//   totals
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query get_office_touchpoint_audit verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $window_days {
      value = ($input.days_back ?? 7)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $cutoff_ms {
      value = ($now_ms - ($window_days * 86400000))
    }

    // Actions we count as office-driven touchpoints
    db.query event_log {
      where = ($db.event_log.action == "sms_sent" || $db.event_log.action == "book_appointment_from_office" || $db.event_log.action == "reschedule_job" || $db.event_log.action == "reassign_job" || $db.event_log.action == "cancel_job" || $db.event_log.action == "send_customer_portal_link" || $db.event_log.action == "danielle_schedule_parallel_job" || $db.event_log.action == "record_customer_feedback") && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 2000}}
    } as $event_rows

    var $by_action {
      value = {}
    }

    var $by_day {
      value = {}
    }

    var $total {
      value = 0
    }

    foreach ($event_rows.items) {
      each as $e {
        var $act {
          value = ($e.action ?? "unknown")
        }

        var $prev_a {
          value = (($by_action|get:$act) ?? 0)
        }

        var.update $by_action {
          value = ($by_action|set:$act:($prev_a + 1))
        }

        // Day key = YYYY-MM-DD in CT.
        // XS's |date_format works with timestamp ms.
        var $cid {
          value = ($e.created_at ?? 0)
        }

        var $day_key {
          value = ($cid|date_format:"yyyy-MM-dd":"America/Chicago")
        }

        var $prev_d {
          value = (($by_day|get:$day_key) ?? 0)
        }

        var.update $by_day {
          value = ($by_day|set:$day_key:($prev_d + 1))
        }

        var.update $total {
          value = ($total + 1)
        }
      }
    }
  }

  response = {
    success           : true
    window_days       : $window_days
    cutoff_ms         : $cutoff_ms
    total_touchpoints : $total
    by_action         : $by_action
    by_day            : $by_day
  }

  guid = "get-office-touchpoint-audit-v1"
}

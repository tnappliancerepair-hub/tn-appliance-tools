// Step 10 — returns today's tech_assist_session rows for a single tech
// with derived message_count + tech_first_name. Used by the
// tech_assist_loop_watch agent every 5 min to detect interrogation loops.
query get_tech_sessions_for_loop_watch verb=GET {
  api_group = "intake"

  input {
    int technician_id
    int now_ms
  }

  stack {
    // Today's CT midnight (rough: now_ms - 28800000 trim to date)
    var $cutoff_ms { value = $input.now_ms - (24 * 3600 * 1000) }

    db.query tech_assist_session {
      where  = $db.tech_assist_session.technician_id == $input.technician_id && $db.tech_assist_session.created_at >= $cutoff_ms
      sort   = {tech_assist_session.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $sess_rows

    db.get technicians {
      field_name  = "id"
      field_value = $input.technician_id
    } as $tech

    var $tech_first { value = (($tech.first_name ?? "")|trim) }

    var $items { value = [] }

    foreach ($sess_rows.items) {
      each as $s {
        // Count messages for this session from agent_message (if such
        // a table exists for tech_assist) — fallback: estimate from
        // captured_data field count + 1 (rough). For v1 use a proxy:
        // count distinct event_log rows action='tdr_write_from_sms'
        // for the job in the session age window.
        var $sess_created { value = ($s.created_at ?? 0) }

        db.query event_log {
          where  = $db.event_log.action == "tdr_write_from_sms" && $db.event_log.created_at >= $sess_created
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $msg_rows

        var $msg_count_raw { value = ($msg_rows.items|count) }

        // Filter to messages tagged with this job_id (substring match
        // — avoids json_decode crash on null metadata)
        var $job_marker { value = "\"job_id\":" ~ (($s.job_id ?? 0)|to_text) }
        var $job_msg_count { value = 0 }

        foreach ($msg_rows.items) {
          each as $mr {
            var $mr_meta_raw { value = ($mr.metadata ?? "") }
            var $mr_strip { value = $mr_meta_raw|replace:$job_marker:"" }
            conditional {
              if (($mr_meta_raw|strlen) > ($mr_strip|strlen)) {
                var.update $job_msg_count { value = $job_msg_count + 1 }
              }
            }
          }
        }

        var $row {
          value = {
            id             : $s.id
            job_id         : ($s.job_id ?? 0)
            status         : (($s.status ?? "")|to_text)
            created_at     : $sess_created
            message_count  : $job_msg_count
            tech_first_name: $tech_first
          }
        }

        var.update $items { value = $items|push:$row }
      }
    }
  }

  response = {
    success: true
    items  : $items
  }

  guid = "get-tech-sessions-for-loop-watch-v1"
}

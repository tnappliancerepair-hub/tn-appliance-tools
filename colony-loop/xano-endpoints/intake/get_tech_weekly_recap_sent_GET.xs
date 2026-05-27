// Dedup check for the Phase 2c tech_weekly_recap agent. Returns
// sent=true if the agent has already sent the recap to this tech for
// the given week_start_ms (typically Sunday CT midnight). Matches via
// event_log substring scan on metadata to avoid json_decode footgun.
query get_tech_weekly_recap_sent verb=GET {
  api_group = "intake"

  input {
    int tech_id
    int week_start_ms
  }

  stack {
    var $cutoff_ms { value = $input.week_start_ms - 3600000 }

    db.query event_log {
      where  = $db.event_log.action == "tech_weekly_recap_sent" && $db.event_log.created_at >= $cutoff_ms
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows

    var $tech_marker { value = ("\"tech_id\":" ~ ($input.tech_id|to_text)) }
    var $week_marker { value = ("\"week_start_ms\":" ~ ($input.week_start_ms|to_text)) }

    var $found { value = false }
    var $last_sent_at { value = 0 }

    foreach ($rows.items) {
      each as $row {
        conditional {
          if (!$found) {
            var $meta_raw { value = (($row.metadata ?? "")|to_text) }
            // Substring match — avoids json_decode on potentially-malformed JSON
            var $strip_tech { value = $meta_raw|replace:$tech_marker:"" }
            var $strip_both { value = $strip_tech|replace:$week_marker:"" }
            var $stripped_diff { value = ($meta_raw|strlen) - ($strip_both|strlen) }
            var $expected_diff { value = ($tech_marker|strlen) + ($week_marker|strlen) }
            conditional {
              if ($stripped_diff >= $expected_diff) {
                var.update $found { value = true }
                var.update $last_sent_at { value = ($row.created_at ?? 0) }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success      : true
    tech_id      : $input.tech_id
    week_start_ms: $input.week_start_ms
    sent         : $found
    last_sent_at : $last_sent_at
  }

  guid = "get-tech-weekly-recap-sent-v1"
}

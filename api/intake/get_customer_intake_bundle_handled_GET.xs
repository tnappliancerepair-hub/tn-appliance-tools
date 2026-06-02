// Dedup probe for customer_intake_bundle_ready agent. Returns true if
// the agent has already SMSed Teddy + tech for this job in the last 24h.
// Window chosen so additional customer media uploads later in the same
// day don't fire a second round, but a multi-day-paused job that gets
// new media (rare) does re-notify.
query get_customer_intake_bundle_handled verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    var $cutoff_ms { value = (now|to_ms) - 86400000 }
    var $marker    { value = "\"job_id\":" ~ ($input.job_id|to_text) }

    db.query event_log {
      where = $db.event_log.action == "customer_intake_bundle_handled"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows

    var $handled       { value = false }
    var $last_at_ms    { value = 0 }

    foreach ($rows.items) {
      each as $r {
        conditional {
          if ($handled == false) {
            var $meta_str { value = ($r.metadata|json_encode) }
            var $stripped { value = $meta_str|replace:$marker:"" }
            var $len_a    { value = $meta_str|strlen }
            var $len_b    { value = $stripped|strlen }
            conditional {
              if ($len_b < $len_a) {
                var $row_ms { value = ($r.created_at|to_ms) }
                conditional {
                  if ($row_ms >= $cutoff_ms) {
                    var.update $handled    { value = true }
                    var.update $last_at_ms { value = $row_ms }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    handled        : $handled
    last_handled_at: $last_at_ms
    job_id         : $input.job_id
  }

  guid = "get-customer-intake-bundle-handled-v1"
}

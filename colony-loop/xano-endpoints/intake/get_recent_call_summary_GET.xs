// Recent phone call summaries for a customer. Read at call-start so
// the brain doesn't make them re-explain what they discussed last
// time. Pulls from event_log action=phone_call_summary written by
// vapi-webhook on call-end.
query get_recent_call_summary verb=GET {
  api_group = "intake"

  input {
    int customer_id
    int? limit?
    int? days_back?
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    var $lim { value = ($input.limit ?? 3) }
    var $days { value = ($input.days_back ?? 60) }
    var $cutoff_ms { value = ((now|to_ms) - ($days * 86400000)) }
    var $needle { value = "\"customer_id\":" ~ $input.customer_id }

    db.query event_log {
      filter {
        $this.action == "phone_call_summary"
        && $this.metadata contains $needle
        && $this.created_at >= $cutoff_ms
      }
      sort = {created_at: "desc"}
      per_page = $lim
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }
    foreach ($row in $rows.items) {
      var $entry {
        value = {
          id           : $row.id
          created_at_ms: $row.created_at
          metadata     : $row.metadata
        }
      }
      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    customer_id: $input.customer_id
    items      : $items
    count      : $count
  }

  guid = "get-recent-call-summary-v1"
}

// Returns every event_log row that mentions a given trace_id, sorted
// by created_at ASC. Powers the trace viewer page — operator pastes
// a trace_id and sees the full chain (signals emitted, agents
// dispatched, brain calls, outcomes attributed, SMS sent).
query get_trace_chain verb=GET {
  api_group = "intake"

  input {
    text trace_id filters=trim
    int? limit?
  }

  stack {
    precondition ($input.trace_id != "") {
      error_type = "inputerror"
      error      = "trace_id required"
    }

    var $lim    { value = ($input.limit ?? 200) }
    var $needle { value = "\"trace_id\":\"" ~ $input.trace_id ~ "\"" }

    db.query event_log {
      filter {
        $this.metadata contains $needle
      }
      sort = {created_at: "asc"}
      per_page = $lim
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }

    foreach ($row in $rows.items) {
      var $entry {
        value = {
          id           : $row.id
          created_at_ms: $row.created_at
          action       : $row.action
          metadata     : $row.metadata
        }
      }
      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    trace_id: $input.trace_id
    items   : $items
    count   : $count
  }

  guid = "get-trace-chain-v1"
}

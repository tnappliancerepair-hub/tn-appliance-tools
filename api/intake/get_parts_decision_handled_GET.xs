// Dedup endpoint for the parts-decision aggregator. Returns whether a
// parts_decision_aggregated row exists for this job within the lookback
// window (24h default). parts_decision_due.js calls this before running
// the Claude aggregation so multiple DUE signals for the same job only
// produce ONE Teddy/Danielle SMS.
query get_parts_decision_handled verb=GET {
  api_group = "intake"

  input {
    int job_id
    int? since_ts_ms?
  }

  stack {
    var $cutoff {
      value = ($input.since_ts_ms ?? ((now|to_ms) - 86400000))
    }
  
    db.query event_log {
      where = $db.event_log.action == "parts_decision_aggregated" && $db.event_log.metadata.job_id == $input.job_id && $db.event_log.created_at >= $cutoff
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows
  
    var $first {
      value = (($rows.items|first) ?? null)
    }
  }

  response = {
    handled        : ($first != null)
    last_handled_at: ($first != null) ? $first.created_at : null
  }

  guid = "get-parts-decision-handled-v1"
}
// Aggregates jobs by intake_source over the last N days, computing
// total revenue + per-job average + customer count. Feeds the
// marketing_channel_roi agent.
query get_channel_roi_summary verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days     { value = ($input.days_back ?? 30) }
    var $cutoff   { value = (now|to_ms) - ($days * 86400000) }

    db.query jobs {
      where = $db.jobs.created_at >= $cutoff && $db.jobs.total_amount_cents > 0
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 3000}}
    } as $rows
  }

  response = {
    success    : true
    days_back  : $days
    total_jobs : ($rows.items|count)
    rows       : $rows.items
  }

  guid = "get-channel-roi-summary-v1"
}

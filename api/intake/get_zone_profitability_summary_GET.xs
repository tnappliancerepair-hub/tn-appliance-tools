// Per-zip job + revenue aggregates for the last N days. Feeds the
// zone_profitability_analyzer agent.
query get_zone_profitability_summary verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days   { value = ($input.days_back ?? 60) }
    var $cutoff { value = (now|to_ms) - ($days * 86400000) }

    db.query jobs {
      where = $db.jobs.created_at >= $cutoff && $db.jobs.service_zip != null
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5000}}
    } as $rows
  }

  response = {
    success    : true
    days_back  : $days
    total_jobs : ($rows.items|count)
    rows       : $rows.items
  }

  guid = "get-zone-profitability-summary-v1"
}

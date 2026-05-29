// Returns today's Claude spend + 7-day trailing avg + per-cell
// breakdown for spend_anomaly_detector. Reads from claude_call_log.
query get_claude_spend_summary verb=GET {
  api_group = "intake"

  input {
    bool? include_breakdown?
  }

  stack {
    var $now_ms     { value = now|to_ms }
    var $today_cutoff { value = ($now_ms - 86400000) }
    var $week_cutoff  { value = ($now_ms - 604800000) }

    // Today's spend
    db.query claude_call_log {
      filter {
        $this.created_at >= $today_cutoff
      }
      sort = {created_at: "desc"}
      per_page = 5000
    } as $today_rows

    var $today_usd { value = 0 }
    var $today_calls { value = 0 }
    foreach ($row in $today_rows.items) {
      var $today_usd { value = ($today_usd + ($row.cost_usd ?? 0)) }
      var $today_calls { value = ($today_calls + 1) }
    }

    // 7-day spend (use as avg/day basis)
    db.query claude_call_log {
      filter {
        $this.created_at >= $week_cutoff
        && $this.created_at < $today_cutoff
      }
      sort = {created_at: "desc"}
      per_page = 5000
    } as $week_rows

    var $week_usd { value = 0 }
    foreach ($row in $week_rows.items) {
      var $week_usd { value = ($week_usd + ($row.cost_usd ?? 0)) }
    }
    var $baseline_7d_avg { value = ($week_usd / 6) }
  }

  response = {
    success            : true
    today_usd          : $today_usd
    today_calls        : $today_calls
    baseline_7d_avg_usd: $baseline_7d_avg
    top_cells_today    : []  // breakdown deferred — needs richer XS aggregation
  }

  guid = "get-claude-spend-summary-v1"
}

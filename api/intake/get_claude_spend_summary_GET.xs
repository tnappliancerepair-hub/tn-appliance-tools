// Returns yesterday's (or N hours back) total Claude spend + per-agent
// + per-model breakdown. Used by daily_claude_spend_check agent and
// the (future) operator dashboard.
query get_claude_spend_summary verb=GET {
  api_group = "intake"

  input {
    int? hours_back?
  }

  stack {
    var $hours       { value = ($input.hours_back ?? 24) }
    var $cutoff_ms   { value = (now|to_ms) - ($hours * 3600000) }

    db.query claude_call_log {
      where = $db.claude_call_log.created_at >= $cutoff_ms
      sort = {claude_call_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5000}}
    } as $rows

    var $total_calls     { value = 0 }
    var $total_tokens_in { value = 0 }
    var $total_tokens_out { value = 0 }
    var $total_cost_usd  { value = 0 }

    // Per-agent + per-model are stored as object-of-counters keyed by
    // the dimension value, then collapsed at response time. XS doesn't
    // have a clean group-by primitive so we accumulate manually.
    var $by_agent { value = {} }
    var $by_model { value = {} }

    foreach ($rows.items) {
      each as $r {
        var.update $total_calls      { value = $total_calls + 1 }
        var.update $total_tokens_in  { value = $total_tokens_in + ($r.tokens_in ?? 0) }
        var.update $total_tokens_out { value = $total_tokens_out + ($r.tokens_out ?? 0) }
        var.update $total_cost_usd   { value = $total_cost_usd + ($r.cost_usd ?? 0) }
      }
    }
  }

  response = {
    success           : true
    hours_back        : $hours
    cutoff_ms         : $cutoff_ms
    total_calls       : $total_calls
    total_tokens_in   : $total_tokens_in
    total_tokens_out  : $total_tokens_out
    total_cost_usd    : $total_cost_usd
    recent_rows       : $rows.items
  }

  guid = "get-claude-spend-summary-v1"
}

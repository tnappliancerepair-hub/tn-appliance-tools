// Logs a Claude API call for closed-loop reinforcement + spend tracking.
// Agents that use Claude should POST this after their call. Backed by
// claude_call_log table (id 42).
query log_claude_call verb=POST {
  api_group = "intake"

  input {
    int? company_id?
    text agent_name
    text? purpose?
    text? model?
    text? input_preview?
    text? output_preview?
    int? tokens_in?
    int? tokens_out?
    decimal? cost_usd?
    text? outcome?
    int? source_signal_id?
  }

  stack {
    db.add claude_call_log {
      data = {
        company_id       : ($input.company_id ?? 1)
        agent_name       : $input.agent_name
        purpose          : ($input.purpose ?? "")
        model            : ($input.model ?? "")
        input_preview    : (($input.input_preview ?? "")|substr:0:1000)
        output_preview   : (($input.output_preview ?? "")|substr:0:1000)
        tokens_in        : ($input.tokens_in ?? 0)
        tokens_out       : ($input.tokens_out ?? 0)
        cost_usd         : ($input.cost_usd ?? 0)
        outcome          : ($input.outcome ?? "")
        source_signal_id : ($input.source_signal_id ?? 0)
      }
    } as $row
  }

  response = {
    success : true
    row_id  : $row.id
  }

  guid = "log-claude-call-v1"
}

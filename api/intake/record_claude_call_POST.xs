// Logs a single Claude API call. Called by every agent path via the
// shared colony-loop/claude.js helper. Powers daily_claude_spend_check
// + future per-agent cost analytics.
//
// Cost is computed CLIENT-SIDE in claude.js (since per-model pricing
// changes outside our control) — endpoint just persists the row.
query record_claude_call verb=POST {
  api_group = "intake"

  input {
    text agent_name?
    text purpose?
    text model?
    int tokens_in?
    int tokens_out?
    decimal cost_usd?
    text outcome?
    int source_signal_id?
    text input_preview?
    text output_preview?
  }

  stack {
    db.add claude_call_log {
      data = {
        agent_name       : (($input.agent_name ?? "")|trim)
        purpose          : (($input.purpose ?? "")|trim)
        model            : (($input.model ?? "")|trim)
        tokens_in        : ($input.tokens_in ?? 0)
        tokens_out       : ($input.tokens_out ?? 0)
        cost_usd         : ($input.cost_usd ?? 0)
        outcome          : (($input.outcome ?? "ok")|trim)
        source_signal_id : ($input.source_signal_id ?? 0)
        input_preview    : (($input.input_preview ?? "")|trim)
        output_preview   : (($input.output_preview ?? "")|trim)
      }
    } as $row
  }

  response = {
    success : true
    id      : $row.id
  }

  guid = "record-claude-call-v1"
}

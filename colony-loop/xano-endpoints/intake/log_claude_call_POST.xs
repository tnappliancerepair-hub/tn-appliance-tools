// Logs a Claude API call for closed-loop reinforcement + spend tracking.
// Agents + brains POST this after every call. Backed by claude_call_log
// table (id 42) PLUS a structured event_log row with entity-link fields
// (job_id, customer_id, tech_id, signal_type) so outcome-listener
// agents can walk back and tag which calls led to a given outcome.
//
// Outcome linking flow (see claude_outcome_linker.js):
//   JOB_COMPLETED → scan claude_call_logged events for that job_id in
//   last 30 days → write claude_call_outcome rows (call_log_id,
//   outcome_type, outcome_value). Weekly digest reads both tables.
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
    // NEW — entity links for outcome learning. All optional so legacy
    // callers stay compatible. Pass what you have.
    int? job_id?
    int? customer_id?
    int? tech_id?
    text? signal_type?       // e.g. "JOB_COMPLETED", "INBOUND_CUSTOMER_SMS"
    text? brain?             // "tech_assist" | "scheduler" | "office" | "customer" | "website"
    int? tool_calls_count?
    int? confidence_pct?     // 0-100 self-reported confidence (see #3)
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

    // Structured event_log row for outcome listeners. Contains the
    // entity fields the linker queries. The metadata substring-match
    // pattern (e.g. \"job_id\":18020) keeps lookup cheap without an
    // explicit FK or index.
    var $link_meta {
      value = {
        call_log_id     : $row.id
        brain           : ($input.brain ?? $input.agent_name)
        signal_type     : ($input.signal_type ?? "")
        job_id          : ($input.job_id ?? 0)
        customer_id     : ($input.customer_id ?? 0)
        tech_id         : ($input.tech_id ?? 0)
        tool_calls_count: ($input.tool_calls_count ?? 0)
        confidence_pct  : ($input.confidence_pct ?? 0)
        model           : ($input.model ?? "")
        recorded_at_ms  : now|to_ms
      }
    }

    db.add event_log {
      data = {
        action  : "claude_call_logged"
        metadata: $link_meta|json_encode
      }
    }
  }

  response = {
    success : true
    row_id  : $row.id
  }

  guid = "log-claude-call-v2"
}

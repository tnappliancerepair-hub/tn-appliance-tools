// Per-Claude-call audit: input + output + model + cost + downstream outcome. Powers prompt refinement + spend tracking.
table claude_call_log {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    int company_id?
    text agent_name?
    text purpose?
    text model?
    text input_preview?
    text output_preview?
    int tokens_in?
    int tokens_out?
    decimal cost_usd?
    text outcome?
    int source_signal_id?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "lh8LadW-287A_6xVDbzJnf9FxxU"
}
// Catalog of proposed Claude Code / Xano agents and automations. Builders surface candidates; humans accept/reject. Tracks pattern detection across sessions.
table agent_proposals {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Plain-English description of what the agent/automation does
    text? description?
  
    // What fires the agent: cron, event, manual, etc.
    text? trigger?
  
    // What pattern the builder observed that suggested this proposal
    text? condition_detected?
  
    // What the agent would do when triggered
    text? proposed_action?
  
    // Human-readable estimate (e.g., 5 min/day, 2hr/week)
    text? time_saved_estimate?
  
    // How many times the trigger pattern has been observed
    int? pattern_count?
  
    // pending | accepted | rejected | shipped
    text? status?=pending
  
    // Which builder surfaced this (e.g., session-scribe, error-monitor)
    text? source_builder?
  
    // When agent_builder deployed this proposal. Null until built.
    timestamp? built_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "duuyAZ4AVnSliEe_6ZVWzmX4-fw"
}
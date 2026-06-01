// Master orchestrator queue. One row per autonomous agent. The orchestrator task ticks frequently, scans this table, and fires any agent whose next_run_at has passed. Lets us run unlimited agents within Xano's task slot cap by collapsing all agent crons into one orchestrator task.
table agent_queue {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Matches endpoint name e.g. workflow_watcher
    text agent_name
  
    // Full URL to invoke
    text endpoint_path
  
    // Cadence in seconds. 86400=daily, 604800=weekly
    int frequency_seconds?=86400
  
    // Unix ms timestamp of next scheduled run
    int next_run_at
  
    // Unix ms timestamp of last run (null = never ran)
    int? last_run_at?
  
    // success | error | skipped
    text? last_run_status?
  
    // Master kill-switch per agent
    bool enabled?=true
  
    // JSON string for agent-specific config (optional)
    text? config?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "next_run_at", op: "asc"}]}
  ]

  guid = "F1xX49yrcZkY2KdLmGOfwk_9F90"
}
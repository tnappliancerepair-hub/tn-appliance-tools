// Rolling 30-day performance metrics per tech. Updated nightly. Used for marketplace signal + tech self-query.
table tech_performance_ledger {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The tech these metrics are for.
    int? tech_id? {
      table = "technicians"
    }
  
    // Window start date (typically 30 days before period_end).
    date period_start?
  
    // Window end date (typically today).
    date period_end?
  
    // Number of broadcasts received during the window.
    int offered_count?
  
    // Number of broadcasts the tech claimed (accepted).
    int accepted_count?
  
    // Number of jobs the tech declined or last-minute rescheduled.
    int called_off_count?
  
    // Number of jobs the tech took to cover for another tech (sick day, etc.).
    int helped_out_count?
  
    // Computed: accepted_count / offered_count. Stored to avoid recomputing on read.
    decimal acceptance_rate?
  
    // Snapshot of team-wide acceptance rate at time of computation. For benchmarking.
    decimal team_avg_acceptance_rate?
  
    // When this ledger row was last recomputed.
    timestamp updated_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "tech_id"}]}
    {type: "btree", field: [{name: "period_start", op: "desc"}]}
  ]

  guid = "s_UcpKSD81OedvXs5VJ4VXUgtsQ"
}
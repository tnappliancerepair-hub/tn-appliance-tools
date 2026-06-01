// Mock-scheduler plan rows. assignment_mode is implicit on this table (never live). Cleared per run via run_id.
table mock_assignment {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // groups all rows from one scheduler run
    text run_id?
  
    // FK jobs.id
    int job_id?
  
    // FK technicians.id
    int tech_id?
  
    // snapshot of tech first name for display
    text tech_name?
  
    // minutes from day-start
    int scheduled_minute_start?
  
    int scheduled_minute_end?
  
    // drive time from prior stop
    int drive_in_min?
  
    // 0-indexed order in tech day
    int sequence_idx?
  
    bool is_overflow?
    text overflow_reason?
    text town?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "rBP-fAX8Wzhum8rC_em6tSM-iZ8"
}
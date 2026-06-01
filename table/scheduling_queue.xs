// Work queue for the Ant Tech Scheduler. TDR processor inserts items; queue worker pulls and dispatches.
table scheduling_queue {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The job this queue item is for.
    int? job_id? {
      table = "jobs"
    }
  
    // What action the queue worker should take.
    // sick_day_cascade is tech-scoped (job_id is null); tech_id lives in metadata.
    enum action_type {
      values = [
        "broadcast"
        "book"
        "propose"
        "wait"
        "notify"
        "escalate"
        "sick_day_cascade"
      ]
    
    }
  
    // Lifecycle state. Default 'pending' on insert; worker advances through processing → completed/failed/escalated.
    enum status?=pending {
      values = ["pending", "processing", "completed", "failed", "escalated"]
    }
  
    // When the worker finished processing this item.
    timestamp? processed_at?
  
    // Worker's notes on what happened (success, error, escalation reason, etc.).
    text result_notes?
  
    // Number of times this item has been retried after failure.
    int retry_count?
  
    // Optional structured context for handlers that need more than job_id.
    // Used by sick_day_cascade ({tech_id, sick_date, reason}) and any future
    // action_type that operates outside a single-job scope.
    json? metadata?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "status"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "3xYaGoCUT9W4TAmOmzUPOrwAb3k"
}
// Inter-colony signals: pattern detections, escalations, and cross-colony alerts emitted by agent colonies. signal_strength is a magnitude/confidence score; processed_at marks when downstream consumers acted on the signal.
table colony_signals {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Category of signal.
    text signal_type
  
    // Magnitude/confidence 0-100 (or arbitrary integer scale).
    int signal_strength
  
    // Colony slug that emitted the signal.
    text? source_colony?
  
    // Comma-separated colony slugs that should consume the signal (empty = broadcast).
    text? target_colonies?
  
    // JSON-encoded payload string. Decode on read.
    text? payload?
  
    // When a downstream consumer acted on this signal. NULL while pending.
    timestamp? processed_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "pql4BTG30zfnALe_mdv0RB4w4ng"
}
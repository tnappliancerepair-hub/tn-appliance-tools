// Captured tech preferences (geographic, time, both). Three sources: explicit, vented, pattern_detected.
// Used by broadcast filter to exclude jobs that conflict with hard preferences.
table tech_preferences {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The tech this preference belongs to.
    int? tech_id? {
      table = "technicians"
    }
  
    // What kind of preference: geographic (zip/area), time (day/hour), or both (compound).
    enum preference_type {
      values = ["geographic", "time", "both"]
    }
  
    // Zip code or area name when preference_type is geographic or both. Null otherwise.
    text zip_or_area?
  
    // Day of week when preference_type is time or both. Null otherwise.
    enum day_of_week? {
      values = [
        "monday"
        "tuesday"
        "wednesday"
        "thursday"
        "friday"
        "saturday"
        "sunday"
      ]
    
    }
  
    // Time window start. HH:MM format. Null if not time-bounded.
    text time_window_start?
  
    // Time window end. HH:MM format. Null if not time-bounded.
    text time_window_end?
  
    // Hard = absolute respect (never broadcast). Soft = respect by default, edge cases offered.
    enum strength {
      values = ["hard", "soft"]
    }
  
    // How this preference was captured. Explicit = tech stated it directly. Vented = inferred from venting + confirmed. Pattern_detected = nightly pattern match + confirmed.
    enum source {
      values = ["explicit", "vented", "pattern_detected"]
    }
  
    // The original tech message that captured this preference. Useful context when reviewing.
    text captured_via_text?
  
    // Tech can toggle preferences off without deleting them.
    bool active?=true
  
    // Optional internal notes.
    text notes?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "tech_id"}]}
    {type: "btree", field: [{name: "active"}]}
  ]

  guid = "1erL14qug0DxVl_L-5Jv-JXDK5A"
}
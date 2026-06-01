// Manages service zones for scheduling and routing.
table service_zone {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The postal code for the service zone.
    text zip_code? filters=trim
  
    // The state of the service zone.
    text state? filters=trim
  
    // The broader market area (e.g., Nashville, Baton Rouge).
    text market? filters=trim
  
    // A specific geographical zone within a market (e.g., Northshore, Southshore).
    text zone? filters=trim
  
    // A micro grouping for routing density.
    text cluster? filters=trim
  
    // The primary technician assigned to this zone.
    text default_technician? filters=trim
  
    // A comma-separated list of technicians allowed to work in this zone.
    text allowed_technicians? filters=trim
  
    // Indicates if new jobs can be assigned to this zone.
    bool accept_new_jobs?
  
    // Indicates if jobs in this zone require manual approval before scheduling.
    bool requires_manual_review?
  
    // Any special routing or scheduling rules for the zone.
    text notes? filters=trim
  
    // Categorizes the zone (e.g., 'growth', 'standard', 'controlled').
    text zone_type? filters=trim
  
    // Minimum number of jobs required for scheduling in this zone.
    int min_jobs_required?
  
    // Maximum number of jobs allowed per scheduling window in this zone.
    int max_jobs_per_window?
  
    // Comma-separated list of allowed time windows for scheduling (e.g., '8-11,9-12').
    text allowed_time_windows? filters=trim
  
    // Comma-separated list of blocked time windows for scheduling (e.g., '3-6').
    text blocked_time_windows? filters=trim
  
    // Indicates if the service zone is currently active for scheduling.
    bool active?
  
    // Priority level for routing jobs in this zone (higher number = higher priority).
    int routing_priority?
  
    int technician_id?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "zip_code", op: "asc"}]}
  ]

  guid = "4h1nGWRnqDC0gSbgOwd9xAA_Row"
}
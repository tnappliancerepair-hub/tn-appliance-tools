// Manages technician assignments to specific clusters for routing.
table cluster_assignment {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The cluster identifier for assignment.
    text cluster? filters=trim
  
    // Reference to the assigned technician.
    int technician_id?
  
    // The rank of the technician within the cluster.
    int rank?
  
    // Indicates if the assignment is currently active.
    bool active?
  
    // Additional notes for the cluster assignment.
    text notes? filters=trim
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "cluster", op: "asc"}]}
    {type: "btree", field: [{name: "technician_id", op: "asc"}]}
  ]

  guid = "3NwUxLhAXQaornc6hTgRBG7GPto"
}
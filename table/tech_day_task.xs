// Non-customer schedule blocks for a tech (lunch, parts pickup, internal training, scheduled meetings). Distinct from tech_availability which is for day-offs and reduced hours. Surfaces on tech-daily-dashboard alongside jobs.
table tech_day_task {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    int technician_id
    text task_date
    text start_time?
    text end_time?
    text title
    text notes?
    text created_by?=office
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "WFNRpZz7oWGEsGbvSbwAFCkgSvM"
}
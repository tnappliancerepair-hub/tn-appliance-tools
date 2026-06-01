table tech_availability {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    int technician_id?
    date? blocked_date?
    text start_time? filters=trim
    text end_time? filters=trim
    text reason? filters=trim
    bool full_day_off?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "UDydAl8jXLxRYKNebI64d8izVm4"
}
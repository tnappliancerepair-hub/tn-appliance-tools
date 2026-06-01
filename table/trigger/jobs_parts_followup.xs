table_trigger jobs_parts_followup {
  table = "jobs"

  input {
    json new
    json old
    enum action {
      values = ["insert", "update", "delete", "truncate"]
    }
  
    text datasource
  }

  stack {
  }

  actions = {}
  guid = "HwMkk6a2F4Wk49f-ngXx-Kq0pQs"
}
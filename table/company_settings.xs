// Per-tenant flexible key/value settings
table company_settings {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    int company_id?
    text setting_key?
    text setting_value?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "1eOxYTzjY8T3tarhqXyVATc3m_Y"
}
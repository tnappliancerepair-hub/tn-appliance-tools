// Edit tech_availability record
query "tech_availability/{tech_availability_id}" verb=PATCH {
  api_group = "intake"

  input {
    int tech_availability_id? filters=min:1
    dblink {
      table = "tech_availability"
    }
  }

  stack {
    util.get_raw_input {
      encoding = "json"
      exclude_middleware = false
    } as $raw_input
  
    db.patch tech_availability {
      field_name = "id"
      field_value = $input.tech_availability_id
      data = `$input|pick:($raw_input|keys)`|filter_null|filter_empty_text
    } as $tech_availability
  }

  response = $tech_availability
  guid = "_qLwMMkUULxoG6_u5e52OyT_vKo"
}
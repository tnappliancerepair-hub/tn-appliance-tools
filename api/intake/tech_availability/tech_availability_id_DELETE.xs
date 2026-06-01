// Delete tech_availability record.
query "tech_availability/{tech_availability_id}" verb=DELETE {
  api_group = "intake"

  input {
    int tech_availability_id? filters=min:1
  }

  stack {
    db.del tech_availability {
      field_name = "id"
      field_value = $input.tech_availability_id
    }
  }

  response = null
  guid = "p-d3AAQAxvlZR-szJEI64947r6M"
}
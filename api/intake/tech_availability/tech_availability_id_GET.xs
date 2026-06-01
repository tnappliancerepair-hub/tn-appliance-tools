// Get tech_availability record
query "tech_availability/{tech_availability_id}" verb=GET {
  api_group = "intake"

  input {
    int tech_availability_id? filters=min:1
  }

  stack {
    db.get tech_availability {
      field_name = "id"
      field_value = $input.tech_availability_id
    } as $tech_availability
  
    precondition ($tech_availability != null) {
      error_type = "notfound"
      error = "Not Found."
    }
  }

  response = $tech_availability
  guid = "jGqc3Gto_O3MF6_YSVaipQ1lAWM"
}
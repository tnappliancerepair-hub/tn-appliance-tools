// Get technicians record
query "technicians/{technicians_id}" verb=GET {
  api_group = "intake"

  input {
    int technicians_id? filters=min:1
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.technicians_id
    } as $technicians
  
    precondition ($technicians != null) {
      error_type = "notfound"
      error = "Not Found."
    }
  }

  response = $technicians
  guid = "wGyDz5CrUtq5UcfUEm4Rg8SLTR0"
}
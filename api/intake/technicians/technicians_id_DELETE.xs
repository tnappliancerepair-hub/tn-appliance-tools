// Delete technicians record.
query "technicians/{technicians_id}" verb=DELETE {
  api_group = "intake"

  input {
    int technicians_id? filters=min:1
  }

  stack {
    db.del technicians {
      field_name = "id"
      field_value = $input.technicians_id
    }
  }

  response = null
  guid = "XahaCfPQr4OCTwvhmnqUCsZr4k0"
}
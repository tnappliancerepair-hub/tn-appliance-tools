// Edit technicians record
query "technicians/{technicians_id}" verb=PATCH {
  api_group = "intake"

  input {
    int technicians_id? filters=min:1
    dblink {
      table = "technicians"
    }
  }

  stack {
    util.get_raw_input {
      encoding = "json"
      exclude_middleware = false
    } as $raw_input
  
    db.patch technicians {
      field_name = "id"
      field_value = $input.technicians_id
      data = `$input|pick:($raw_input|keys)`|filter_null|filter_empty_text
    } as $technicians
  }

  response = $technicians
  guid = "M2uvia3Uci_v66bdz171rcAsIHc"
}
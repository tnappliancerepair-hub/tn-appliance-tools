// Edit intake_session record
query "intake_session/{intake_session_id}" verb=PATCH {
  api_group = "routing"

  input {
    int intake_session_id? filters=min:1
    dblink {
      table = "intake_session"
    }
  }

  stack {
    util.get_raw_input {
      encoding = "json"
      exclude_middleware = false
    } as $raw_input
  
    db.patch intake_session {
      field_name = "id"
      field_value = $input.intake_session_id
      data = `$input|pick:($raw_input|keys)`|filter_null|filter_empty_text
    } as $intake_session
  }

  response = $intake_session
  guid = "qPkt5ACraxviZpRV4dfpx7UZQxk"
}
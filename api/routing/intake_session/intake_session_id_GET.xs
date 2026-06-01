// Get intake_session record
query "intake_session/{intake_session_id}" verb=GET {
  api_group = "routing"

  input {
    int intake_session_id? filters=min:1
  }

  stack {
    db.get intake_session {
      field_name = "id"
      field_value = $input.intake_session_id
    } as $intake_session
  
    precondition ($intake_session != null) {
      error_type = "notfound"
      error = "Not Found."
    }
  }

  response = $intake_session
  guid = "uuQWeAwaXyH4-ty7TcNp3wQM704"
}
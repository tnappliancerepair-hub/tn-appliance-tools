// Delete intake_session record.
query "intake_session/{intake_session_id}" verb=DELETE {
  api_group = "routing"

  input {
    int intake_session_id? filters=min:1
  }

  stack {
    db.del intake_session {
      field_name = "id"
      field_value = $input.intake_session_id
    }
  }

  response = null
  guid = "aUfWVDHkB7hNYqL8j94-tTfXyYM"
}
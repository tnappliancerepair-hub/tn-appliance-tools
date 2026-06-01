// Add intake_session record
query intake_session verb=POST {
  api_group = "routing"

  input {
    dblink {
      table = "intake_session"
    }
  }

  stack {
    db.add intake_session {
      data = {created_at: "now"}
    } as $intake_session
  }

  response = $intake_session
  guid = "dNhqv1ia_50M6_ja6AGA1jrwGIY"
}
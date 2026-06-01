// Query all intake_session records
query intake_session verb=GET {
  api_group = "routing"

  input {
  }

  stack {
    db.query intake_session {
      return = {type: "list"}
    } as $intake_session
  }

  response = $intake_session
  guid = "UNRho-P9H4x5iZW3v0ChPtd9p3s"
}
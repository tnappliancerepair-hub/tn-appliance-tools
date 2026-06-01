// Query all tech_availability records
query tech_availability verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    db.query tech_availability {
      return = {type: "list"}
    } as $tech_availability
  }

  response = $tech_availability
  guid = "_RHDp6h1Afe8C0b6e5dZjSUHKJQ"
}
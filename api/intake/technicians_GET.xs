// Query all technicians records
query technicians verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    db.query technicians {
      return = {type: "list"}
    } as $technicians
  }

  response = $technicians
  guid = "GyQ3SGW9pOQ6AB5my4BZWU2a-uc"
}
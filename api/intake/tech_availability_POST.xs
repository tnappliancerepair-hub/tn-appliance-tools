// Add tech_availability record
query tech_availability verb=POST {
  api_group = "intake"

  input {
    dblink {
      table = "tech_availability"
    }
  }

  stack {
    db.add tech_availability {
      data = {created_at: "now"}
    } as $tech_availability
  }

  response = $tech_availability
  guid = "pfPXbYrpioHbvzAgvwwDE--5p3w"
}
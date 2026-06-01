// Add technicians record
query technicians verb=POST {
  api_group = "intake"

  input {
    dblink {
      table = "technicians"
    }
  }

  stack {
    db.add technicians {
      data = {created_at: "now"}
    } as $technicians
  }

  response = $technicians
  guid = "SlsI9-VI0o6hCNIeKFyg14w0RYE"
}
query verify_tech_pin verb=POST {
  api_group = "intake"

  input {
    int technician_id
    text pin
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech
  
    var $is_success {
      value = false
    }
  
    conditional {
      if ($tech != null && $tech.pin == $input.pin && $tech.active) {
        var.update $is_success {
          value = true
        }
      }
    }
  }

  response = {
    success      : $is_success
    technician_id: $tech != null ? $tech.id : 0
    first_name   : $tech != null ? $tech.first_name : ""
    last_name    : $tech != null ? $tech.last_name : ""
    active       : $tech != null ? $tech.active : false
  }

  guid = "F9lQruEjShpHVt3OM2bdagRyfP8"
}
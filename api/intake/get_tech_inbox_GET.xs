// Returns the tech's inbox: messages addressed to them, newest first.
// PIN-gated. Includes unread_count and total counts so the
// tech-daily-dashboard can render an "📥 N" badge.
query get_tech_inbox verb=GET {
  api_group = "intake"

  input {
    int tech_id
    text pin
    int? limit?
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    conditional {
      if ($tech == null) {
        return {
          value = { success: false, error: "tech_not_found" }
        }
      }
    }

    var $stored_pin {
      value = (($tech.pin ?? "")|to_text)
    }

    var $supplied_pin {
      value = (($input.pin ?? "")|to_text)
    }

    conditional {
      if ($stored_pin == "" || $stored_pin != $supplied_pin) {
        return {
          value = { success: false, error: "unauthorized" }
        }
      }
    }

    var $lim {
      value = ($input.limit ?? 50)
    }

    db.query tech_messages {
      where = $db.tech_messages.technician_id == $input.tech_id && $db.tech_messages.direction == "inbound"
      sort = {tech_messages.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows

    db.query tech_messages {
      where = $db.tech_messages.technician_id == $input.tech_id && $db.tech_messages.direction == "inbound" && $db.tech_messages.read_at == null
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $unread_rows
  }

  response = {
    success     : true
    tech_id     : $input.tech_id
    tech_name   : (($tech.first_name ?? "")|trim)
    messages    : $rows.items
    unread_count: ($unread_rows.items|count)
    total       : ($rows.items|count)
  }

  guid = "get-tech-inbox-v1"
}

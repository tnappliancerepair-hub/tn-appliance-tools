// Tech marks an inbox message read. PIN-gated. Sets read_at = now if
// not already read. Idempotent.
query mark_tech_inbox_message_read verb=POST {
  api_group = "intake"

  input {
    int tech_id
    text pin
    int message_id
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

    db.get tech_messages {
      field_name = "id"
      field_value = $input.message_id
    } as $msg

    conditional {
      if ($msg == null || $msg.technician_id != $input.tech_id) {
        return {
          value = { success: false, error: "message_not_found_or_unauthorized" }
        }
      }
    }

    conditional {
      if ($msg.read_at == null) {
        db.edit tech_messages {
          field_name = "id"
          field_value = $input.message_id
          data = { read_at: now }
        } as $updated
      }
    }
  }

  response = {
    success   : true
    message_id: $input.message_id
    read      : true
  }

  guid = "mark-tech-inbox-message-read-v1"
}

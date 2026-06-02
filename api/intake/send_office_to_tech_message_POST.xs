// Office composes a message to a specific tech. Auth: office_password.
// Writes tech_messages row + audit log. Telnyx SMS notification fires
// via send_sms (gated by CUSTOMER_FACING_ENABLED — internal/tech SMS
// always allowed).
query send_office_to_tech_message verb=POST {
  api_group = "intake"

  input {
    int tech_id
    text office_password
    text body
    text? sender_name?
    text? subject?
    int? related_job_id?
  }

  stack {
    var $supplied_pw {
      value = (($input.office_password ?? "")|to_text)
    }

    var $env_pw {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    conditional {
      if ($env_pw == "" || $env_pw != $supplied_pw) {
        return {
          value = { success: false, error: "unauthorized" }
        }
      }
    }

    var $body_clean {
      value = (($input.body ?? "")|trim)
    }

    conditional {
      if ($body_clean == "") {
        return {
          value = { success: false, error: "body_required" }
        }
      }
    }

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

    var $sender_name {
      value = (($input.sender_name ?? "Office")|trim)
    }

    var $subject_clean {
      value = (($input.subject ?? "")|trim)
    }

    db.add tech_messages {
      data = {
        technician_id       : $input.tech_id
        sender_role         : "office"
        sender_name         : $sender_name
        sender_id           : 0
        subject             : $subject_clean
        body                : $body_clean
        related_job_id      : ($input.related_job_id ?? 0)
        direction           : "inbound"
      }
    } as $msg

    db.add event_log {
      data = {
        action  : "office_to_tech_message_sent"
        metadata: ```
          {
            tech_id        : $input.tech_id
            message_id     : $msg.id
            sender_name    : $sender_name
            related_job_id : ($input.related_job_id ?? 0)
          }|json_encode
          ```
      }
    }
  }

  response = {
    success   : true
    message_id: $msg.id
    tech_id   : $input.tech_id
  }

  guid = "send-office-to-tech-message-v1"
}

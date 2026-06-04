// Teddy approves or declines a change request via SMS keyword
// (APPROVE-<id> / DECLINE-<id>). This endpoint applies the decision +
// SMSes the requester in Ant's voice. Optionally accepts a custom
// ant_reply message Teddy can write inline.
query change_request_action verb=POST {
  api_group = "intake"

  input {
    int change_request_id
    text action
    text? custom_reply?
    text? decided_by?
  }

  stack {
    precondition ($input.change_request_id > 0) {
      error_type = "inputerror"
      error = "change_request_id required"
    }
    var $action_clean { value = ($input.action|lower)|trim }
    precondition ($action_clean == "approve" || $action_clean == "decline" || $action_clean == "approved" || $action_clean == "declined") {
      error_type = "inputerror"
      error = "action must be approve or decline"
    }

    db.get change_requests {
      field_name = "id"
      field_value = $input.change_request_id
    } as $req

    precondition ($req != null) {
      error_type = "notfound"
      error = "change request not found"
    }

    var $status_new { value = ($action_clean == "approve" || $action_clean == "approved") ? "approved" : "declined" }
    var $name_clean { value = ($req.requester_name ?? "friend") }
    var $title_short { value = (($req.title ?? "")|substr:0:120) }

    var $default_approved_reply {
      value = "Hey " ~ $name_clean ~ " — Ant here. Took a look at \"" ~ $title_short ~ "\". Good call, getting it sorted now. I'll let you know when it's live."
    }
    var $default_declined_reply {
      value = "Hey " ~ $name_clean ~ " — Ant here. Looked into \"" ~ $title_short ~ "\". Going to leave the current setup for now — long story but happy to talk through it. Send more thoughts anytime."
    }

    var $custom_clean { value = (($input.custom_reply ?? "")|trim) }
    var $reply_body {
      value = ($custom_clean != "") ? $custom_clean : (($status_new == "approved") ? $default_approved_reply : $default_declined_reply)
    }

    db.edit change_requests {
      field_name = "id"
      field_value = $input.change_request_id
      data = {
        status                : $status_new
        decided_at_ms         : (now|to_ms)
        decided_by            : ($input.decided_by ?? "teddy")
        ant_reply_to_requester: $reply_body
      }
    }

    conditional {
      if (($req.requester_phone ?? "") != "") {
        api.request {
          url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
          method = "POST"
          params = {to: $req.requester_phone, message: $reply_body, recipient_role: ($req.requester_role ?? "office"), context: {source: "change_request_reply", change_request_id: ($req.id|to_text), status: $status_new}}
          headers = ["Content-Type: application/json"]
        } as $reply_sms
      }
    }

    db.add event_log {
      data = {
        action  : "change_request_decided"
        metadata: ({change_request_id: $req.id, status: $status_new, decided_by: ($input.decided_by ?? "teddy"), reply_chars: ($reply_body|length), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    change_request_id: $req.id
    status : $status_new
    ant_reply: $reply_body
  }

  guid = "change-request-action-v1"
}

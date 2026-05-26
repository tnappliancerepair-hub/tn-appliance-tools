// Thin event_log writer. Used by colony-loop agents that need to record
// a custom-named action with structured metadata so dedup queries can
// match on metadata.job_id (or whatever else). The built-in send_sms
// endpoint writes action="sms_sent" with a fixed metadata shape — not
// enough for per-job dedup. This is the escape hatch.
query record_event_log verb=POST {
  api_group = "intake"

  input {
    text action
    text? metadata_json?
  }

  stack {
    var $action_clean {
      value = (($input.action ?? "")|trim)
    }

    precondition ($action_clean != "") {
      error_type = "inputerror"
      error      = "action is required"
    }

    var $raw {
      value = ($input.metadata_json ?? "{}")
    }

    var $meta_obj {
      value = $raw|json_decode
    }

    db.add event_log {
      data = {
        action  : $action_clean
        metadata: $meta_obj
      }
    } as $row
  }

  response = {
    success    : true
    event_id   : $row.id
  }

  guid = "record-event-log-v1"
}

// Records inbound Vapi call events + emits VAPI_CALL_COMPLETED on
// end-of-call so downstream agents can act on the transcript.
query record_vapi_call verb=POST {
  api_group = "intake"

  input {
    text caller_number
    text? called_number?
    text? vapi_call_id?
    text? event_type?
    text? transcript?
    text? summary?
  }

  stack {
    var $caller {
      value = ($input.caller_number ?? "")|trim
    }

    precondition ($caller != "") {
      error_type = "inputerror"
      error      = "caller_number is required"
    }

    var $event {
      value = (($input.event_type ?? "")|trim|lower)
    }

    var $audit_meta {
      value = {
        caller_number  : $caller
        called_number  : ($input.called_number ?? "")
        vapi_call_id   : ($input.vapi_call_id ?? "")
        event_type     : $event
        transcript     : (($input.transcript ?? "")|substr:0:2000)
        summary        : (($input.summary ?? "")|substr:0:500)
      }
    }

    var $audit_json {
      value = $audit_meta|json_encode
    }

    db.add event_log {
      data = {
        action   : "vapi_call_event"
        metadata : $audit_json
      }
    } as $audit_row

    var $signal_id { value = 0 }

    conditional {
      if ($event == "call-end" || $event == "end-of-call-report" || $event == "end-of-call") {
        db.add colony_signals {
          data = {
            signal_type     : "VAPI_CALL_COMPLETED"
            signal_strength : 75
            source_colony   : "vapi_webhook"
            target_colonies : ""
            payload         : $audit_json
          }
        } as $signal_row

        var.update $signal_id {
          value = ($signal_row.id ?? 0)
        }
      }
    }
  }

  response = {
    success      : true
    event_type   : $event
    signal_id    : $signal_id
  }

  guid = "record-vapi-call-v1"
}

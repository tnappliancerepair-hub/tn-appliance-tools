// Danielle (or any office user) marks a Vapi call as reviewed once
// she's checked it. Writes a 'call_reviewed' event_log row keyed to
// vapi_call_id so the recent-calls list can filter out already-handled.
query mark_call_reviewed verb=POST {
  api_group = "intake"

  input {
    text vapi_call_id
    text? reviewed_by?
    text? note?
  }

  stack {
    precondition (($input.vapi_call_id ?? "")|trim != "") {
      error_type = "inputerror"
      error = "vapi_call_id required"
    }
    var $call_id_clean { value = $input.vapi_call_id|trim }
    var $reviewer { value = (($input.reviewed_by ?? "office")|trim) }
    var $note_clean { value = (($input.note ?? "")|trim) }

    db.add event_log {
      data = {
        action  : "call_reviewed"
        metadata: ({vapi_call_id: $call_id_clean, reviewed_by: $reviewer, note: $note_clean, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success      : true
    vapi_call_id : $call_id_clean
    ack          : "Marked reviewed."
  }

  guid = "mark-call-reviewed-v1"
}

//  Marks a voicemail as cleared from the queue. Office Today reads the
//  "cleared" flag in the original event_log row's metadata to filter
//  completed callbacks out of the list.
// 
//  Implementation: append a clearing event with action="vapi_voicemail_cleared_<event_id>"
//  so the office_today query can simply check for its existence.
query clear_voicemail verb=POST {
  api_group = "intake"

  input {
    int event_log_id
    text? cleared_by?
    text? note?
  }

  stack {
    precondition ($input.event_log_id > 0) {
      error_type = "inputerror"
      error = "event_log_id required"
    }
  
    var $cleared_action {
      value = "vapi_voicemail_cleared_" ~ ($input.event_log_id|to_text)
    }
  
    db.add event_log {
      data = {
        action  : $cleared_action
        metadata: {
        source_event_id: $input.event_log_id
        cleared_by     : (($input.cleared_by ?? "Teddy")|trim)
        note           : (($input.note ?? "")|trim)
      }
      }
    } as $clear_audit
  }

  response = {success: true, cleared: true}
  guid = "clear-voicemail-v1"
}
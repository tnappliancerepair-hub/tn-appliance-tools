//  Marks a captured callback (callback_request event_log row) as handled so it
//  drops off the office callbacks queue. Writes a callback_handled row keyed by
//  the original row id (cb_id). No customer SMS. Mirrors office_quick_fill.
//
//  XS rules: no em-dashes, no try/catch, data = { } for db.add, ?? + |trim
//  only in value = (...).
query mark_callback_handled verb=POST {
  api_group = "intake"

  input {
    int callback_id
    text? actor?
  }

  stack {
    precondition ($input.callback_id > 0) {
      error_type = "inputerror"
      error = "callback_id required"
    }

    db.add event_log {
      data = {
        action  : "callback_handled"
        metadata : {
          cb_id : $input.callback_id
          actor : (($input.actor ?? "office")|trim)
        }
      }
    } as $log
  }

  response = {
    success     : true
    callback_id : $input.callback_id
  }

  guid = "mark-callback-handled-v1"
}

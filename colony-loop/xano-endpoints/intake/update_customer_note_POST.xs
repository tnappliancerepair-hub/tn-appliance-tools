// Appends a free-form note to the customer record. Used by the phone
// brain to capture preferences, gate codes, complaints, anything
// learned during a call.
//
// Strategy: rather than overwrite a customer field (race-prone), we
// write the note to event_log keyed to the customer_id. Office UIs
// surface these via the customer-search join.
query update_customer_note verb=POST {
  api_group = "intake"

  input {
    int customer_id
    text note filters=trim
    text? source?
  }

  stack {
    precondition ($input.customer_id > 0 && $input.note != "") {
      error_type = "inputerror"
      error      = "customer_id + note required"
    }

    db.add event_log {
      data = {
        action  : "customer_note"
        metadata: {
          customer_id : $input.customer_id
          note        : ($input.note|substr:0:1000)
          source      : ($input.source ?? "phone_brain")
          recorded_at : now|to_ms
        }|json_encode
      }
    } as $audit
  }

  response = {
    success      : true
    event_log_id : $audit.id
  }

  guid = "update-customer-note-v1"
}

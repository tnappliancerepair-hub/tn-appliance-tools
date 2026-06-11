// Danielle clicks "Handled" on an inbox item. Writes a key-anchored
// event_log row so the frontend can auto-dismiss the item from the
// inbox going forward.
query mark_inbox_item_handled verb=POST {
  api_group = "intake"

  input {
    text item_key
    text? handled_by?
    text? note?
  }

  stack {
    precondition ((($input.item_key ?? "")|trim) != "") {
      error_type = "inputerror"
      error = "item_key required"
    }

    db.add event_log {
      data = {
        action  : "inbox_item_handled"
        metadata: ({item_key: $input.item_key|trim, handled_by: (($input.handled_by ?? "office")|trim), note: (($input.note ?? "")|trim), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success : true
    item_key: $input.item_key|trim
    ack     : "Handled."
  }

  guid = "mark-inbox-item-handled-v1"
}

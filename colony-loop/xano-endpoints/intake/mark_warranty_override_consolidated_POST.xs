// Marks a warranty_requirement_override event_log row as 'consolidated'
// (rolled into the JSON baseline) or 'reverted' (rejected by reviewer).
// Once marked, the row is filtered out of the live merge in
// get-warranty-requirements (only 'active' overrides are applied).
//
// Inputs:
//   event_log_id — the override row to update
//   new_status   — 'consolidated' or 'reverted'
//   reviewer_user_id (optional) — who made the decision
//   notes (optional) — free-text reason
//
// Implementation: writes a NEW event_log row with action =
// "warranty_override_status_change" carrying the original ID. The
// override merge in the Netlify function reads BOTH the original
// override row AND any subsequent status_change rows for it, takes
// the latest status. This avoids editing an immutable audit row.
query mark_warranty_override_consolidated verb=POST {
  api_group = "intake"

  input {
    int event_log_id
    text new_status filters=trim
    int? reviewer_user_id?
    text? notes?
  }

  stack {
    precondition ($input.event_log_id > 0 && ($input.new_status == "consolidated" || $input.new_status == "reverted" || $input.new_status == "active")) {
      error_type = "inputerror"
      error      = "event_log_id + new_status (active/consolidated/reverted) required"
    }

    db.get event_log {
      field_name  = "id"
      field_value = $input.event_log_id
    } as $orig

    precondition ($orig != null) {
      error_type = "notfound"
      error      = "override event_log row not found"
    }

    var $payload {
      value = {
        override_event_log_id : $input.event_log_id
        new_status            : $input.new_status
        reviewer_user_id      : ($input.reviewer_user_id ?? 0)
        notes                 : ($input.notes ?? "")
        recorded_at_ms        : now|to_ms
      }
    }

    db.add event_log {
      data = {
        action  : "warranty_override_status_change"
        metadata: $payload|json_encode
      }
    } as $audit
  }

  response = {
    success            : true
    override_id        : $input.event_log_id
    new_status         : $input.new_status
    audit_log_id       : $audit.id
  }

  guid = "mark-warranty-override-consolidated-v1"
}

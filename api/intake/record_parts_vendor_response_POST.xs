// Called by the Ant Parts Follow-Up voice agent at the end of an
// outbound vendor call. Captures the structured outcome so the office
// + parts ledger can act on it without replay.
query record_parts_vendor_response verb=POST {
  api_group = "intake"

  input {
    int job_id
    text supplier
    text? order_number?
    text outcome
    text? tracking_number?
    text? new_eta_human?
    text? substitute_suggested?
    text? notes?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.add event_log {
      data = {
        action  : "parts_vendor_response"
        metadata: ({job_id: $input.job_id, supplier: $input.supplier, order_number: ($input.order_number ?? ""), outcome: $input.outcome, tracking_number: ($input.tracking_number ?? ""), new_eta_human: ($input.new_eta_human ?? ""), substitute_suggested: ($input.substitute_suggested ?? ""), notes: ($input.notes ?? ""), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    outcome: $input.outcome
    logged_at_ms: (now|to_ms)
  }

  guid = "record-parts-vendor-response-v1"
}

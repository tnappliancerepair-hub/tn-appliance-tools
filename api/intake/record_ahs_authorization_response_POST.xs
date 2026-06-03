// Called by the Ant AHS Authorization Update voice agent at the end of
// an outbound authorization call. Captures the structured outcome so
// Danielle + office can act on it without listening to the call recording.
query record_ahs_authorization_response verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? claim_number?
    text outcome
    text? authorization_number?
    int? approved_amount_cents?
    text? denial_reason?
    text? notes?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.add event_log {
      data = {
        action  : "ahs_authorization_response"
        metadata: ({job_id: $input.job_id, claim_number: ($input.claim_number ?? ""), outcome: $input.outcome, authorization_number: ($input.authorization_number ?? ""), approved_amount_cents: ($input.approved_amount_cents ?? 0), denial_reason: ($input.denial_reason ?? ""), notes: ($input.notes ?? ""), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    outcome: $input.outcome
    logged_at_ms: (now|to_ms)
  }

  guid = "record-ahs-authorization-response-v1"
}

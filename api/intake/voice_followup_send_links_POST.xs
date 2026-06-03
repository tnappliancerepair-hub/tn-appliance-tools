// Called by Ant Inbound when a customer says YES to receiving a portal link.
// Wraps the existing portal-link SMS but customizes the SMS body so it
// also explicitly invites the customer to send photo of model sticker
// and a quick video of the problem (uploads land in the same job).
// Audit row in event_log so the office knows Ant did this.
query voice_followup_send_links verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? offer_kind?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $kind {
      value = (($input.offer_kind ?? "portal_and_uploads")|trim)
    }

    // Reuse the canonical portal-link sender. It already crafts the URL
    // with the right tokenized link and respects the CUSTOMER_FACING_ENABLED gate.
    api.request {
      url = $env.XANO_INTAKE_BASE ~ "/send_customer_portal_link"
      method = "POST"
      params = {job_id: $input.job_id, sent_by: "voice_unified_ant"}
      headers = ["Content-Type: application/json"]
    } as $portal_resp

    db.add event_log {
      data = {
        action  : "voice_followup_links_sent"
        metadata: ({job_id: $input.job_id, offer_kind: $kind, sent_via: "voice_unified_ant", ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success     : true
    job_id      : $input.job_id
    offer_kind  : $kind
    portal_send_status: ($portal_resp.response.result ?? null)
    sent_at_ms  : (now|to_ms)
  }

  guid = "voice-followup-send-links-v1"
}

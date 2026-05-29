// Records a portal engagement event used by the channel-preference
// engine to learn whether the customer prefers portal vs SMS.
//
// Called from customer-portal.html on:
//   - page load with valid auth → "portal_viewed"
//   - any action button tap (My Parts Arrived, reschedule confirm,
//     submit notes, etc.) → "portal_action_taken"
//
// SMS-direction signals (sms_reply_received / portal_link_unread) are
// written by other code paths (Telnyx inbound webhook + a future
// reminder agent respectively).
query record_portal_event verb=POST {
  api_group = "intake"

  input {
    int customer_id
    text event filters=trim  // "portal_viewed" | "portal_action_taken"
    int? job_id?
    text? action_name?       // for portal_action_taken — what they tapped
  }

  stack {
    precondition ($input.customer_id > 0 && $input.event != "") {
      error_type = "inputerror"
      error      = "customer_id + event required"
    }

    var $allowed_events {
      value = ["portal_viewed", "portal_action_taken"]
    }
    precondition ($input.event in $allowed_events) {
      error_type = "inputerror"
      error      = "event must be portal_viewed or portal_action_taken"
    }

    var $meta {
      value = {
        customer_id : $input.customer_id
        job_id      : ($input.job_id ?? 0)
        action_name : ($input.action_name ?? "")
        recorded_at : now|to_ms
      }
    }

    db.add event_log {
      data = {
        action  : $input.event
        metadata: $meta|json_encode
      }
    } as $audit
  }

  response = {
    success      : true
    event_log_id : $audit.id
  }

  guid = "record-portal-event-v1"
}

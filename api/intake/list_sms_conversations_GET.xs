// list_sms_conversations — backs the office Messages inbox (HCP-style).
// Returns the recent customer-direction SMS rows (inbound + outbound) so the
// page can group them into per-customer conversations, newest first, and flag
// the ones where the customer texted last and nobody has replied.
// Modeled exactly on get_sms_pulse's proven query (no XS footguns); just
// returns the full list instead of a 20-row sample.
query list_sms_conversations verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days { value = ($input.days_back ?? 14) }
    var $cutoff_ms { value = ((now|to_ms) - ($days * 86400000)) }
    var $cutoff_ts { value = ($cutoff_ms / 1000)|to_timestamp }

    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && ($db.event_log.action == "sms_sent" || $db.event_log.action == "inbound_customer_sms_received" || $db.event_log.action == "customer_sms_reply" || $db.event_log.action == "dropped_customer_sms" || $db.event_log.action == "feedback_sms_sent")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 300}}
    } as $rows

    var $out { value = [] }
    foreach ($rows.items) {
      each as $r {
        var $row {
          value = {
            id        : $r.id
            action    : ($r.action ?? "")
            created_at: $r.created_at
            metadata  : $r.metadata
          }
        }
        var.update $out { value = $out|push:$row }
      }
    }
  }

  response = {
    success: true
    count  : ($out|count)
    rows   : $out
  }

  guid = "list-sms-conversations-v1"
}

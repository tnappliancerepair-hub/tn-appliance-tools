// Returns recent warranty_claim_action_persisted event_log rows for the
// Danielle warranty dashboard (warranty-review.html). Each row carries
// job_id, vendor, escalate flag, high_flags count, and the full
// claim_action_text from the architect's vendor-specific Claude output.
query list_warranty_claim_actions verb=GET {
  api_group = "intake"

  input {
    int? days_back?
    int? per_page?
  }

  stack {
    var $days {
      value = ($input.days_back ?? 30)
    }
  
    var $pp {
      value = ($input.per_page ?? 100)
    }
  
    var $cutoff {
      value = (now|to_ms) - ($days * 86400000)
    }
  
    db.query event_log {
      where = $db.event_log.action == "warranty_claim_action_persisted" && $db.event_log.created_at >= $cutoff
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $pp}}
    } as $rows
  
    var $out {
      value = []
    }
  
    foreach ($rows.items) {
      each as $r {
        var $entry {
          value = {
            id               : $r.id
            created_at       : $r.created_at
            job_id           : ($r.metadata.job_id ?? 0)
            specialty        : ($r.metadata.specialty ?? "")
            vendor           : ($r.metadata.vendor ?? "")
            escalate         : ($r.metadata.escalate ?? false)
            high_flags       : ($r.metadata.high_flags ?? 0)
            claim_action_text: ($r.metadata.claim_action_text ?? "")
            generated_by     : ($r.metadata.generated_by ?? "")
          }
        }
      
        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {
    success  : true
    days_back: $days
    count    : $out|count
    rows     : $out
  }

  guid = "list-warranty-claim-actions-v1"
}
// Returns all parts_intel_response event_log rows for a given job_id.
// Used by parts_decision_due.js to aggregate supplier responses after
// the hold-and-re-emit window expires.
query get_parts_intel_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "parts_intel_response" && $db.event_log.metadata.job_id == $input.job_id
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows

    var $out {
      value = []
    }

    foreach ($rows.items) {
      each as $r {
        var $entry {
          value = {
            id          : $r.id
            created_at  : $r.created_at
            metadata    : $r.metadata
          }
        }
        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {
    success: true
    count  : ($out|count)
    rows   : $out
  }

  guid = "get-parts-intel-for-job-v1"
}

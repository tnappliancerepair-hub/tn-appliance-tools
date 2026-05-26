// Lists AHS-source jobs currently stuck at scheduling_status="not_ready".
// Backfill script (colony-loop/scripts/backfill-ahs-scheduling.js) pages
// through this endpoint and enqueues a scheduling_queue propose row for each.
// Filter:
//   source_type        == "ahs_email"
//   scheduling_status  == "not_ready"
// Order: created_at desc (newest first - they likely have fresher contact info).
query list_ahs_backlog verb=GET {
  api_group = "intake"

  input {
    int? page?
    int? per_page?
  }

  stack {
    var $p {
      value = ($input.page ?? 1)
    }

    var $pp {
      value = ($input.per_page ?? 100)
    }

    db.query jobs {
      where = $db.jobs.source_type == "ahs_email" && $db.jobs.scheduling_status == "not_ready"
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: $p, per_page: $pp}}
    } as $rows

    var $out {
      value = []
    }

    foreach ($rows.items) {
      each as $j {
        var $entry {
          value = {
            id                      : $j.id
            customer_id             : ($j.customer_id ?? null)
            appliance_type          : ($j.appliance_type ?? "")
            warranty_company        : ($j.warranty_company ?? "")
            claim_number            : ($j.claim_number ?? "")
            customer_preference_text: ($j.customer_preference_text ?? "")
            dispatch_date           : ($j.dispatch_date ?? null)
            created_at              : ($j.created_at ?? null)
          }
        }
        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {
    success : true
    page    : $p
    per_page: $pp
    count   : ($out|count)
    jobs    : $out
  }

  guid = "list-ahs-backlog-v1"
}

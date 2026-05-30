// Powers office-kanban.html - the live "jobs moving by themselves"
// board for Danielle.
//
// Returns a flat list of every job that should appear on the board:
//   * scheduling_status in (not_ready, needs_scheduled, scheduled,
//     in_progress, awaiting_parts, held)  -- all active states
//   * OR scheduling_status=completed AND warranty_company set AND
//     updated_at in the last 7 days  (recent warranty completions
//     that still need submission, even if "done" from a tech POV)
//
// Capped at 300 rows for sanity. The page buckets client-side into
// columns and polls every 30s.
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query get_office_kanban verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $window_days {
      value = ($input.days_back ?? 7)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $window_cutoff_ms {
      value = ($now_ms - ($window_days * 86400000))
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "needs_scheduled" || $db.jobs.scheduling_status == "scheduled" || $db.jobs.scheduling_status == "in_progress" || $db.jobs.scheduling_status == "awaiting_parts" || $db.jobs.scheduling_status == "held" || ($db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at >= $window_cutoff_ms)
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 300}}
    } as $job_rows

    var $items {
      value = []
    }

    foreach ($job_rows.items) {
      each as $j {
        db.get customer {
          field_name = "id"
          field_value = ($j.customer_id ?? 0)
        } as $cust

        var $cust_first {
          value = (($cust ?? {first_name: ""}).first_name ?? "")
        }

        var $cust_last {
          value = (($cust ?? {last_name: ""}).last_name ?? "")
        }

        var $row {
          value = {
            id: $j.id
            customer_id: ($j.customer_id ?? 0)
            customer_first: (($cust_first ?? "")|trim)
            customer_last: (($cust_last ?? "")|trim)
            appliance: (($j.appliance_type ?? "")|trim)
            brand: (($j.brand ?? "")|trim)
            problem_summary: (($j.problem_summary ?? "")|trim)
            scheduling_status: (($j.scheduling_status ?? "")|trim)
            current_status: (($j.current_status ?? "")|trim)
            parts_status: (($j.parts_status ?? "")|trim)
            warranty_company: (($j.warranty_company ?? "")|trim)
            claim_number: (($j.claim_number ?? "")|trim)
            intake_source: (($j.intake_source ?? "")|trim)
            parallel_mode: ($j.parallel_mode ?? false)
            scheduled_start: ($j.scheduled_start ?? 0)
            technician_id: ($j.technician_id ?? null)
            service_city: (($j.service_city ?? "")|trim)
            service_zip: (($j.service_zip ?? "")|trim)
            job_completed_at: ($j.job_completed_at ?? 0)
            created_at: ($j.created_at ?? 0)
          }
        }

        var.update $items {
          value = ($items|push:$row)
        }
      }
    }
  }

  response = {
    success: true
    count: ($items|count)
    items: $items
    fetched_at_ms: $now_ms
  }

  guid = "get-office-kanban-v1"
}

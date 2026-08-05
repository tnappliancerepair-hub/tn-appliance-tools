//  get_office_kanban_v2 - PERF CANDIDATE for get_office_kanban (2026-08-05).
//  IDENTICAL output to get_office_kanban; the ONLY change is the where clause:
//  the 7-way status OR is collapsed to an index-friendly in [...]. Everything
//  else (the completed-recent clause, sort, per_page, per-job shaping, response
//  shape) is byte-for-byte the same, so the two MUST return the same job set.
//
//  This is a THROWAWAY test endpoint. The runbook (docs/kanban-perf-runbook-
//  2026-08-05.md) pushes it, diffs its output vs the live v1, and times both. If
//  identical + faster -> copy this where into the real get_office_kanban and push
//  that; then delete this file + endpoint. If in [...] doesn't parse or the rows
//  differ -> discard this, the live board is untouched.
//
//  XS rules: no em-dashes, no backticks, no try/catch, no raw if,
//  every filter paren-wrapped, ?? only in value = (...).
query get_office_kanban_v2 verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $window_days {
      value = ($input.days_back ?? 60)
    }

    var $now_ms {
      value = now|to_ms
    }

    var $window_cutoff_ms {
      value = ($now_ms - ($window_days * 86400000))
    }

    db.query jobs {
      where = ($db.jobs.scheduling_status in ["not_ready", "needs_scheduled", "scheduled", "in_progress", "awaiting_parts", "held", "no_fix_possible"]) || ($db.jobs.scheduling_status == "completed" && ($db.jobs.job_completed_at >= $window_cutoff_ms || $db.jobs.created_at >= $window_cutoff_ms))
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 800}}
    } as $job_rows

    var $items {
      value = []
    }

    foreach ($job_rows.items) {
      each as $j {
        var $cust_first {
          value = (($j.customer_first ?? "")|trim)
        }

        var $cust_last {
          value = (($j.customer_last ?? "")|trim)
        }

        var $cust_phone {
          value = (($j.customer_phone ?? "")|trim)
        }

        conditional {
          if ($cust_first == "" && $cust_last == "") {
            db.get customer {
              field_name = "id"
              field_value = ($j.customer_id ?? 0)
            } as $cust

            var.update $cust_first {
              value = (($cust ?? {first_name: ""}).first_name ?? "")
            }

            var.update $cust_last {
              value = (($cust ?? {last_name: ""}).last_name ?? "")
            }

            var.update $cust_phone {
              value = (($cust ?? {phone: ""}).phone ?? "")
            }
          }
        }

        var $row {
          value = {
            id               : $j.id
            customer_id      : ($j.customer_id ?? 0)
            customer_first   : (($cust_first ?? "")|trim)
            customer_last    : (($cust_last ?? "")|trim)
            appliance        : (($j.appliance_type ?? "")|trim)
            brand            : (($j.brand ?? "")|trim)
            problem_summary  : (($j.problem_summary ?? "")|trim)
            scheduling_status: (($j.scheduling_status ?? "")|trim)
            current_status   : (($j.current_status ?? "")|trim)
            parts_status     : (($j.parts_status ?? "")|trim)
            parts_eta_date   : (($j.parts_eta_date ?? "")|trim)
            customer_phone   : (($cust_phone ?? "")|trim)
            warranty_company : (($j.warranty_company ?? "")|trim)
            claim_number     : (($j.claim_number ?? "")|trim)
            dispatch_source_id : (($j.dispatch_source_id ?? "")|trim)
            intake_source    : (($j.intake_source ?? "")|trim)
            parallel_mode    : ($j.parallel_mode ?? false)
            scheduled_start  : ($j.scheduled_start ?? 0)
            service_eta_window : (($j.service_eta_window ?? "")|trim)
            customer_preference_text : (($j.customer_preference_text ?? "")|trim)
            technician_id    : ($j.technician_id ?? null)
            service_city     : (($j.service_city ?? "")|trim)
            service_zip      : (($j.service_zip ?? "")|trim)
            service_state    : (($j.service_state ?? "")|trim)
            office_stage     : (($j.office_stage ?? "")|trim)
            job_completed_at : ($j.job_completed_at ?? 0)
            created_at       : ($j.created_at ?? 0)
          }
        }

        var.update $items {
          value = $items|push:$row
        }
      }
    }
  }

  response = {
    success      : true
    count        : $items|count
    items        : $items
    fetched_at_ms: $now_ms
  }
}

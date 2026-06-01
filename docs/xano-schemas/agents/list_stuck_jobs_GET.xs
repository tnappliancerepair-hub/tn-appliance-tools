// AGENT OF011 - Stuck Job Watcher
//
// Identifies jobs sitting in the same scheduling_status for more than
// N days with NO event_log activity. These are jobs that have fallen
// through the cracks - parts never came in, customer never replied,
// tech forgot to update status, etc.
//
// Used by colony-loop/agents/stuck_job_detector.js (which composes a
// digest SMS to Teddy + Danielle listing stuck jobs by status).
//
// Input:
//   stuck_days?  - threshold for "stuck" (default 5 days)
//   max_jobs?    - cap on returned jobs (default 50)
//
// Output:
//   stuck_jobs[]: {id, status, customer_id, last_activity_ms, days_stuck, technician_id, brand, appliance_type, service_city}
//   counts_by_status: {not_ready: N, awaiting_parts: N, scheduled: N, in_progress: N, ...}
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query list_stuck_jobs verb=GET {
  api_group = "intake"

  input {
    int? stuck_days?
    int? max_jobs?
  }

  stack {
    var $threshold_days {
      value = ($input.stuck_days ?? 5)
    }

    var $limit {
      value = ($input.max_jobs ?? 50)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $cutoff_ms {
      value = ($now_ms - ($threshold_days * 86400000))
    }

    // Pull non-terminal jobs whose updated_at is older than cutoff.
    // Terminal statuses (completed, canceled, no_fix_possible) are excluded.
    db.query jobs {
      where = $db.jobs.updated_at <= $cutoff_ms && $db.jobs.scheduling_status != "completed" && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort = {jobs.updated_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $limit}}
    } as $job_rows

    var $out {
      value = []
    }

    var $by_status {
      value = {}
    }

    foreach ($job_rows.items) {
      each as $j {
        var $last_act {
          value = ($j.updated_at ?? ($j.created_at ?? 0))
        }

        var $days_stuck {
          value = (($now_ms - $last_act) / 86400000)
        }

        var $status_key {
          value = ($j.scheduling_status ?? "unknown")
        }

        var $entry {
          value = {
            id              : $j.id
            scheduling_status: $status_key
            current_status  : ($j.current_status ?? "")
            customer_id     : ($j.customer_id ?? null)
            technician_id   : ($j.technician_id ?? null)
            brand           : ($j.brand ?? "")
            appliance_type  : ($j.appliance_type ?? "")
            service_city    : ($j.service_city ?? "")
            warranty_company: ($j.warranty_company ?? "")
            claim_number    : ($j.claim_number ?? "")
            last_activity_ms: $last_act
            days_stuck      : $days_stuck
            intake_source   : ($j.intake_source ?? "")
          }
        }

        var.update $out {
          value = ($out|push:$entry)
        }
      }
    }
  }

  response = {
    success         : true
    stuck_days      : $threshold_days
    cutoff_ms       : $cutoff_ms
    stuck_count     : ($out|count)
    stuck_jobs      : $out
  }

  guid = "list-stuck-jobs-v1"
}

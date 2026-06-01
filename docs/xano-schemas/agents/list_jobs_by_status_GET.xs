// SUPPORT ENDPOINT - list_jobs_by_status
//
// Generic helper referenced by colony-loop/agents/stuck_job_detector.js
// and other agents that need to scan jobs in a specific scheduling_status.
//
// Filters on scheduling_status only. Caller may also restrict by
// intake_source if provided.
//
// Input:
//   status        - required, the scheduling_status enum value
//                   (not_ready, scheduled, in_progress, awaiting_parts,
//                   completed, canceled, held, no_fix_possible, etc.)
//   intake_source? - optional filter (hcp, email_servicepower, email_ahs,
//                    email_allstate, web_chat, manual, phone_call)
//   limit?        - max rows returned (default 200, cap 500)
//
// Output:
//   jobs[]: lightweight job summary suitable for digest / triage.
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query list_jobs_by_status verb=GET {
  api_group = "intake"

  input {
    text status filters=trim
    text? intake_source? filters=trim
    int? limit?
  }

  stack {
    precondition ($input.status != "") {
      error_type = "inputerror"
      error = "status is required"
    }

    var $req_status {
      value = $input.status
    }

    var $req_source {
      value = ($input.intake_source ?? "")
    }

    var $cap {
      value = ($input.limit ?? 200)
    }

    conditional {
      if ($cap > 500) {
        var.update $cap {
          value = 500
        }
      }
    }

    var $use_source_filter {
      value = ($req_source != "")
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == $req_status && ($use_source_filter == false || $db.jobs.intake_source == $req_source)
      sort = {jobs.updated_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $job_rows

    var $out {
      value = []
    }

    foreach ($job_rows.items) {
      each as $j {
        var $entry {
          value = {
            id               : $j.id
            scheduling_status: ($j.scheduling_status ?? "")
            current_status   : ($j.current_status ?? "")
            customer_id      : ($j.customer_id ?? null)
            technician_id    : ($j.technician_id ?? null)
            brand            : ($j.brand ?? "")
            appliance_type   : ($j.appliance_type ?? "")
            service_city     : ($j.service_city ?? "")
            service_zip      : ($j.service_zip ?? "")
            intake_source    : ($j.intake_source ?? "")
            warranty_company : ($j.warranty_company ?? "")
            claim_number     : ($j.claim_number ?? "")
            scheduled_start  : ($j.scheduled_start ?? null)
            parts_status     : ($j.parts_status ?? "")
            updated_at       : ($j.updated_at ?? null)
            created_at       : ($j.created_at ?? null)
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
    status_filter   : $req_status
    source_filter   : $req_source
    count           : ($out|count)
    jobs            : $out
  }

  guid = "list-jobs-by-status-v1"
}

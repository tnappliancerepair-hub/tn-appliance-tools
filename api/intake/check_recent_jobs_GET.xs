query check_recent_jobs verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $cap {
      value = ($input.limit ?? 10)
    }
  
    db.query jobs {
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $rows
  
    var $out {
      value = []
    }
  
    foreach ($rows.items) {
      each as $j {
        var $entry {
          value = {
            id               : $j.id
            created_at       : $j.created_at
            current_status   : ($j.current_status ?? "")
            scheduling_status: ($j.scheduling_status ?? "")
            scheduled_start  : ($j.scheduled_start ?? null)
            technician_id    : ($j.technician_id ?? null)
            customer_type    : ($j.customer_type ?? "")
            intake_source    : ($j.intake_source ?? "")
            source_type      : ($j.source_type ?? "")
            warranty_company : ($j.warranty_company ?? "")
            appliance_type   : ($j.appliance_type ?? "")
            job_status       : ($j.job_status ?? "")
            triage_status    : ($j.triage_status ?? "")
            hcp_assigned_to  : ($j.hcp_assigned_to ?? "")
          }
        }
      
        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {success: true, count: $out|count, jobs: $out}
  guid = "check-recent-jobs-v1"
}
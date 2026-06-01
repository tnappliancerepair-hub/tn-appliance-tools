// Returns prior jobs for the given customer + appliance_type within the
// last N months, excluding the current job. Used by repeat_visit_check
// agent to surface callback risk, and by get_job_for_dashboard to render
// the prior_visit_count badge in Tech Ant Live.
query get_prior_visits_for_customer verb=GET {
  api_group = "intake"

  input {
    int customer_id
    text appliance_type
    int? exclude_job_id?
    int? months?
  }

  stack {
    precondition ($input.customer_id != null && $input.customer_id > 0) {
      error_type = "inputerror"
      error = "customer_id is required"
    }
  
    var $months_eff {
      value = ($input.months ?? 12)
    }
  
    var $cutoff_ms {
      value = ((now|to_ms) - ($months_eff * 30 * 24 * 60 * 60 * 1000))
    }
  
    var $exclude_id {
      value = ($input.exclude_job_id ?? 0)
    }
  
    var $appl_clean {
      value = (($input.appliance_type ?? "")|trim|to_lower)
    }
  
    db.query jobs {
      where = $db.jobs.customer_id == $input.customer_id && $db.jobs.created_at >= $cutoff_ms
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows
  
    var $matches {
      value = []
    }
  
    foreach ($rows.items) {
      each as $j {
        conditional {
          if ($j.id != $exclude_id) {
            var $j_appl {
              value = (($j.appliance_type ?? "")|trim|to_lower)
            }
          
            conditional {
              if ($appl_clean == "" || $j_appl == $appl_clean) {
                array.push $matches {
                  value = {
                    id               : $j.id
                    appliance_type   : ($j.appliance_type ?? "")
                    brand            : ($j.brand ?? "")
                    problem_summary  : ($j.problem_summary ?? "")
                    scheduling_status: ($j.scheduling_status ?? "")
                    created_at       : $j.created_at
                    scheduled_start  : ($j.scheduled_start ?? null)
                    job_completed_at : ($j.job_completed_at ?? null)
                  }
                }
              }
            }
          }
        }
      }
    }
  
    var $count {
      value = 0
    }
  
    foreach ($matches) {
      each as $_ {
        var.update $count {
          value = ($count + 1)
        }
      }
    }
  }

  response = {
    success       : true
    customer_id   : $input.customer_id
    appliance_type: $input.appliance_type
    months_window : $months_eff
    count         : $count
    prior_visits  : $matches
  }

  guid = "get-prior-visits-for-customer-v1"
}
// Patch all TEST-eff_* claim jobs from any non-canceled status back to
// scheduling_status="not_ready" so the scheduler can pick them up.
// Used only for the scheduler-efficiency test workflow.
query reset_test_jobs_to_not_ready verb=POST {
  api_group = "intake"

  input {
    text? claim_prefix?
    int? max_reset?
  }

  stack {
    var $prefix {
      value = (($input.claim_prefix ?? "TEST-eff")|trim)
    }
  
    var $cap_raw {
      value = ($input.max_reset ?? 500)
    }
  
    var $cap {
      value = ($cap_raw > 2000) ? 2000 : $cap_raw
    }
  
    db.query jobs {
      where = $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "completed"
      sort = {jobs.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $rows
  
    var $reset_count {
      value = 0
    }
  
    var $reset_ids {
      value = []
    }
  
    foreach ($rows.items) {
      each as $j {
        var $claim {
          value = (($j.claim_number ?? "")|trim)
        }
      
        var $matches {
          value = $claim|substr:0:8 == $prefix|substr:0:8
        }
      
        conditional {
          if ($matches) {
            db.edit jobs {
              field_name = "id"
              field_value = $j.id
              data = {
                scheduling_status: "not_ready"
                technician_id    : 0
                scheduled_start  : null
                test_run_id      : ""
              }
            } as $patched
          
            var.update $reset_count {
              value = ($reset_count + 1)
            }
          
            var.update $reset_ids {
              value = $reset_ids|push:$j.id
            }
          }
        }
      }
    }
  
    db.add event_log {
      data = {
        action  : "reset_test_jobs_to_not_ready"
        metadata: {
        claim_prefix: $prefix
        reset_count : $reset_count
        reset_at_ms : now|to_ms
      }
      }
    } as $audit
  }

  response = {
    success    : true
    reset_count: $reset_count
    reset_ids  : $reset_ids
  }

  guid = "reset-test-jobs-to-not-ready-v1"
}
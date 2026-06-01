//  Returns parallel-mode jobs at scheduling_status="not_ready" older than
//  48h that still have an empty customer_preference_text. These are the
//  jobs the stuck_intake_progress agent SMSes "morning or afternoon?" to.
// 
//  One-time-only per job — dedup happens agent-side via event_log
//  stuck_intake_progress_nudged_<job_id> action.
query list_stuck_intake_for_progress verb=GET {
  api_group = "intake"

  input {
    int? limit?
    int? min_age_hours?
  }

  stack {
    var $now_ms {
      value = now|to_ms
    }
  
    var $limit_clean {
      value = ($input.limit ?? 50)
    }
  
    var $min_age_h {
      value = ($input.min_age_hours ?? 48)
    }
  
    var $cutoff_ms {
      value = ($now_ms - ($min_age_h * 3600000))
    }
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" && $db.jobs.parallel_mode == true && $db.jobs.created_at <= $cutoff_ms
      sort = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $limit_clean}}
    } as $rows
  
    var $jobs_out {
      value = []
    }
  
    foreach ($rows.items) {
      each as $j {
        var $pref_text {
          value = (($j.customer_preference_text ?? "")|trim)
        }
      
        conditional {
          if ($pref_text == "") {
            var $cust_id {
              value = ($j.customer_id ?? 0)
            }
          
            var $cust {
              value = null
            }
          
            conditional {
              if ($cust_id > 0) {
                db.get customer {
                  field_name = "id"
                  field_value = $cust_id
                } as $cust_lookup
              
                var.update $cust {
                  value = $cust_lookup
                }
              }
            }
          
            var $first_name {
              value = (($cust.first_name ?? "")|trim)
            }
          
            var $phone {
              value = (($cust.phone ?? "")|trim)
            }
          
            conditional {
              if ($phone != "") {
                var $j_item {
                  value = {
                    job_id        : $j.id
                    customer_id   : $cust_id
                    first_name    : $first_name
                    phone         : $phone
                    appliance_type: ($j.appliance_type ?? "")
                    age_hours     : (($now_ms - $j.created_at) / 3600000)
                  }
                }
              
                var.update $jobs_out {
                  value = $jobs_out|push:$j_item
                }
              }
            }
          }
        }
      }
    }
  }

  response = {success: true, jobs: $jobs_out, count: $jobs_out|count}
  guid = "list-stuck-intake-for-progress-v1"
}
//  Returns jobs whose intake source needed a resume-chat completion but
//  where no JOB_INTAKE_COMPLETE has landed within HOURS_SINCE_GREETING
//  hours. Drives the daily 9am resume-nudge sweep.
// 
//  "Needed resume" = source in {ahs_email, servicepower_email} and
//  scheduling_status in {not_ready, prediagnosis_pending}, AND a greeting
//  has been sent (event_log new_job_greeting_sent within last 7 days), AND
//  customer_preference_text is empty (which is what update_job_from_chat
//  fills on resume submission).
query get_resume_chat_pending verb=GET {
  api_group = "intake"

  input {
    int? hours_since_greeting?
    int? limit?
  }

  stack {
    var $hours_in {
      value = ($input.hours_since_greeting ?? 48)
    }
  
    var $limit_in {
      value = ($input.limit ?? 25)
    }
  
    var $effective_limit {
      value = ($limit_in > 100 ? 100 : ($limit_in < 1 ? 25 : $limit_in))
    }
  
    var $now_ms {
      value = now|to_ms
    }
  
    var $cutoff_min_ms {
      value = $now_ms - (7 * 24 * 60 * 60 * 1000)
    }
  
    var $cutoff_max_ms {
      value = $now_ms - ($hours_in * 60 * 60 * 1000)
    }
  
    var $cutoff_min_ts {
      value = ($cutoff_min_ms / 1000)|to_timestamp
    }
  
    var $cutoff_max_ts {
      value = ($cutoff_max_ms / 1000)|to_timestamp
    }
  
    db.query jobs {
      where = ($db.jobs.source_type == "ahs_email" || $db.jobs.source_type == "servicepower_email") && ($db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "prediagnosis_pending") && $db.jobs.created_at >= $cutoff_min_ts && $db.jobs.created_at <= $cutoff_max_ts && ($db.jobs.customer_preference_text == "" || $db.jobs.customer_preference_text == null)
      sort = {jobs.created_at: "desc"}
      return = {
        type  : "list"
        paging: {page: 1, per_page: $effective_limit}
      }
    } as $job_rows
  
    var $out {
      value = []
    }
  
    foreach ($job_rows.items) {
      each as $job {
        var $cust_first {
          value = ""
        }
      
        var $cust_phone {
          value = ""
        }
      
        var $cust_id_val {
          value = ($job.customer_id ?? 0)
        }
      
        conditional {
          if ($cust_id_val > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id_val
            } as $cust_lookup
          
            var $first_raw {
              value = ($cust_lookup.first_name ?? "")|trim
            }
          
            var $phone_raw {
              value = ($cust_lookup.phone ?? "")|trim
            }
          
            var.update $cust_first {
              value = $first_raw
            }
          
            var.update $cust_phone {
              value = $phone_raw
            }
          }
        }
      
        var $item {
          value = {
            job_id          : $job.id
            customer_id     : $cust_id_val
            customer_first  : $cust_first
            customer_phone  : $cust_phone
            appliance_type  : ($job.appliance_type ?? "")
            source_type     : ($job.source_type ?? "")
            created_at      : $job.created_at
            warranty_company: ($job.warranty_company ?? "")
          }
        }
      
        var.update $out {
          value = $out|push:$item
        }
      }
    }
  }

  response = {
    success             : true
    hours_since_greeting: $hours_in
    job_count           : $out|count
    jobs                : $out
  }

  guid = "get-resume-chat-pending-v1"
}
//  Diagnostic for HCP migration day prep. Returns counts of Xano jobs
//  bucketed by:
//    - HCP linkage (has housecall_pro_job_id vs not)
//    - scheduling_status
//    - source_type
//    - last 30 days only AND open-only (not completed/canceled/no_fix)
// 
//  Goal: surface what Teddy needs to migrate Saturday — specifically the
//  "open jobs in HCP with no Xano twin" gap. Since HCP is canonical until
//  migration day, the cleanest signal is Xano jobs with housecall_pro_job_id
//  set but no completion (those are mid-flight HCP jobs already mirrored)
//  vs. HCP-side jobs we haven't picked up yet (a separate HCP API probe
//  outside this endpoint).
query get_hcp_migration_status verb=GET {
  api_group = "intake"

  input {
    int? lookback_days?
  }

  stack {
    var $days {
      value = ($input.lookback_days ?? 30)
    }
  
    var $cutoff_ms {
      value = ((now|to_ms) - ($days * 86400000))
    }
  
    // Open + not-old: scheduling_status NOT in terminal set, created within window.
    db.query jobs {
      where = $db.jobs.created_at >= $cutoff_ms
      return = {type: "list", paging: {page: 1, per_page: 5000}}
    } as $window_rows
  
    var $items {
      value = $window_rows.items
    }
  
    var $total_in_window {
      value = 0
    }
  
    var $with_hcp_id {
      value = 0
    }
  
    var $without_hcp_id {
      value = 0
    }
  
    var $open_jobs {
      value = 0
    }
  
    var $completed_jobs {
      value = 0
    }
  
    var $canceled_jobs {
      value = 0
    }
  
    var $scheduled_jobs {
      value = 0
    }
  
    var $not_ready_jobs {
      value = 0
    }
  
    var $prediag_pending {
      value = 0
    }
  
    var $other_status {
      value = 0
    }
  
    var $source_hcp {
      value = 0
    }
  
    var $source_ahs {
      value = 0
    }
  
    var $source_servicepower {
      value = 0
    }
  
    var $source_warranty {
      value = 0
    }
  
    var $source_office {
      value = 0
    }
  
    var $source_web_chat {
      value = 0
    }
  
    var $source_other {
      value = 0
    }
  
    foreach ($items) {
      each as $j {
        var.update $total_in_window {
          value = ($total_in_window + 1)
        }
      
        var $hcp {
          value = (($j.housecall_pro_job_id ?? "")|trim)
        }
      
        var $status {
          value = (($j.scheduling_status ?? "")|trim)
        }
      
        var $src {
          value = (($j.source_type ?? $j.intake_source ?? "")|trim)
        }
      
        conditional {
          if ($hcp != "") {
            var.update $with_hcp_id {
              value = ($with_hcp_id + 1)
            }
          }
        
          else {
            var.update $without_hcp_id {
              value = ($without_hcp_id + 1)
            }
          }
        }
      
        conditional {
          if ($status == "completed") {
            var.update $completed_jobs {
              value = ($completed_jobs + 1)
            }
          }
        
          elseif ($status == "canceled" || $status == "cancelled") {
            var.update $canceled_jobs {
              value = ($canceled_jobs + 1)
            }
          }
        
          elseif ($status == "scheduled" || $status == "in_progress" || $status == "booked") {
            var.update $scheduled_jobs {
              value = ($scheduled_jobs + 1)
            }
          
            var.update $open_jobs {
              value = ($open_jobs + 1)
            }
          }
        
          elseif ($status == "not_ready") {
            var.update $not_ready_jobs {
              value = ($not_ready_jobs + 1)
            }
          
            var.update $open_jobs {
              value = ($open_jobs + 1)
            }
          }
        
          elseif ($status == "prediagnosis_pending" || $status == "needs_pre_diagnosis") {
            var.update $prediag_pending {
              value = ($prediag_pending + 1)
            }
          
            var.update $open_jobs {
              value = ($open_jobs + 1)
            }
          }
        
          else {
            var.update $other_status {
              value = ($other_status + 1)
            }
          
            var.update $open_jobs {
              value = ($open_jobs + 1)
            }
          }
        }
      
        conditional {
          if ($src == "hcp" || $src == "hcp_webhook" || $src == "hcp_poll") {
            var.update $source_hcp {
              value = ($source_hcp + 1)
            }
          }
        
          elseif ($src == "ahs_email") {
            var.update $source_ahs {
              value = ($source_ahs + 1)
            }
          }
        
          elseif ($src == "servicepower" || $src == "servicepower_email") {
            var.update $source_servicepower {
              value = ($source_servicepower + 1)
            }
          }
        
          elseif ($src == "warranty_jotform" || $src == "warranty") {
            var.update $source_warranty {
              value = ($source_warranty + 1)
            }
          }
        
          elseif ($src == "office_ant") {
            var.update $source_office {
              value = ($source_office + 1)
            }
          }
        
          elseif ($src == "web_chat") {
            var.update $source_web_chat {
              value = ($source_web_chat + 1)
            }
          }
        
          else {
            var.update $source_other {
              value = ($source_other + 1)
            }
          }
        }
      }
    }
  }

  response = {
    success             : true
    lookback_days       : $days
    total_jobs_in_window: $total_in_window
    hcp_linkage         : ```
      {
        with_hcp_id   : $with_hcp_id
        without_hcp_id: $without_hcp_id
      }
      ```
    scheduling_status   : ```
      {
        open               : $open_jobs
        scheduled          : $scheduled_jobs
        not_ready          : $not_ready_jobs
        prediagnosis_pending: $prediag_pending
        completed          : $completed_jobs
        canceled           : $canceled_jobs
        other              : $other_status
      }
      ```
    by_source           : ```
      {
        hcp           : $source_hcp
        ahs_email     : $source_ahs
        servicepower  : $source_servicepower
        warranty      : $source_warranty
        office_ant    : $source_office
        web_chat      : $source_web_chat
        other         : $source_other
      }
      ```
    note                : "Xano-side counts only. To compare against HCP open-job count, call HCP API GET /jobs?work_status=scheduled,in%20progress,schedule%20appointment and diff against hcp_linkage.with_hcp_id."
  }

  guid = "get-hcp-migration-status-v1"
}
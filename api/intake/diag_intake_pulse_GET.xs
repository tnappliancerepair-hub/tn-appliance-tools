//  Diagnostic: counts intake-related event_log activity over the last
//  N hours, and distinguishes synthetic-test claim numbers from real
//  vendor dispatches by inspecting the metadata.claim_number field.
// 
//  Returns:
//    ahs_real_count, ahs_synth_count, ahs_total
//    sp_real_count, sp_synth_count, sp_total
//    parallel_real_count, parallel_synth_count, parallel_total
query diag_intake_pulse verb=GET {
  api_group = "intake"

  input {
    int? hours_back?
  }

  stack {
    var $hours {
      value = ($input.hours_back ?? 48)
    }
  
    var $cutoff_ms {
      value = ((now|to_ms) - ($hours * 3600000))
    }
  
    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }
  
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && ($db.event_log.action == "ahs_email_intake_received" || $db.event_log.action == "ahs_email_intake_rejected" || $db.event_log.action == "servicepower_email_intake_received" || $db.event_log.action == "parallel_job_created_from_email" || $db.event_log.action == "create_job_from_email_dedup_skip" || $db.event_log.action == "create_job_from_email_dry_run")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows
  
    var $ahs_real {
      value = 0
    }
  
    var $ahs_synth {
      value = 0
    }
  
    var $sp_real {
      value = 0
    }
  
    var $sp_synth {
      value = 0
    }
  
    var $parallel_real {
      value = 0
    }
  
    var $parallel_synth {
      value = 0
    }
  
    var $rejected {
      value = 0
    }
  
    var $dedup_skips {
      value = 0
    }
  
    var $dry_runs {
      value = 0
    }
  
    foreach ($rows.items) {
      each as $r {
        var $action {
          value = ($r.action ?? "")
        }
      
        var $claim_raw {
          value = (($r.metadata.claim_number ?? "")|trim|to_lower)
        }
      
        var $is_synth {
          value = ($claim_raw|contains:"test-office") || ($claim_raw|contains:"test-")
        }
      
        conditional {
          if ($action == "ahs_email_intake_received") {
            conditional {
              if ($is_synth) {
                var.update $ahs_synth {
                  value = ($ahs_synth + 1)
                }
              }
            
              else {
                var.update $ahs_real {
                  value = ($ahs_real  + 1)
                }
              }
            }
          }
        }
      
        conditional {
          if ($action == "ahs_email_intake_rejected") {
            var.update $rejected {
              value = ($rejected + 1)
            }
          }
        }
      
        conditional {
          if ($action == "servicepower_email_intake_received") {
            conditional {
              if ($is_synth) {
                var.update $sp_synth {
                  value = ($sp_synth + 1)
                }
              }
            
              else {
                var.update $sp_real {
                  value = ($sp_real  + 1)
                }
              }
            }
          }
        }
      
        conditional {
          if ($action == "parallel_job_created_from_email") {
            conditional {
              if ($is_synth) {
                var.update $parallel_synth {
                  value = ($parallel_synth + 1)
                }
              }
            
              else {
                var.update $parallel_real {
                  value = ($parallel_real  + 1)
                }
              }
            }
          }
        }
      
        conditional {
          if ($action == "create_job_from_email_dedup_skip") {
            var.update $dedup_skips {
              value = ($dedup_skips + 1)
            }
          }
        }
      
        conditional {
          if ($action == "create_job_from_email_dry_run") {
            var.update $dry_runs {
              value = ($dry_runs + 1)
            }
          }
        }
      }
    }
  }

  response = {
    success             : true
    hours_back          : $hours
    ahs_real_count      : $ahs_real
    ahs_synth_count     : $ahs_synth
    ahs_rejected_count  : $rejected
    sp_real_count       : $sp_real
    sp_synth_count      : $sp_synth
    parallel_real_count : $parallel_real
    parallel_synth_count: $parallel_synth
    dedup_skips         : $dedup_skips
    dry_runs            : $dry_runs
  }

  guid = "diag-intake-pulse-v1"
}
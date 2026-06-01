//  ONE-SHOT FIXER (2026-06-02): cancel synthetic test debris that landed in
//  Needs Scheduled with empty customer info. Targets jobs with:
//    - intake_source = "ahs_email"
//    - scheduling_status = "not_ready"
//    - created_at > cutoff_ms (default 5/31 00:00 CT)
//    - customer first_name == "" (the marker — real AHS dispatches have names)
// 
//  Flips to scheduling_status="canceled" with notes_internal appended. Reversible.
query cancel_empty_synthetic_jobs verb=POST {
  api_group = "intake"

  input {
    int? cutoff_ms?
    bool? dry_run?
    int? max_cancel?
  }

  stack {
    var $cutoff_eff {
      value = ($input.cutoff_ms ?? 1780203600000)
    }
  
    var $cap_eff {
      value = ($input.max_cancel ?? 200)
    }
  
    var $is_dry {
      value = ($input.dry_run ?? false)
    }
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" && $db.jobs.intake_source == "ahs_email" && $db.jobs.created_at > $cutoff_eff
      sort = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
    } as $candidate_rows
  
    var $candidates {
      value = $candidate_rows.items
    }
  
    var $candidate_count {
      value = 0
    }
  
    var $canceled_count {
      value = 0
    }
  
    var $skipped_real_count {
      value = 0
    }
  
    foreach ($candidates) {
      each as $row {
        var.update $candidate_count {
          value = ($candidate_count + 1)
        }
      
        db.get customer {
          field_name = "id"
          field_value = ($row.customer_id ?? 0)
        } as $cust_row
      
        var $cust_first {
          value = (($cust_row.first_name ?? "")|trim)
        }
      
        conditional {
          if ($cust_first == "") {
            conditional {
              if (!$is_dry) {
                var $prior_notes {
                  value = ($row.notes_internal ?? "")
                }
              
                var $marker {
                  value = """
                    
                    ---
                    CANCELED 2026-06-02: synthetic test debris (empty customer). intake_source=ahs_email.
                    """
                }
              
                db.edit jobs {
                  field_name = "id"
                  field_value = $row.id
                  data = {
                    scheduling_status: "canceled"
                    current_status   : "canceled"
                    notes_internal   : ($prior_notes ~ $marker)
                  }
                }
              
                var.update $canceled_count {
                  value = ($canceled_count + 1)
                }
              }
            }
          }
        
          else {
            var.update $skipped_real_count {
              value = ($skipped_real_count + 1)
            }
          }
        }
      }
    }
  
    db.add event_log {
      data = {
        action  : "synthetic_test_debris_canceled"
        metadata: {
        cutoff_ms      : $cutoff_eff
        dry_run        : $is_dry
        candidates_seen: $candidate_count
        canceled_count : $canceled_count
        skipped_real   : $skipped_real_count
      }
      }
    } as $log
  }

  response = {
    success        : true
    cutoff_ms      : $cutoff_eff
    dry_run        : $is_dry
    candidates_seen: $candidate_count
    canceled_count : $canceled_count
    skipped_real   : $skipped_real_count
  }

  guid = "cancel-empty-synthetic-jobs-v1"
}
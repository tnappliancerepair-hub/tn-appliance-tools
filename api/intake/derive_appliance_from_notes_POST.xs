//  One-shot appliance_type cleanup (Fix B 2026-05-08).
// 
//  Background: hcp_backfill_recent_jobs (2026-05-07) and hcp_poll_recent_jobs
//  derived appliance_type from HCP `tags` arrays. Empirical evidence
//  (Build E verification 2026-05-08): the HCP /jobs LIST endpoint returns
//  tags=[] for many records that the per-job /jobs/<id> endpoint shows
//  populated. Result: 119 of 215 HCP-sourced Xano jobs have null
//  appliance_type today.
// 
//  This endpoint scans HCP-sourced jobs with null appliance_type, looks
//  for appliance keywords in notes_internal, and fills in appliance_type.
//  Idempotent — re-running on already-populated jobs is safe (we only
//  query null-appliance candidates).
// 
//  Companion to reclassify_ahs_jobs from Build B. Same pattern: dry_run
//  default, limit cap, sanity gate at >200 matches.
// 
//  Fix A (in-line fallback in backfill+poll endpoints) prevents NEW jobs
//  from needing this. Fix B (this endpoint) cleans up the historical 62
//  jobs that gained nothing from the buggy tag-derivation.
query derive_appliance_from_notes verb=POST {
  api_group = "intake"

  input {
    // Default true so first-run is safe-by-default.
    bool? dry_run?
  
    // Hard cap on matches collected per call. Default 500.
    int? limit?
  
    // Sanity-gate bypass for real-runs >200 matches.
    bool? override_overmatch?
  }

  stack {
    var $dry_run {
      value = ($input.dry_run ?? true)
    }
  
    var $limit {
      value = ($input.limit ?? 500)
    }
  
    var $override_overmatch {
      value = ($input.override_overmatch ?? false)
    }
  
    // Counters / outputs.
    var $total_matched {
      value = 0
    }
  
    var $total_updated {
      value = 0
    }
  
    var $results {
      value = []
    }
  
    var $stop {
      value = false
    }
  
    // PASS 1: query HCP-sourced jobs with null appliance_type and
    // notes_internal populated.
    // NOTE: do NOT use paging clause — db.query with paging returns a
    // wrapper object that breaks foreach (gotcha from Build B 2026-05-07).
    db.query jobs {
      where = (($db.jobs.appliance_type == null) || ($db.jobs.appliance_type == "")) && ($db.jobs.intake_source == "hcp_backfill" || $db.jobs.intake_source == "hcp_poll" || $db.jobs.intake_source == "hcp_webhook")
      return = {type: "list"}
    } as $candidates
  
    foreach ($candidates) {
      each as $job {
        conditional {
          if ($stop != true) {
            var $notes {
              value = ($job.notes_internal ?? "")
            }
          
            conditional {
              if ($notes != "") {
                var $notes_lower {
                  value = $notes|to_lower
                }
              
                // Same priority order as Fix A — most specific first.
                // "refrigerator" before "fridge"; "dishwasher" before
                // "washer" so dish-washer doesn't false-match washer;
                // "range/oven/stove/cooktop" grouped.
                var $derived {
                  value = ""
                }
              
                conditional {
                  if (($notes_lower|contains:"refrigerator") || ($notes_lower|contains:"fridge")) {
                    var.update $derived {
                      value = "refrigerator"
                    }
                  }
                }
              
                conditional {
                  if (($derived == "") && ($notes_lower|contains:"dishwasher")) {
                    var.update $derived {
                      value = "dishwasher"
                    }
                  }
                }
              
                conditional {
                  if (($derived == "") && (($notes_lower|contains:"washer") || ($notes_lower|contains:"washing machine"))) {
                    var.update $derived {
                      value = "washer"
                    }
                  }
                }
              
                conditional {
                  if (($derived == "") && ($notes_lower|contains:"dryer")) {
                    var.update $derived {
                      value = "dryer"
                    }
                  }
                }
              
                conditional {
                  if (($derived == "") && (($notes_lower|contains:"range") || ($notes_lower|contains:"oven") || ($notes_lower|contains:"stove") || ($notes_lower|contains:"cooktop"))) {
                    var.update $derived {
                      value = "range"
                    }
                  }
                }
              
                conditional {
                  if (($derived == "") && ($notes_lower|contains:"microwave")) {
                    var.update $derived {
                      value = "microwave"
                    }
                  }
                }
              
                conditional {
                  if ($derived != "") {
                    var.update $total_matched {
                      value = $total_matched + 1
                    }
                  
                    var $excerpt {
                      value = $notes|substr:0:200
                    }
                  
                    var.update $results {
                      value = $results
                        |push:```
                          {
                            job_id            : $job.id
                            hcp_job_id        : ($job.housecall_pro_job_id ?? "")
                            customer_id       : ($job.customer_id ?? 0)
                            intake_source     : ($job.intake_source ?? "")
                            proposed_appliance: $derived
                            notes_excerpt     : $excerpt
                          }
                          ```
                    }
                  
                    conditional {
                      if ($total_matched >= $limit) {
                        var.update $stop {
                          value = true
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    // Sanity gate.
    var $refused {
      value = false
    }
  
    conditional {
      if (($dry_run != true) && ($total_matched > 200) && ($override_overmatch != true)) {
        var.update $refused {
          value = true
        }
      }
    }
  
    // PASS 2: apply edits, build sample IDs for audit log.
    var $sample_ids {
      value = []
    }
  
    var $sample_ids_count {
      value = 0
    }
  
    conditional {
      if (($dry_run != true) && ($refused != true)) {
        foreach ($results) {
          each as $r {
            db.edit jobs {
              field_name = "id"
              field_value = $r.job_id
              data = {appliance_type: $r.proposed_appliance}
            } as $edited_job
          
            var.update $total_updated {
              value = $total_updated + 1
            }
          
            conditional {
              if ($sample_ids_count < 10) {
                var.update $sample_ids {
                  value = $sample_ids|push:$r.job_id
                }
              
                var.update $sample_ids_count {
                  value = $sample_ids_count + 1
                }
              }
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : "derive_appliance_from_notes_run"
            metadata: {
            dry_run           : false
            total_matched     : $total_matched
            total_updated     : $total_updated
            limit             : $limit
            override_overmatch: $override_overmatch
            sample_job_ids    : $sample_ids
          }
          }
        } as $log_run
      }
    }
  
    // Build sample_records (first 20) for response. Object-literal push
    // to avoid associative-array gotcha.
    var $sample_records {
      value = []
    }
  
    var $sample_records_count {
      value = 0
    }
  
    foreach ($results) {
      each as $r {
        conditional {
          if ($sample_records_count < 20) {
            var.update $sample_records {
              value = $sample_records
                |push:```
                  {
                    job_id            : $r.job_id
                    hcp_job_id        : $r.hcp_job_id
                    customer_id       : $r.customer_id
                    intake_source     : $r.intake_source
                    proposed_appliance: $r.proposed_appliance
                    notes_excerpt     : $r.notes_excerpt
                  }
                  ```
            }
          
            var.update $sample_records_count {
              value = $sample_records_count + 1
            }
          }
        }
      }
    }
  }

  response = {
    success       : ($refused != true)
    refused       : $refused
    refusal_reason: ($refused == true) ? "overmatch_gate: total_matched > 200 without override_overmatch=true" : ""
    dry_run       : $dry_run
    total_matched : $total_matched
    total_updated : $total_updated
    full_count    : $total_matched
    sample_records: $sample_records
    limit_applied : $limit
    limit_hit     : ($total_matched >= $limit)
  }

  guid = "derive-appliance-from-notes-2026-05-08"
}
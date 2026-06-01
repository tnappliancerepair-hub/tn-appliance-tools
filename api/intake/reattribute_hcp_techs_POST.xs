//  One-shot tech reattribution cleanup (Build C 2026-05-08).
// 
//  Background: hcp_backfill_recent_jobs (2026-05-07) and the original
//  hcp_poll_recent_jobs both hardcoded technician_id: 1 on insert.
//  Result: ~213 HCP-sourced jobs are attributed to Teddy regardless of
//  who HCP actually assigned. Distorts tech-load dashboards and
//  load-monitor calculations.
// 
//  This endpoint scans HCP-sourced jobs where technician_id=1 AND
//  hcp_assigned_to is populated. For each, looks up the correct
//  technician via technicians.hcp_id. If the looked-up id is NOT 1,
//  updates technician_id to the correct value. Genuinely-Teddy jobs
//  (lookup yields id=1) become no-ops. Unknown pro_ids are skipped
//  + logged.
// 
//  Conservative: does NOT touch jobs without HCP assignment, jobs
//  already on a non-Teddy tech, or jobs from non-HCP intake sources.
// 
//  Same shape as reclassify_ahs_jobs / derive_appliance_from_notes:
//  dry_run default, limit cap, sanity gate at >200 matches.
query reattribute_hcp_techs verb=POST {
  api_group = "intake"

  input {
    bool? dry_run?
    int? limit?
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
  
    var $total_candidates {
      value = 0
    }
  
    var $total_matched {
      value = 0
    }
  
    var $total_updated {
      value = 0
    }
  
    var $total_unknown {
      value = 0
    }
  
    var $total_already_teddy {
      value = 0
    }
  
    var $results {
      value = []
    }
  
    var $stop {
      value = false
    }
  
    // Pull all candidates (no paging — gotcha from prior builds).
    db.query jobs {
      where = $db.jobs.technician_id == 1 && $db.jobs.hcp_assigned_to != null && $db.jobs.hcp_assigned_to != "" && ($db.jobs.intake_source == "hcp_backfill" || $db.jobs.intake_source == "hcp_poll" || $db.jobs.intake_source == "hcp_webhook")
      return = {type: "list"}
    } as $candidates
  
    foreach ($candidates) {
      each as $job {
        conditional {
          if ($stop != true) {
            var.update $total_candidates {
              value = $total_candidates + 1
            }
          
            db.query technicians {
              where = $db.technicians.hcp_id == $job.hcp_assigned_to && $db.technicians.active == true
              return = {type: "single"}
            } as $tech_match
          
            conditional {
              if ($tech_match == null) {
                // Unknown pro_id — log + skip
                var.update $total_unknown {
                  value = $total_unknown + 1
                }
              
                db.add event_log {
                  data = {
                    action  : "reattribute_hcp_techs_unknown_pro_id"
                    metadata: {
                    job_id    : $job.id
                    hcp_pro_id: $job.hcp_assigned_to
                    hcp_job_id: ($job.housecall_pro_job_id ?? "")
                  }
                  }
                } as $log_unknown
              }
            
              else {
                conditional {
                  if ($tech_match.id == 1) {
                    // Genuinely Teddy — no change needed
                    var.update $total_already_teddy {
                      value = $total_already_teddy + 1
                    }
                  }
                
                  else {
                    // Misattributed — collect for update
                    var.update $total_matched {
                      value = $total_matched + 1
                    }
                  
                    var.update $results {
                      value = $results
                        |push:```
                          {
                            job_id       : $job.id
                            hcp_job_id   : ($job.housecall_pro_job_id ?? "")
                            hcp_pro_id   : $job.hcp_assigned_to
                            new_tech_id  : $tech_match.id
                            new_tech_name: ((($tech_match.first_name ?? "") ~ " " ~ ($tech_match.last_name ?? ""))|trim)
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
  
    // PASS 2: apply updates if real run.
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
              data = {technician_id: $r.new_tech_id}
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
            action  : "reattribute_hcp_techs_run"
            metadata: {
            dry_run            : false
            total_candidates   : $total_candidates
            total_matched      : $total_matched
            total_updated      : $total_updated
            total_unknown      : $total_unknown
            total_already_teddy: $total_already_teddy
            limit              : $limit
            override_overmatch : $override_overmatch
            sample_job_ids     : $sample_ids
          }
          }
        } as $log_run
      }
    }
  
    // Build sample_records (first 20) — object-literal push.
    var $sample_records {
      value = []
    }
  
    var $sample_records_count {
      value = 0
    }
  
    // Compute breakdown by destination tech_id.
    var $breakdown_tech_2 {
      value = 0
    }
  
    var $breakdown_tech_3 {
      value = 0
    }
  
    var $breakdown_tech_4 {
      value = 0
    }
  
    var $breakdown_tech_5 {
      value = 0
    }
  
    var $breakdown_tech_6 {
      value = 0
    }
  
    var $breakdown_other {
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
                    job_id       : $r.job_id
                    hcp_job_id   : $r.hcp_job_id
                    hcp_pro_id   : $r.hcp_pro_id
                    new_tech_id  : $r.new_tech_id
                    new_tech_name: $r.new_tech_name
                  }
                  ```
            }
          
            var.update $sample_records_count {
              value = $sample_records_count + 1
            }
          }
        }
      
        conditional {
          if ($r.new_tech_id == 2) {
            var.update $breakdown_tech_2 {
              value = $breakdown_tech_2 + 1
            }
          }
        }
      
        conditional {
          if ($r.new_tech_id == 3) {
            var.update $breakdown_tech_3 {
              value = $breakdown_tech_3 + 1
            }
          }
        }
      
        conditional {
          if ($r.new_tech_id == 4) {
            var.update $breakdown_tech_4 {
              value = $breakdown_tech_4 + 1
            }
          }
        }
      
        conditional {
          if ($r.new_tech_id == 5) {
            var.update $breakdown_tech_5 {
              value = $breakdown_tech_5 + 1
            }
          }
        }
      
        conditional {
          if ($r.new_tech_id == 6) {
            var.update $breakdown_tech_6 {
              value = $breakdown_tech_6 + 1
            }
          }
        }
      
        conditional {
          if (($r.new_tech_id != 2) && ($r.new_tech_id != 3) && ($r.new_tech_id != 4) && ($r.new_tech_id != 5) && ($r.new_tech_id != 6)) {
            var.update $breakdown_other {
              value = $breakdown_other + 1
            }
          }
        }
      }
    }
  }

  response = {
    success               : ($refused != true)
    refused               : $refused
    refusal_reason        : ($refused == true) ? "overmatch_gate: total_matched > 200 without override_overmatch=true" : ""
    dry_run               : $dry_run
    total_candidates      : $total_candidates
    total_matched         : $total_matched
    total_updated         : $total_updated
    total_unknown         : $total_unknown
    total_already_teddy   : $total_already_teddy
    full_count            : $total_matched
    sample_records        : $sample_records
    breakdown_by_dest_tech: ```
      {
        tech_2_jimmy: $breakdown_tech_2
        tech_3_andre: $breakdown_tech_3
        tech_4_lee  : $breakdown_tech_4
        tech_5_billy: $breakdown_tech_5
        tech_6_john : $breakdown_tech_6
        other       : $breakdown_other
      }
      ```
    limit_applied         : $limit
    limit_hit             : ($total_matched >= $limit)
  }

  guid = "reattribute-hcp-techs-2026-05-08"
}
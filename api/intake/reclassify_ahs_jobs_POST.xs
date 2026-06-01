//  One-shot AHS reclassification cleanup (2026-05-07 evening).
// 
//  Background: hcp_backfill_recent_jobs (this morning) classified jobs
//  as warranty only when HCP tags contained "ahs"/"warranty"/etc. AHS
//  jobs frequently arrive with empty tags arrays — the AHS marker is
//  in notes_internal (e.g. "ahs:41025769", "American Home Shield",
//  AHS authorization links). Result: ~70% of warranty-flagged jobs
//  were misclassified as customer_type="self_pay".
// 
//  This endpoint scans HCP-sourced self_pay jobs, looks for AHS
//  markers in notes_internal, and flips customer_type to "warranty".
//  Idempotent — re-running on already-warranty jobs is safe (we only
//  query self_pay candidates, so they're not seen on a re-run).
// 
//  Two-pass design: pass 1 scans + collects without writing; sanity
//  gate checks total_matched; pass 2 writes if approved. This lets
//  dry_run report honest counts and refuses runaway real-runs (>200
//  matches) without an explicit override.
// 
//  Folder note: spec asked for api/maintenance/ but that folder
//  doesn't exist in this workspace. Filed under api/intake/ per the
//  spec's fallback guidance.
// 
//  XanoScript gotcha encountered during build: db.query with
//  `return = {type: "list", paging: {...}}` returns a paginated
//  wrapper object that is NOT iterable via foreach. Use plain
//  `return = {type: "list"}` to get a flat array. The |count filter
//  silently accepts both shapes but with different semantics.
query reclassify_ahs_jobs verb=POST {
  api_group = "intake"

  input {
    // Default true so first-run is safe-by-default.
    bool? dry_run?
  
    // Hard cap on matches collected per call. Default 500. The scan
    // breaks early once this many matches are accumulated.
    int? limit?
  
    // Sanity-gate bypass. When real-run produces > 200 matches and
    // override is false, the endpoint refuses to write and returns
    // the dry-run-style preview instead.
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
  
    // PASS 1: query HCP-sourced self_pay candidates, scan notes for
    // AHS markers, collect matches WITHOUT writing.
    db.query jobs {
      where = $db.jobs.customer_type == "self_pay" && ($db.jobs.intake_source == "hcp_backfill" || $db.jobs.intake_source == "hcp_poll" || $db.jobs.intake_source == "hcp_webhook")
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
              
                // First-match wins; ordered most-specific to least.
                // "american home shield" before "ahs" so the more
                // descriptive marker is recorded for the audit log.
                var $matched_marker {
                  value = ""
                }
              
                conditional {
                  if ($notes_lower|contains:"american home shield") {
                    var.update $matched_marker {
                      value = "american home shield"
                    }
                  }
                }
              
                conditional {
                  if (($matched_marker == "") && ($notes_lower|contains:"homeshield")) {
                    var.update $matched_marker {
                      value = "homeshield"
                    }
                  }
                }
              
                conditional {
                  if (($matched_marker == "") && ($notes_lower|contains:"frontdoor")) {
                    var.update $matched_marker {
                      value = "frontdoor"
                    }
                  }
                }
              
                conditional {
                  if (($matched_marker == "") && ($notes_lower|contains:"ahs.com")) {
                    var.update $matched_marker {
                      value = "ahs.com"
                    }
                  }
                }
              
                conditional {
                  if (($matched_marker == "") && ($notes_lower|contains:"ahs")) {
                    var.update $matched_marker {
                      value = "ahs"
                    }
                  }
                }
              
                conditional {
                  if ($matched_marker != "") {
                    var.update $total_matched {
                      value = $total_matched + 1
                    }
                  
                    // Look up customer name for the audit record.
                    var $customer_name {
                      value = ""
                    }
                  
                    conditional {
                      if (($job.customer_id != null) && ($job.customer_id > 0)) {
                        db.get customer {
                          field_name = "id"
                          field_value = $job.customer_id
                        } as $cust_record
                      
                        conditional {
                          if ($cust_record != null) {
                            var.update $customer_name {
                              value = ((($cust_record.first_name ?? "") ~ " " ~ ($cust_record.last_name ?? ""))|trim)
                            }
                          }
                        }
                      }
                    }
                  
                    var $excerpt {
                      value = $notes|substr:0:200
                    }
                  
                    var.update $results {
                      value = $results
                        |push:```
                          {
                            job_id        : $job.id
                            customer_id   : ($job.customer_id ?? 0)
                            customer_name : $customer_name
                            hcp_job_id    : ($job.housecall_pro_job_id ?? "")
                            intake_source : ($job.intake_source ?? "")
                            matched_marker: $matched_marker
                            notes_excerpt : $excerpt
                          }
                          ```
                    }
                  
                    // Honor the limit cap.
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
  
    // Sanity gate: real-run with > 200 matches refuses unless override.
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
  
    // PASS 2: update rows. Skipped on dry_run OR when refused.
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
              data = {customer_type: "warranty"}
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
            action  : "reclassify_ahs_jobs_run"
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
  
    // Build sample_records (first 20 from $results) for the response.
    // Reconstruct as object literals — pushing a $var reference can
    // produce associatively-keyed arrays.
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
                    job_id        : $r.job_id
                    customer_id   : $r.customer_id
                    customer_name : $r.customer_name
                    hcp_job_id    : $r.hcp_job_id
                    intake_source : $r.intake_source
                    matched_marker: $r.matched_marker
                    notes_excerpt : $r.notes_excerpt
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

  guid = "reclassify-ahs-jobs-2026-05-07"
}
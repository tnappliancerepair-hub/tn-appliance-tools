//  Returns up to 3 unscheduled jobs near a tech's primary service area.
//  Used by the EXTRA shortcut: tech texts "EXTRA" → ant calls this
//  endpoint → composes the candidate-list reply.
// 
//  Search criteria (all must pass):
//    - jobs.scheduling_status in ('not_ready', 'prediagnosis_pending',
//      'intake_complete')
//    - jobs.scheduled_start is null OR scheduled_start = 0
//    - jobs.technician_id is null OR == 0
//    - service_zip is non-empty AND the zone allows this tech
//    - tech_preferences hard rules don't block (skip appliance/zone)
// 
//  Sort: created_at desc (newest first - usually freshest urgency)
// 
//  Returns flag `has_prediag` per job so the SMS can warn "no pre-diag
//  yet" when applicable. Pre-diagnosed jobs surface first within the
//  returned list when otherwise equal.
query find_extra_work_for_tech verb=GET {
  api_group = "intake"

  input {
    int tech_id
    int? limit?
  }

  stack {
    var $lim_raw {
      value = ($input.limit ?? 3)
    }
  
    var $lim {
      value = ($lim_raw > 5) ? 5 : $lim_raw
    }
  
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech
  
    precondition ($tech != null) {
      error_type = "notfound"
      error = "Tech not found"
    }
  
    // Pull active tech_preferences once for filter logic below
    db.query tech_preferences {
      where = $db.tech_preferences.tech_id == $input.tech_id && $db.tech_preferences.active == true
      sort = {tech_preferences.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_prefs
  
    // Pre-lookup: clusters this tech serves. Source = cluster_assignment
    // (the same authoritative table the zip-to-tech suggestion uses). The old
    // path parsed service_zone.allowed_technicians as comma-separated tech IDs,
    // but that column holds pipe-separated NAMES -- so it always resolved to
    // empty and NO candidate was ever flagged in-cluster. Now route-fill is
    // genuinely cluster-aware: nearby same-cluster jobs surface first.
    db.query cluster_assignment {
      where = $db.cluster_assignment.technician_id == $input.tech_id && $db.cluster_assignment.active == true
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $my_clusters

    var $tech_clusters_csv {
      value = ""
    }

    foreach ($my_clusters.items) {
      each as $ca {
        var $cl {
          value = (($ca.cluster ?? "")|trim|lower)
        }

        conditional {
          if ($cl != "") {
            var.update $tech_clusters_csv {
              value = ($tech_clusters_csv ~ "|" ~ $cl ~ "|")
            }
          }
        }
      }
    }
  
    // Build sets of declined appliances + declined zones
    var $declined_appliances {
      value = []
    }
  
    var $declined_zones {
      value = []
    }
  
    foreach ($tech_prefs.items) {
      each as $p {
        var $notes_txt {
          value = (($p.notes ?? "")|trim)
        }
      
        conditional {
          if (($notes_txt|substr:0:13) == "appliance_no:") {
            var $app_slug {
              value = ($notes_txt|substr:13)|trim|lower
            }
          
            var.update $declined_appliances {
              value = $declined_appliances|push:$app_slug
            }
          }
        
          elseif ($notes_txt == "zone_skip") {
            var $zn_slug {
              value = (($p.zip_or_area ?? "")|trim|lower)
            }
          
            conditional {
              if ($zn_slug != "") {
                var.update $declined_zones {
                  value = $declined_zones|push:$zn_slug
                }
              }
            }
          }
        }
      }
    }
  
    // Pull candidate jobs - scheduling_status non-terminal AND no
    // scheduled_start. technician_id=1 (Teddy fallback) counts as
    // "still up for grabs" since Teddy is the unassigned-routing default.
    db.query jobs {
      where = ($db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "prediagnosis_pending" || $db.jobs.scheduling_status == "intake_complete") && $db.jobs.scheduled_start == null && ($db.jobs.technician_id == null || $db.jobs.technician_id == 0 || $db.jobs.technician_id == 1)
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $job_rows
  
    // Filter each candidate against tech's service area + preferences
    var $matches {
      value = []
    }
  
    var $with_prediag_first {
      value = []
    }
  
    var $without_prediag {
      value = []
    }
  
    foreach ($job_rows.items) {
      each as $job {
        conditional {
          if (($matches|count) < 20) {
            // Skip if appliance declined
            var $app_lower {
              value = (($job.appliance_type ?? "")|trim|lower)
            }
          
            var $app_strip {
              value = $declined_appliances|to_text|replace:$app_lower:""
            }
          
            var $app_blocked {
              value = (($declined_appliances|to_text|strlen) > ($app_strip|strlen)) && ($app_lower != "")
            }
          
            conditional {
              if (!$app_blocked) {
                var $zip {
                  value = (($job.service_zip ?? "")|trim)
                }
              
                conditional {
                  if ($zip != "") {
                    // Lookup zone for this zip (for cluster + decline filter)
                    db.query service_zone {
                      where = $db.service_zone.zip_code == $zip
                      return = {type: "list", paging: {page: 1, per_page: 1}}
                    } as $zone_rows
                  
                    var $zone_row {
                      value = (($zone_rows.items|first) ?? null)
                    }
                  
                    var $cluster_lower {
                      value = (($zone_row.cluster ?? "")|trim|lower)
                    }
                  
                    var $cluster_strip {
                      value = $declined_zones
                        |to_text
                        |replace:$cluster_lower:""
                    }
                  
                    var $cluster_blocked {
                      value = (($declined_zones|to_text|strlen) > ($cluster_strip|strlen)) && ($cluster_lower != "")
                    }
                  
                    conditional {
                      if (!$cluster_blocked) {
                        // Customer info
                        db.get customer {
                          field_name = "id"
                          field_value = ($job.customer_id ?? 0)
                        } as $cust
                      
                        // Pull ALL TDRs for this job - used both for
                        // pre-diag check (tech_id=1) AND for ownership
                        // exclusion (if any non-Teddy TDR exists, the
                        // job belongs to that tech for completion
                        // continuity - skip for EXTRA flow).
                        db.query technician_decision_report {
                          where = $db.technician_decision_report.job_id == $job.id
                          return = {type: "list", paging: {page: 1, per_page: 10}}
                        } as $tdr_all
                      
                        var $has_prediag {
                          value = false
                        }
                      
                        var $owned_by_other_tech {
                          value = false
                        }
                      
                        foreach ($tdr_all.items) {
                          each as $tdr {
                            var $tid {
                              value = ($tdr.technician_id ?? 0)
                            }
                          
                            conditional {
                              if ($tid == 1) {
                                var.update $has_prediag {
                                  value = true
                                }
                              }
                            
                              elseif ($tid > 1) {
                                var.update $owned_by_other_tech {
                                  value = true
                                }
                              }
                            }
                          }
                        }
                      
                        conditional {
                          if (!$owned_by_other_tech) {
                            // Same-cluster preference flag - used for sort
                            var $cluster_marker {
                              value = ("|" ~ $cluster_lower ~ "|")
                            }
                          
                            var $tcs_strip {
                              value = $tech_clusters_csv|replace:$cluster_marker:""
                            }
                          
                            var $in_tech_cluster {
                              value = ($cluster_lower != "") && (($tech_clusters_csv|strlen) > ($tcs_strip|strlen))
                            }
                          
                            var $summary {
                              value = {
                                id              : $job.id
                                customer_id     : ($job.customer_id ?? 0)
                                customer_first  : (($cust.first_name ?? "")|trim)
                                customer_phone  : (($cust.phone ?? "")|trim)
                                appliance       : (($job.appliance_type ?? "")|trim)
                                brand           : (($job.brand ?? "")|trim)
                                zip             : $zip
                                city            : (($job.service_city ?? ($cust.city ?? ""))|trim)
                                cluster         : $cluster_lower
                                market          : (($zone_row.market ?? "")|trim)
                                problem_summary : (($job.problem_summary ?? "")|trim)
                                has_prediag     : $has_prediag
                                in_tech_cluster : $in_tech_cluster
                                warranty_company: (($job.warranty_company ?? "")|trim)
                                customer_type   : (($job.customer_type ?? "")|trim)
                              }
                            }
                          
                            conditional {
                              if ($has_prediag && $in_tech_cluster) {
                                var.update $with_prediag_first {
                                  value = $with_prediag_first|push:$summary
                                }
                              }
                            
                              elseif ($has_prediag) {
                                // Has prediag but outside cluster - second priority
                                var.update $without_prediag {
                                  value = $without_prediag|push:$summary
                                }
                              }
                            
                              else {
                                // No prediag - last priority regardless of cluster
                                var.update $without_prediag {
                                  value = $without_prediag|push:$summary
                                }
                              }
                            }
                          
                            var.update $matches {
                              value = $matches|push:$summary
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
      }
    }
  
    // NOTE: We tried building a single ranked $output array via foreach
    // over the categorized $with_prediag_first / $without_prediag /
    // $matches arrays + var.update $output|push. XS silently fails to
    // populate $output in this pattern (verified - categorized arrays
    // contain items but $output stays []). Workaround: return the two
    // categorized arrays directly; the calling agent slices the top-N
    // (pre-diag-in-cluster first, then the rest) in JS.
  }

  response = {
    success          : true
    tech_id          : $input.tech_id
    tech_first_name  : (($tech.first_name ?? "")|trim)
    prediag_and_local: $with_prediag_first
    other_candidates : $without_prediag
    total_in_pool    : $matches|count
    declined_apps    : $declined_appliances
    declined_zones   : $declined_zones
  }

  guid = "find-extra-work-for-tech-v1"
}
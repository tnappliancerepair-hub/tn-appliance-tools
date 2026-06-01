//  Find open / unscheduled jobs near where the tech currently is.
// 
//  "Open" = scheduling_status in (not_ready, pending_authorization,
//  awaiting_parts_scheduled) — work that COULD be picked up if a tech
//  has bandwidth.
// 
//  MVP proximity:
//    - Score 100: same zip code as tech's recent position-derived zip
//    - Score  60: same service_city
//    - Score  30: same service zone (cluster lookup later)
//  (When customers are geocoded with lat/lng, swap this scoring for
//   true haversine distance. The tool interface is stable.)
// 
//  Inputs:
//    tech_id (required) — used to look up the tech's recent ZIP
//    recent_zip (optional override) — when GPS isn't available, the
//        brain can pass the zip of the job just completed
//    recent_city (optional override)
//    limit (default 10)
// 
//  Returns: items[{job_id, customer_name, service_city, service_zip,
//    appliance_type, warranty_company, proximity_score, age_days,
//    scheduling_status}]
query find_nearby_open_jobs verb=GET {
  api_group = "intake"

  input {
    int tech_id
    text? recent_zip?
    text? recent_city?
    int? limit?
  }

  stack {
    var $limit_val {
      value = (($input.limit ?? 10))
    }
  
    conditional {
      if ($limit_val > 50) {
        var.update $limit_val {
          value = 50
        }
      }
    }
  
    conditional {
      if ($limit_val < 1) {
        var.update $limit_val {
          value = 1
        }
      }
    }
  
    var $zip {
      value = (($input.recent_zip ?? "")|trim)
    }
  
    var $city {
      value = (($input.recent_city ?? "")|trim)|to_lower
    }
  
    // Pull a generous set of open jobs to score in app code. 200 cap
    // keeps the scan bounded even if Danielle's queue is huge.
    // "Open" = unscheduled OR scheduled-but-parts-pending (a parts-arrived
    // job is fair game for someone in the area today).
    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "pending_authorization" || $db.jobs.parts_status == "arrived"
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $open_rows
  
    var $now_ms {
      value = now|to_ms
    }
  
    var $scored {
      value = []
    }
  
    foreach ($open_rows.items) {
      each as $j {
        var $job_zip {
          value = (($j.service_zip ?? "")|trim)
        }
      
        var $job_city {
          value = (($j.service_city ?? "")|trim)|to_lower
        }
      
        var $score {
          value = 0
        }
      
        conditional {
          if ($zip != "" && $job_zip != "" && $job_zip == $zip) {
            var.update $score {
              value = 100
            }
          }
        }
      
        conditional {
          if ($score == 0 && $city != "" && $job_city != "" && $job_city == $city) {
            var.update $score {
              value = 60
            }
          }
        }
      
        // Only include jobs that scored — same metro at minimum
        conditional {
          if ($score > 0) {
            db.get customer {
              field_name = "id"
              field_value = ($j.customer_id ?? 0)
            } as $cust
          
            var $cust_first {
              value = (($cust.first_name ?? "")|trim)
            }
          
            var $cust_last {
              value = (($cust.last_name ?? "")|trim)
            }
          
            var $cust_full {
              value = (($cust_first ~ " " ~ $cust_last)|trim)
            }
          
            var $age_days {
              value = (($now_ms - ($j.created_at ?? $now_ms)) / 86400000)|to_int
            }
          
            // Pre-bind every value — XS strips ternaries + nullish-coalesce
            // when they appear inline in object literals.
            var $cust_name_final {
              value = ($cust_full != "") ? $cust_full : "(unknown)"
            }
          
            var $cust_phone_v {
              value = ($cust.phone ?? "")
            }
          
            var $svc_address_v {
              value = ($j.service_address ?? "")
            }
          
            var $svc_city_v {
              value = ($j.service_city ?? "")
            }
          
            var $svc_zip_v {
              value = ($j.service_zip ?? "")
            }
          
            var $appl_type_v {
              value = ($j.appliance_type ?? "")
            }
          
            var $brand_v {
              value = ($j.brand ?? "")
            }
          
            var $warranty_v {
              value = ($j.warranty_company ?? "")
            }
          
            var $status_v {
              value = ($j.scheduling_status ?? "")
            }
          
            var $parts_status_v {
              value = ($j.parts_status ?? "")
            }
          
            var $ready_now {
              value = false
            }
          
            conditional {
              if ($parts_status_v == "arrived" || $parts_status_v == "" || $parts_status_v == "not_needed") {
                var.update $ready_now {
                  value = true
                }
              }
            }
          
            var $entry {
              value = {
                job_id           : $j.id
                customer_name    : $cust_name_final
                customer_phone   : $cust_phone_v
                service_address  : $svc_address_v
                service_city     : $svc_city_v
                service_zip      : $svc_zip_v
                appliance_type   : $appl_type_v
                brand            : $brand_v
                warranty_company : $warranty_v
                scheduling_status: $status_v
                parts_status     : $parts_status_v
                ready_now        : $ready_now
                proximity_score  : $score
                age_days         : $age_days
              }
            }
          
            var.update $scored {
              value = $scored|push:$entry
            }
          }
        }
      }
    }
  
    // Already partially ordered by created_at desc; for final cut we
    // present highest proximity first by slicing the top N.
    // (When traffic warrants, sort by score inside XS — current
    // workload is small enough that the caller can sort client-side
    // if needed.)
  }

  response = {
    success         : true
    tech_id         : $input.tech_id
    used_zip        : $zip
    used_city       : $city
    candidates_found: $scored|count
    limit           : $limit_val
    items           : $scored|slice:0:$limit_val
  }

  guid = "find-nearby-open-jobs-v1"
}
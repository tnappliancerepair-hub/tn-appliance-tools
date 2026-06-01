//  Paginated, filtered jobs list for dashboard pages. Each job is enriched with
//  customer / tech / most-recent-TDR / parts info + days_since_created.
//  Returns total_count for pagination UI. All inputs optional.
//    tech_id     - filter to one tech (null/<=0 = all techs)
//    status      - filter by scheduling_status (null/"" = all statuses)
//    date_filter - "today" | "upcoming" | "unscheduled" | "all" (default "all")
//    page        - default 1
//    per_page    - default 50
// 
//  Performance: caches the tech roster (single query) and reuses per-row for
//  name lookup instead of per-row db.get. Sort branches on date_filter: "all"
//  uses created_at DESC (newest first); others use scheduled_start ASC.
// 
//  2026-05-22: where clauses split per date_filter (4 branches) to avoid the
//  nested 3-way date OR that was triggering Xano ParseError.
query get_jobs_for_dashboard verb=POST {
  api_group = "intake"

  input {
    int? tech_id?
    text? status?
    text? date_filter?
    int? page?
    int? per_page?
  }

  stack {
    // Normalize inputs.
    // Pre-coerce optional filter inputs to non-null sentinels. Xano POST
    // endpoints can pass null for absent optional inputs; referencing
    // $input.X directly in a where clause then produces "ParseError:
    // Invalid value for param:" at the SQL builder layer.
    var $safe_tech_id {
      value = ($input.tech_id ?? 0)
    }
  
    var $safe_status {
      value = (($input.status ?? "")|trim)
    }
  
    // For pagination, Xano GET optional int? inputs default to 0 (not null)
    // when the query param is missing, so ?? 1 alone doesn't catch the unset
    // case. Handle both null AND 0 (and any non-positive value) explicitly.
    var $effective_page {
      value = ($input.page ?? 0)
    }
  
    conditional {
      if ($effective_page <= 0) {
        var.update $effective_page {
          value = 1
        }
      }
    }
  
    var $effective_per_page {
      value = ($input.per_page ?? 0)
    }
  
    conditional {
      if ($effective_per_page <= 0) {
        var.update $effective_per_page {
          value = 50
        }
      }
    }
  
    var $effective_date_filter {
      value = (($input.date_filter ?? "all")|trim)
    }
  
    conditional {
      if ($effective_date_filter == "") {
        var.update $effective_date_filter {
          value = "all"
        }
      }
    }
  
    // Today CT range (used by "today" + "upcoming" filters).
    var $today_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_ct_date {
      value = $today_ct_ts|format_timestamp:"Y-m-d"
    }
  
    var $today_start_utc {
      value = (($today_ct_date ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }
  
    var $tomorrow_start_utc {
      value = $today_start_utc|transform_timestamp:"+1 day"
    }
  
    // Tech roster cache (single query, reused per-row inside foreach).
    db.query technicians {
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_roster
  
    // ── Page query: branched per date_filter. ──
    var $jobs_list {
      value = {items: []}
    }
  
    conditional {
      if ($effective_date_filter == "today") {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status) && $db.jobs.scheduled_start >= $today_start_utc && $db.jobs.scheduled_start < $tomorrow_start_utc
          sort = {jobs.scheduled_start: "asc"}
          return = {
            type  : "list"
            paging: {page: $effective_page, per_page: $effective_per_page}
          }
        } as $jobs_list
      }
    
      elseif ($effective_date_filter == "upcoming") {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status) && $db.jobs.scheduled_start >= $today_start_utc
          sort = {jobs.scheduled_start: "asc"}
          return = {
            type  : "list"
            paging: {page: $effective_page, per_page: $effective_per_page}
          }
        } as $jobs_list
      }
    
      elseif ($effective_date_filter == "unscheduled") {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status) && $db.jobs.scheduled_start == null
          sort = {jobs.scheduled_start: "asc"}
          return = {
            type  : "list"
            paging: {page: $effective_page, per_page: $effective_per_page}
          }
        } as $jobs_list
      }
    
      else {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status)
          sort = {jobs.created_at: "desc"}
          return = {
            type  : "list"
            paging: {page: $effective_page, per_page: $effective_per_page}
          }
        } as $jobs_list
      }
    }
  
    // ── Count query: same 4-way branch, no sort/page. ──
    var $total_count {
      value = 0
    }
  
    conditional {
      if ($effective_date_filter == "today") {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status) && $db.jobs.scheduled_start >= $today_start_utc && $db.jobs.scheduled_start < $tomorrow_start_utc
          return = {type: "count"}
        } as $total_count
      }
    
      elseif ($effective_date_filter == "upcoming") {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status) && $db.jobs.scheduled_start >= $today_start_utc
          return = {type: "count"}
        } as $total_count
      }
    
      elseif ($effective_date_filter == "unscheduled") {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status) && $db.jobs.scheduled_start == null
          return = {type: "count"}
        } as $total_count
      }
    
      else {
        db.query jobs {
          where = ($safe_tech_id <= 0 || $db.jobs.technician_id == $safe_tech_id) && ($safe_status == "" || $db.jobs.scheduling_status == $safe_status)
          return = {type: "count"}
        } as $total_count
      }
    }
  
    // ── Enrich each row. ──
    var $items_enriched {
      value = []
    }
  
    var $now_ms {
      value = now|to_ms
    }
  
    foreach ($jobs_list.items) {
      each as $j {
        // Customer (nullable - HCP-sourced jobs may lack customer_id).
        var $cust {
          value = null
        }
      
        conditional {
          if ($j.customer_id != null && $j.customer_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $j.customer_id
            } as $cust
          }
        }
      
        // Tech lookup from cached roster (linear scan, small list).
        var $tech_row {
          value = null
        }
      
        conditional {
          if ($j.technician_id != null && $j.technician_id > 0) {
            foreach ($tech_roster.items) {
              each as $t {
                conditional {
                  if ($t.id == $j.technician_id) {
                    var.update $tech_row {
                      value = $t
                    }
                  }
                }
              }
            }
          }
        }
      
        // Most recent TDR for this job (nullable - many jobs have none).
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $j.id
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "single"}
        } as $tdr
      
        var $days_since_created {
          value = (($now_ms - ($j.created_at|to_ms)) / 86400000)|to_int
        }
      
        var $enriched {
          value = {
            job               : {
              id                : $j.id
              scheduling_status : $j.scheduling_status
              customer_type     : $j.customer_type
              brand             : $j.brand
              appliance_type    : $j.appliance_type
              problem_summary   : $j.problem_summary
              scheduled_start   : $j.scheduled_start
              created_at        : $j.created_at
              office_stage      : ($j.office_stage ?? "")
            }
            customer          : {
              first_name: ($cust.first_name ?? null)
              last_name : ($cust.last_name ?? null)
              phone     : ($cust.phone ?? null)
              address   : ($cust.address ?? null)
              city      : ($cust.city ?? null)
              state     : ($cust.state ?? null)
              zip       : ($cust.zip ?? null)
            }
            tech              : {
              id         : ($tech_row.id ?? null)
              first_name : ($tech_row.first_name ?? null)
              last_name  : ($tech_row.last_name ?? null)
            }
            tdr               : {
              diagnosis            : ($tdr.diagnosis ?? null)
              status               : ($tdr.status ?? null)
              verified_part_number : ($tdr.verified_part_number ?? null)
            }
            parts             : {
              parts_decision   : ($j.parts_decision ?? null)
              parts_supplier   : ($j.parts_supplier ?? null)
              parts_eta_date   : ($j.parts_eta_date ?? null)
              parts_ordered_at : ($j.parts_ordered_at ?? null)
            }
            days_since_created: $days_since_created
          }
        }
      
        array.push $items_enriched {
          value = $enriched
        }
      }
    }
  }

  response = {
    success    : true
    items      : $items_enriched
    total_count: $total_count
    page       : $effective_page
    per_page   : $effective_per_page
  }

  guid = "WJ-DFEQbRCF1L2dBCQ6P2QaZCIA"
}
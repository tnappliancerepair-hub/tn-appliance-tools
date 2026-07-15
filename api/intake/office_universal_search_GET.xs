//  Universal search bar backend. Accepts a free-text query, runs across
//  all jobs in the system (parallel-mode + HCP-origin legacy + any source).
// 
//  Auto-detects intent:
//    - All digits (8+ chars) → phone search across customer.phone
//    - Contains street keywords (St/Ave/Rd/Dr/Ln/Blvd/Cir/Ct/Way/Pl/Pkwy) → address
//    - Else → name search
//    - Falls back to all 3 searches if ambiguous.
// 
//  Returns up to 25 results, most-recent first. Each row includes job +
//  customer context Danielle needs to identify the right person.
query office_universal_search verb=GET {
  api_group = "intake"

  input {
    text q
  }

  stack {
    var $q_raw {
      value = (($input.q ?? "")|trim)
    }
  
    var $q_lower {
      value = $q_raw|to_lower
    }
  
    var $q_raw_strlen {
      value = $q_raw|strlen
    }
  
    precondition ($q_raw_strlen >= 2) {
      error_type = "inputerror"
      error = "query must be at least 2 chars"
    }
  
    // 2026-06-02 BUGFIX: previous version only stripped formatting chars
    // (- space ( ) . +). Letters were never removed, so "Ray Gedert"
    // → q_digits="RayGedert" (9 chars) → is_phone_query=true. Name
    // search never ran for any query 7+ chars. Now actually strip
    // non-digits.
    var $q_digits {
      value = "/[^0-9]/"|regex_replace:"":$q_raw
    }

    var $q_digits_len {
      value = $q_digits|strlen
    }

    var $q_raw_len {
      value = $q_raw|strlen
    }

    var $q_diff {
      value = $q_raw_len - $q_digits_len
    }

    // Phone query if ALL or near-all chars are digits and total length 7+
    var $is_phone_query {
      value = ($q_digits_len >= 7) && ($q_raw_len <= ($q_digits_len + 4))
    }

    // WO-number query: always run when 5+ digits, even if it ALSO looks
    // like a phone. Lets searches like "49135689" hit both customer.phone
    // AND jobs.claim_number. Alphanumeric IDs like "ARW20260635154946"
    // (NSA) also qualify since they contain digit runs.
    var $is_wo_query {
      value = $q_digits_len >= 5
    }
  
    // Address keyword detection - pre-bind all lengths to dodge XS filter
    // footgun ("Invalid syntax. Please wrap your filter with parentheses").
    var $kw_check_str {
      value = (" " ~ $q_lower ~ " ")
    }
  
    var $kw_check_len {
      value = $kw_check_str|strlen
    }
  
    var $has_street_kw {
      value = false
    }
  
    var $kw_strip_all {
      value = $kw_check_str
        |replace:" st ":""
        |replace:" ave ":""
        |replace:" rd ":""
        |replace:" dr ":""
        |replace:" ln ":""
        |replace:" blvd ":""
        |replace:" ct ":""
        |replace:" cir ":""
        |replace:" way ":""
        |replace:" pkwy ":""
        |replace:" pl ":""
    }
  
    var $kw_strip_len {
      value = $kw_strip_all|strlen
    }
  
    conditional {
      if ($kw_check_len > $kw_strip_len) {
        var.update $has_street_kw {
          value = true
        }
      }
    }
  
    // Run customer queries based on detection (and a fallback name pass)
    var $matched_customer_ids {
      value = []
    }

    // Exact jobs matched by number (job # / claim / dispatch). A number search must
    // return THOSE jobs, not the customer's latest job (Danielle 7/15: cant search a
    // job number). Collected here, emitted first in the assembly below.
    var $wo_matched_jobs {
      value = []
    }

    conditional {
      if ($is_phone_query) {
        var $q_last10_start {
          value = $q_digits_len - 10
        }
      
        var $q_last10 {
          value = ($q_digits_len >= 10) ? ($q_digits|substr:$q_last10_start) : $q_digits
        }
      
        var $q_plus_us {
          value = ("+1" ~ $q_last10)
        }
      
        db.query customer {
          where = $db.customer.phone == $q_digits || $db.customer.phone == $q_last10 || $db.customer.phone == $q_plus_us
          sort = {customer.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 25}}
        } as $cust_phone_rows
      
        foreach ($cust_phone_rows.items) {
          each as $cp {
            var.update $matched_customer_ids {
              value = $matched_customer_ids|push:$cp.id
            }
          }
        }
      }
    }
  
    // 2026-07-08 SPEED FIX (Teddy): the office search was running ~7-8s on every
    // name lookup. The culprit was a 1000-row customer pull + in-script substring
    // scan that ran on EVERY name query. Now the FAST indexed passes run first
    // (exact first/last name + WO# - both hit an index, uncapped across the whole
    // table), and the slow substring scan only runs as a LAST RESORT when those
    // found nothing (a real partial like "ruck", or an address-only search).
    // Result: exact name / last name / phone / WO# come back instantly.

    // Indexed exact-name match FIRST. Xano == is case-sensitive; names are stored
    // Title Case, so title-case the lowered tokens ("sherri rucker" -> Sherri / Rucker).
    conditional {
      if (!$is_phone_query) {
        var $name_tokens {
          value = ($q_lower|split:" ")
        }
        var $tok0_raw {
          value = ((($name_tokens|first) ?? "")|trim)
        }
        var $tok1_raw {
          value = (($name_tokens|count) > 1 ? (($name_tokens|get:1)|trim) : $tok0_raw)
        }
        var $tok0 {
          value = (($tok0_raw|substr:0:1|to_upper) ~ ($tok0_raw|substr:1))
        }
        var $tok1 {
          value = (($tok1_raw|substr:0:1|to_upper) ~ ($tok1_raw|substr:1))
        }
        conditional {
          if ($tok0 != "") {
            db.query customer {
              where = $db.customer.first_name == $tok0 || $db.customer.last_name == $tok0 || $db.customer.first_name == $tok1 || $db.customer.last_name == $tok1 || $db.customer.first_name == $q_raw || $db.customer.last_name == $q_raw
              sort = {customer.id: "desc"}
              return = {type: "list", paging: {page: 1, per_page: 50}}
            } as $name_exact_rows
            foreach ($name_exact_rows.items) {
              each as $nc {
                var.update $matched_customer_ids {
                  value = $matched_customer_ids|push:$nc.id
                }
              }
            }
          }
        }
      }
    }

    // WO# / job-number search. Hits jobs.id (the Ant job number), claim_number,
    // dispatch_source_id, housecall_pro_job_id, job_number - adds the customer_id of any
    // match. Danielle's most-common search. A pure-number query also SKIPS the slow name
    // fallback scan below (a number is never a name) - that was the 5.8s lag (Teddy 7/8).
    // jobs.id is an INTEGER column; comparing it to the text $q_raw never matched,
    // so searching a job number (e.g. "20407") returned nothing (Danielle 7/15).
    // Cast a pure-digit query to int for the id compare; leave 0 (matches nothing)
    // for alphanumeric WO ids like NSA "ARW..." which hit the text fields below.
    var $q_int {
      value = ($q_digits_len == $q_raw_len) ? ($q_raw|to_int) : 0
    }

    conditional {
      if ($is_wo_query) {
        db.query jobs {
          where = $db.jobs.id == $q_int || $db.jobs.claim_number == $q_raw || $db.jobs.dispatch_source_id == $q_raw || $db.jobs.housecall_pro_job_id == $q_raw || $db.jobs.job_number == $q_raw
          sort = {jobs.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 25}}
        } as $wo_job_rows

        foreach ($wo_job_rows.items) {
          each as $woj {
            var.update $wo_matched_jobs {
              value = $wo_matched_jobs|push:$woj
            }
          }
        }
      }
    }

    // FALLBACK substring scan - runs ONLY when the fast passes above found nothing
    // (a partial name like "ruck", or an address-only search). This is the slow
    // in-script loop, so gating it behind "nothing matched yet" is what fixes the
    // office-search lag for the everyday searches.
    var $pre_scan_count {
      value = ($matched_customer_ids|count)
    }

    conditional {
      if (!$is_phone_query && $pre_scan_count == 0 && $is_wo_query == false) {
        db.query customer {
          sort = {customer.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1000}}
        } as $all_cust_rows

        var $needle {
          value = $q_lower
        }

        foreach ($all_cust_rows.items) {
          each as $c {
            var $c_first_lower {
              value = (($c.first_name ?? "")|lower)
            }

            var $c_last_lower {
              value = (($c.last_name ?? "")|lower)
            }

            var $c_addr_lower {
              value = (($c.address ?? "")|lower)
            }

            var $c_city_lower {
              value = (($c.city ?? "")|lower)
            }

            var $combined {
              value = ($c_first_lower ~ " " ~ $c_last_lower ~ " " ~ $c_addr_lower ~ " " ~ $c_city_lower)
            }

            var $strip {
              value = $combined|replace:$needle:""
            }

            var $combined_len {
              value = $combined|strlen
            }

            var $strip_len {
              value = $strip|strlen
            }

            conditional {
              if ($combined_len > $strip_len) {
                var.update $matched_customer_ids {
                  value = $matched_customer_ids|push:$c.id
                }
              }
            }
          }
        }
      }
    }

    // Now fetch most-recent jobs for each matched customer
    var $items {
      value = []
    }
  
    var $item_count {
      value = 0
    }

    // Dedup - the name + WO passes can match the same customer.
    var $seen_cust {
      value = []
    }

    // Emit the EXACT number-matched jobs first (each its own row) so a job-number
    // search returns that job, not the customer's latest. Uses the denormalized
    // name/phone on the jobs row, falling back to the customer record.
    foreach ($wo_matched_jobs) {
      each as $woj {
        conditional {
          if ($item_count < 25) {
            var $woc {
              value = null
            }
            conditional {
              if (($woj.customer_id ?? 0) > 0) {
                db.get customer {
                  field_name = "id"
                  field_value = $woj.customer_id
                } as $woc_lookup
                var.update $woc {
                  value = $woc_lookup
                }
              }
            }
            var $wo_first_j {
              value = (($woj.customer_first ?? "")|trim)
            }
            var $wo_last_j {
              value = (($woj.customer_last ?? "")|trim)
            }
            var $wo_phone_j {
              value = (($woj.customer_phone ?? "")|trim)
            }
            var $wo_first_final {
              value = ($wo_first_j != "") ? $wo_first_j : (($woc.first_name ?? "")|trim)
            }
            var $wo_last_final {
              value = ($wo_last_j != "") ? $wo_last_j : (($woc.last_name ?? "")|trim)
            }
            var $wo_phone_final {
              value = ($wo_phone_j != "") ? $wo_phone_j : (($woc.phone ?? "")|trim)
            }
            var $wo_addr_final {
              value = (($woj.service_address ?? ($woc.address ?? ""))|trim)
            }
            var $wo_city_final {
              value = (($woj.service_city ?? ($woc.city ?? ""))|trim)
            }
            var $wo_zip_final {
              value = (($woj.service_zip ?? ($woc.zip ?? ""))|trim)
            }
            var $wo_row {
              value = {
                job_id           : ($woj.id ?? 0)
                customer_id      : ($woj.customer_id ?? 0)
                customer_first   : $wo_first_final
                customer_last    : $wo_last_final
                customer_phone   : $wo_phone_final
                address          : $wo_addr_final
                city             : $wo_city_final
                zip              : $wo_zip_final
                appliance        : (($woj.appliance_type ?? "")|trim)
                scheduling_status: (($woj.scheduling_status ?? "")|trim)
                warranty_company : (($woj.warranty_company ?? "")|trim)
                scheduled_start  : ($woj.scheduled_start ?? null)
                last_job_at      : ($woj.created_at ?? 0)
              }
            }
            var.update $items {
              value = $items|push:$wo_row
            }
            var.update $item_count {
              value = $item_count + 1
            }
          }
        }
      }
    }

    foreach ($matched_customer_ids) {
      each as $mcid {
        var $already_seen {
          value = $seen_cust|contains:$mcid
        }
        conditional {
          if ($item_count < 25 && $already_seen == false) {
            var.update $seen_cust {
              value = $seen_cust|push:$mcid
            }
            db.query jobs {
              where = $db.jobs.customer_id == $mcid
              sort = {jobs.id: "desc"}
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $latest_job_rows
          
            var $lj_count {
              value = $latest_job_rows.items|count
            }
          
            conditional {
              if ($lj_count > 0) {
                var $j {
                  value = $latest_job_rows.items|get:0
                }
              
                db.get customer {
                  field_name = "id"
                  field_value = $mcid
                } as $c2
              
                var $row {
                  value = {
                    job_id           : ($j.id ?? 0)
                    customer_id      : $mcid
                    customer_first   : (($c2.first_name ?? "")|trim)
                    customer_last    : (($c2.last_name ?? "")|trim)
                    customer_phone   : (($c2.phone ?? "")|trim)
                    address          : ((($j.service_address ?? ($c2.address ?? ""))|trim))
                    city             : ((($j.service_city ?? ($c2.city ?? ""))|trim))
                    zip              : ((($j.service_zip ?? ($c2.zip ?? ""))|trim))
                    appliance        : (($j.appliance_type ?? "")|trim)
                    scheduling_status: (($j.scheduling_status ?? "")|trim)
                    warranty_company : (($j.warranty_company ?? "")|trim)
                    scheduled_start  : ($j.scheduled_start ?? null)
                    last_job_at      : ($j.created_at ?? 0)
                  }
                }
              
                var.update $items {
                  value = $items|push:$row
                }
              
                var.update $item_count {
                  value = $item_count + 1
                }
              }
            }
          }
        }
      }
    }
  
    var $intent_str {
      value = "name"
    }
  
    conditional {
      if ($is_phone_query) {
        var.update $intent_str {
          value = "phone"
        }
      }
    
      elseif ($has_street_kw) {
        var.update $intent_str {
          value = "address"
        }
      }
    }
  
    var $item_count_out {
      value = $items|count
    }
  }

  response = {
    success: true
    query  : $q_raw
    intent : $intent_str
    count  : $item_count_out
    items  : $items
  }

  guid = "office-universal-search-v1"
}
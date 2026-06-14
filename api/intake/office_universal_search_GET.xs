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
  
    // Name search via first_name OR last_name LIKE - XS doesn't have ILIKE
    // so we approximate with substring contains pattern through field-name LIKE
    // (XS supports LIKE in where clause syntax: $db.tbl.col contains "x" via |contains)
    // Practical XS: use db.query with field == value won't do substring. Use a
    // broader pull + filter in foreach.
    conditional {
      if (!$is_phone_query) {
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
  
    // 2026-06-14 FIX: the JS-substring pass above only scans the 1000 NEWEST
    // customers, so older customers came back "not found" by name (their WO #
    // still found them). Add an UNCAPPED server-side exact match on first/last
    // name tokens (same approach as search_customers), so name search reaches
    // the whole table.
    conditional {
      if (!$is_phone_query) {
        var $name_tokens {
          value = ($q_lower|split:" ")
        }
        var $tok0 {
          value = ((($name_tokens|first) ?? "")|trim)
        }
        var $tok1 {
          value = (($name_tokens|count) > 1 ? (($name_tokens|get:1)|trim) : $tok0)
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

    // 2026-06-02 NEW: WO# search. Hits jobs.claim_number, dispatch_source_id,
    // housecall_pro_job_id, job_number - adds the customer_id of any match
    // to the matched set. Danielle's most-common search pattern.
    conditional {
      if ($is_wo_query) {
        db.query jobs {
          where = $db.jobs.claim_number == $q_raw || $db.jobs.dispatch_source_id == $q_raw || $db.jobs.housecall_pro_job_id == $q_raw || $db.jobs.job_number == $q_raw
          sort = {jobs.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 25}}
        } as $wo_job_rows

        foreach ($wo_job_rows.items) {
          each as $woj {
            conditional {
              if (($woj.customer_id ?? 0) > 0) {
                var.update $matched_customer_ids {
                  value = $matched_customer_ids|push:$woj.customer_id
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
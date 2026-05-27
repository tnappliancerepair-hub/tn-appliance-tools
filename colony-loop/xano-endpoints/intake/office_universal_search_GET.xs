// Universal search bar backend. Accepts a free-text query, runs across
// all jobs in the system (parallel-mode + HCP-origin legacy + any source).
//
// Auto-detects intent:
//   - All digits (8+ chars) → phone search across customer.phone
//   - Contains street keywords (St/Ave/Rd/Dr/Ln/Blvd/Cir/Ct/Way/Pl/Pkwy) → address
//   - Else → name search
//   - Falls back to all 3 searches if ambiguous.
//
// Returns up to 25 results, most-recent first. Each row includes job +
// customer context Danielle needs to identify the right person.
query office_universal_search verb=GET {
  api_group = "intake"

  input {
    text q
  }

  stack {
    var $q_raw { value = (($input.q ?? "")|trim) }
    var $q_lower { value = $q_raw|lower }
    var $q_raw_strlen { value = $q_raw|strlen }

    precondition ($q_raw_strlen >= 2) {
      error_type = "inputerror"
      error      = "query must be at least 2 chars"
    }

    // Phone-only detection: strip formatting, see if mostly digits
    var $q_digits { value = $q_raw|replace:"-":""|replace:" ":""|replace:"(":""|replace:")":""|replace:".":""|replace:"+":"" }
    var $q_digits_len { value = $q_digits|strlen }
    var $q_raw_len { value = $q_raw|strlen }
    var $q_diff { value = $q_raw_len - $q_digits_len }
    var $is_phone_query { value = ($q_digits_len >= 7) && ($q_diff <= 6) }

    // Address keyword detection — pre-bind all lengths to dodge XS filter
    // footgun ("Invalid syntax. Please wrap your filter with parentheses").
    var $kw_check_str { value = (" " ~ $q_lower ~ " ") }
    var $kw_check_len { value = $kw_check_str|strlen }
    var $has_street_kw { value = false }

    var $kw_strip_all { value = $kw_check_str|replace:" st ":""|replace:" ave ":""|replace:" rd ":""|replace:" dr ":""|replace:" ln ":""|replace:" blvd ":""|replace:" ct ":""|replace:" cir ":""|replace:" way ":""|replace:" pkwy ":""|replace:" pl ":"" }
    var $kw_strip_len { value = $kw_strip_all|strlen }

    conditional {
      if ($kw_check_len > $kw_strip_len) {
        var.update $has_street_kw { value = true }
      }
    }

    // Run customer queries based on detection (and a fallback name pass)
    var $matched_customer_ids { value = [] }

    conditional {
      if ($is_phone_query) {
        var $q_last10_start { value = $q_digits_len - 10 }
        var $q_last10 { value = ($q_digits_len >= 10) ? ($q_digits|substr:$q_last10_start) : $q_digits }
        var $q_plus_us { value = ("+1" ~ $q_last10) }
        db.query customer {
          where  = $db.customer.phone == $q_digits || $db.customer.phone == $q_last10 || $db.customer.phone == $q_plus_us
          sort   = {customer.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 25}}
        } as $cust_phone_rows

        foreach ($cust_phone_rows.items) {
          each as $cp {
            var.update $matched_customer_ids { value = $matched_customer_ids|push:$cp.id }
          }
        }
      }
    }

    // Name search via first_name OR last_name LIKE — XS doesn't have ILIKE
    // so we approximate with substring contains pattern through field-name LIKE
    // (XS supports LIKE in where clause syntax: $db.tbl.col contains "x" via |contains)
    // Practical XS: use db.query with field == value won't do substring. Use a
    // broader pull + filter in foreach.
    conditional {
      if (!$is_phone_query) {
        db.query customer {
          sort   = {customer.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1000}}
        } as $all_cust_rows

        var $needle { value = $q_lower }

        foreach ($all_cust_rows.items) {
          each as $c {
            var $c_first_lower { value = (($c.first_name ?? "")|lower) }
            var $c_last_lower { value = (($c.last_name ?? "")|lower) }
            var $c_addr_lower { value = (($c.address ?? "")|lower) }
            var $c_city_lower { value = (($c.city ?? "")|lower) }
            var $combined { value = ($c_first_lower ~ " " ~ $c_last_lower ~ " " ~ $c_addr_lower ~ " " ~ $c_city_lower) }
            var $strip { value = $combined|replace:$needle:"" }
            var $combined_len { value = $combined|strlen }
            var $strip_len { value = $strip|strlen }
            conditional {
              if ($combined_len > $strip_len) {
                var.update $matched_customer_ids { value = $matched_customer_ids|push:$c.id }
              }
            }
          }
        }
      }
    }

    // Now fetch most-recent jobs for each matched customer
    var $items { value = [] }
    var $item_count { value = 0 }

    foreach ($matched_customer_ids) {
      each as $mcid {
        conditional {
          if ($item_count < 25) {
            db.query jobs {
              where  = $db.jobs.customer_id == $mcid
              sort   = {jobs.id: "desc"}
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $latest_job_rows

            var $lj_count { value = ($latest_job_rows.items|count) }

            conditional {
              if ($lj_count > 0) {
                var $j { value = $latest_job_rows.items|get:0 }
                db.get customer {
                  field_name  = "id"
                  field_value = $mcid
                } as $c2

                var $row {
                  value = {
                    job_id            : ($j.id ?? 0)
                    customer_id       : $mcid
                    customer_first    : (($c2.first_name ?? "")|trim)
                    customer_last     : (($c2.last_name ?? "")|trim)
                    customer_phone    : (($c2.phone ?? "")|trim)
                    address           : ((($j.service_address ?? ($c2.address ?? ""))|trim))
                    city              : ((($j.service_city ?? ($c2.city ?? ""))|trim))
                    zip               : ((($j.service_zip ?? ($c2.zip ?? ""))|trim))
                    appliance         : (($j.appliance_type ?? "")|trim)
                    scheduling_status : (($j.scheduling_status ?? "")|trim)
                    warranty_company  : (($j.warranty_company ?? "")|trim)
                    scheduled_start   : ($j.scheduled_start ?? null)
                    last_job_at       : ($j.created_at ?? 0)
                  }
                }

                var.update $items { value = $items|push:$row }
                var.update $item_count { value = $item_count + 1 }
              }
            }
          }
        }
      }
    }

    var $intent_str { value = "name" }
    conditional {
      if ($is_phone_query) {
        var.update $intent_str { value = "phone" }
      }
      elseif ($has_street_kw) {
        var.update $intent_str { value = "address" }
      }
    }

    var $item_count_out { value = ($items|count) }
  }

  response = {
    success      : true
    query        : $q_raw
    intent       : $intent_str
    count        : $item_count_out
    items        : $items
  }

  guid = "office-universal-search-v1"
}

// Office customer search. Strategy:
//   1. If the query has 7+ digits, try phone exact-match in 3 forms:
//      - raw digits as stored (most common: "6155550002")
//      - +1 prefixed ("+16155550002")
//      - last 10 digits ("6155550002" from any input)
//   2. Always run a name-prefix match (XS doesn't have LIKE substring,
//      so this is a starts-with match on first_name OR last_name).
// Returns up to 25 matches, decorated with latest_job + job_count.
query search_customers verb=POST {
  api_group = "intake"

  input {
    text query
  }

  stack {
    var $q_raw {
      value = ($input.query ?? "")|trim
    }
  
    precondition ($q_raw != "") {
      error_type = "inputerror"
      error = "query is required"
    }
  
    var $q_digits {
      value = $q_raw
        |replace:"+":""
        |replace:"-":""
        |replace:"(":""
        |replace:")":""
        |replace:" ":""
        |replace:".":""
    }
  
    var $q_digits_len {
      value = $q_digits|strlen
    }
  
    var $is_phoneish {
      value = ($q_digits_len >= 7)
    }
  
    // 10-digit form for matching against 10-digit stored phones
    var $q_digits_last10_start {
      value = ($q_digits_len - 10)
    }
  
    var $q_digits_last10 {
      value = ($q_digits_len >= 10 ? ($q_digits|substr:$q_digits_last10_start) : $q_digits)
    }
  
    var $q_e164 {
      value = ("+1" ~ $q_digits_last10)
    }
  
    var $matches {
      value = []
    }
  
    // Phone exact-match candidates (3 forms)
    conditional {
      if ($is_phoneish) {
        db.query customer {
          where = $db.customer.phone == $q_digits || $db.customer.phone == $q_digits_last10 || $db.customer.phone == $q_e164 || $db.customer.phone == $q_raw
          sort = {customer.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 15}}
        } as $phone_rows
      
        foreach ($phone_rows.items) {
          each as $c {
            var.update $matches {
              value = $matches|push:$c
            }
          }
        }
      }
    }
  
    // Name match. 2026-06-15: SUBSTRING + case-insensitive. Exact-match missed
    // real customers because warranty names are stored mixed: Title ("Young
    // III" — a "Young" search missed the suffix), ALL CAPS ("JOYCE MATTHEWS"),
    // etc. Xano |contains: is proven (lookup_app_help) but case-SENSITIVE, so we
    // substring-match each token in lower, Title, and UPPER forms across first
    // AND last name. Guarded to tokens >= 2 chars so we don't match everyone.
    var $q_lc_n {
      value = $q_raw|to_lower
    }
    var $name_tokens {
      value = ($q_lc_n|split:" ")
    }
    var $nt0_raw {
      value = ((($name_tokens|first) ?? "")|trim)
    }
    var $nt1_raw {
      value = (($name_tokens|count) > 1 ? (($name_tokens|get:1)|trim) : $nt0_raw)
    }
    var $nt0 {
      value = (($nt0_raw|substr:0:1|to_upper) ~ ($nt0_raw|substr:1))
    }
    var $nt1 {
      value = (($nt1_raw|substr:0:1|to_upper) ~ ($nt1_raw|substr:1))
    }
    var $nt0_u {
      value = $nt0_raw|to_upper
    }
    var $nt1_u {
      value = $nt1_raw|to_upper
    }
    var $name_ok {
      value = (($nt0_raw|strlen) >= 2)
    }
    conditional {
      if ($name_ok) {
        db.query customer {
          where = $db.customer.last_name |contains: $nt0_raw || $db.customer.last_name |contains: $nt0 || $db.customer.last_name |contains: $nt0_u || $db.customer.first_name |contains: $nt0_raw || $db.customer.first_name |contains: $nt0 || $db.customer.first_name |contains: $nt0_u || $db.customer.last_name |contains: $nt1_raw || $db.customer.last_name |contains: $nt1 || $db.customer.last_name |contains: $nt1_u || $db.customer.first_name |contains: $nt1_raw || $db.customer.first_name |contains: $nt1 || $db.customer.first_name |contains: $nt1_u
          sort = {customer.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 25}}
        } as $name_rows

        foreach ($name_rows.items) {
          each as $c {
            var.update $matches {
              value = $matches|push:$c
            }
          }
        }
      }
    }
  
    // Email exact-match (lowercased)
    var $q_lower {
      value = $q_raw|to_lower
    }
  
    db.query customer {
      where = $db.customer.email == $q_lower
      sort = {customer.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $email_rows
  
    foreach ($email_rows.items) {
      each as $c {
        var.update $matches {
          value = $matches|push:$c
        }
      }
    }
  
    // Dedupe by customer.id
    var $seen_ids {
      value = {}
    }
  
    var $unique_matches {
      value = []
    }
  
    foreach ($matches) {
      each as $m {
        var $id_key {
          value = $m.id|to_text
        }
      
        var $already {
          value = `(($seen_ids|get:$id_key) ?? null)`
        }
      
        conditional {
          if ($already == null) {
            var.update $seen_ids {
              value = $seen_ids|set:$id_key:"y"
            }
          
            var.update $unique_matches {
              value = $unique_matches|push:$m
            }
          }
        }
      }
    }
  
    // Decorate each match with latest_job + job_count
    var $decorated {
      value = []
    }
  
    var $cap {
      value = 25
    }
  
    foreach ($unique_matches) {
      each as $c {
        conditional {
          if (($decorated|count) < $cap) {
            db.query jobs {
              where = $db.jobs.customer_id == $c.id
              sort = {jobs.created_at: "desc"}
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $latest_job_rows
          
            var $latest_job {
              value = (($latest_job_rows.items|first) ?? null)
            }
          
            db.query jobs {
              where = $db.jobs.customer_id == $c.id
              return = {type: "count"}
            } as $job_count_obj
          
            var $job_count_val {
              value = ($job_count_obj ?? 0)
            }
          
            var $item {
              value = {
                customer  : $c
                latest_job: $latest_job
                job_count : $job_count_val
              }
            }
          
            var.update $decorated {
              value = $decorated|push:$item
            }
          }
        }
      }
    }
  }

  response = {
    success    : true
    query      : $q_raw
    match_count: $decorated|count
    results    : $decorated
  }

  guid = "search-customers-v1"
}
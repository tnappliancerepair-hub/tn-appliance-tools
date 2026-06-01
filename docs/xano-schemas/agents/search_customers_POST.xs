// Office customer search.
//
// 2026-05-30 v2 AUTH GATE — shared-secret key check at top of stack.
// Caller must include {key: <value>} in body matching $env.OFFICE_KEY.
//
// Strategy:
//   1. If the query has 7+ digits, try phone exact-match in 3 forms.
//   2. Always run a name-exact match.
//   3. Email exact-match (lowercased).
// Returns up to 25 matches, decorated with latest_job + job_count.

query search_customers verb=POST {
  api_group = "intake"

  input {
    text? key?
    text query
  }

  stack {
    // ── AUTH GATE: shared-secret key check ──────────────────────────
    var $key_in {
      value = (($input.key ?? "")|trim)
    }

    var $key_expected {
      value = (($env.OFFICE_KEY ?? "")|trim)
    }

    precondition ($key_expected != "" && $key_in == $key_expected) {
      error_type = "accessdenied"
      error = "Invalid or missing key"
    }

    // ── Main search ──────────────────────────────────────────────────
    var $q_raw {
      value = (($input.query ?? "")|trim)
    }

    precondition ($q_raw != "") {
      error_type = "inputerror"
      error = "query is required"
    }

    var $q_digits {
      value = ((((($q_raw|replace:"+":"")|replace:"-":"")|replace:"(":"")|replace:")":"")|replace:" ":"")
    }

    var $q_digits_len {
      value = ($q_digits|strlen)
    }

    var $is_phoneish {
      value = ($q_digits_len >= 7)
    }

    var $q_digits_last10_start {
      value = ($q_digits_len - 10)
    }

    var $q_digits_last10 {
      value = ($q_digits_len >= 10) ? ($q_digits|substr:$q_digits_last10_start) : $q_digits
    }

    var $q_e164 {
      value = ("+1" ~ $q_digits_last10)
    }

    var $matches {
      value = []
    }

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
              value = ($matches|push:$c)
            }
          }
        }
      }
    }

    db.query customer {
      where = $db.customer.first_name == $q_raw || $db.customer.last_name == $q_raw
      sort = {customer.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 15}}
    } as $name_rows

    foreach ($name_rows.items) {
      each as $c {
        var.update $matches {
          value = ($matches|push:$c)
        }
      }
    }

    var $q_lower {
      value = ($q_raw|to_lower)
    }

    db.query customer {
      where = $db.customer.email == $q_lower
      sort = {customer.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $email_rows

    foreach ($email_rows.items) {
      each as $c {
        var.update $matches {
          value = ($matches|push:$c)
        }
      }
    }

    var $seen_ids {
      value = {}
    }

    var $unique_matches {
      value = []
    }

    foreach ($matches) {
      each as $m {
        var $id_key {
          value = ($m.id|to_text)
        }

        var $already {
          value = `(($seen_ids|get:$id_key) ?? null)`
        }

        conditional {
          if ($already == null) {
            var.update $seen_ids {
              value = ($seen_ids|set:$id_key:"y")
            }

            var.update $unique_matches {
              value = ($unique_matches|push:$m)
            }
          }
        }
      }
    }

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
                customer: $c
                latest_job: $latest_job
                job_count: $job_count_val
              }
            }

            var.update $decorated {
              value = ($decorated|push:$item)
            }
          }
        }
      }
    }
  }

  response = {
    success: true
    query: $q_raw
    match_count: ($decorated|count)
    results: $decorated
  }

  guid = "search-customers-v1"
}

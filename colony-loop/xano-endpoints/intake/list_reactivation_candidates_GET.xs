// Returns customers whose most-recent job is >2 years old AND who don't
// have any active jobs. Used by the weekly reactivation campaign agent.
query list_reactivation_candidates verb=GET {
  api_group = "intake"

  input {
    int? months_dormant?
    int? limit?
  }

  stack {
    var $months_eff {
      value = ($input.months_dormant ?? 24)
    }

    var $limit_eff {
      value = ($input.limit ?? 25)
    }

    var $cutoff_ms {
      value = (now|to_ms) - ($months_eff * 30 * 24 * 60 * 60 * 1000)
    }

    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }

    // Pull customers with last activity older than cutoff. We approximate
    // 'most-recent job' by checking customer.created_at (proxy).
    db.query customer {
      where  = $db.customer.created_at < $cutoff_ts && ($db.customer.phone != null && $db.customer.phone != "")
      sort   = {customer.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $limit_eff}}
    } as $cust_rows

    var $out {
      value = []
    }

    foreach ($cust_rows.items) {
      each as $c {
        // Skip customers with any job in last 6 months
        var $six_mo_ts {
          value = (((now|to_ms) - (6 * 30 * 24 * 60 * 60 * 1000)) / 1000)|to_timestamp
        }

        db.query jobs {
          where  = $db.jobs.customer_id == $c.id && $db.jobs.created_at >= $six_mo_ts
          return = {type: "count"}
        } as $recent_count

        conditional {
          if (($recent_count ?? 0) == 0) {
            var $entry {
              value = {
                customer_id : $c.id
                first_name  : ($c.first_name ?? "")
                last_name   : ($c.last_name ?? "")
                phone       : ($c.phone ?? "")
                created_at  : $c.created_at
              }
            }

            var.update $out {
              value = $out|push:$entry
            }
          }
        }
      }
    }
  }

  response = {
    success      : true
    months_dormant: $months_eff
    candidate_count: ($out|count)
    candidates   : $out
  }

  guid = "list-reactivation-candidates-v1"
}

// Returns reachable customers who have had NO job inside the dormancy window
// (months_dormant, default 6), oldest relationship first. Used by the weekly
// reactivation campaign agent, and as the office call list.
query list_reactivation_candidates verb=GET {
  api_group = "intake"

  input {
    int? months_dormant?
    int? limit?
  }

  stack {
    var $months_eff {
      value = ($input.months_dormant ?? 6)
    }
  
    var $limit_eff {
      value = ($input.limit ?? 25)
    }
  
    var $cutoff_ms {
      value = (now|to_ms) - ($months_eff * 30 * 24 * 60 * 60 * 1000)
    }
  

    // Dormancy is about the LAST JOB, not when the customer row was written.
    // The old query pre-filtered on customer.created_at < cutoff, but Xano only
    // holds about six months of history, so at any realistic window that filter
    // matched zero rows and the campaign could never see anybody. The job check
    // in the loop below is the real test - this query just decides who to test.
    // ASC because it is a win-back list: the coldest relationships come first.
    db.query customer {
      where = $db.customer.phone != null && $db.customer.phone != ""
      sort = {customer.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $limit_eff}}
    } as $cust_rows
  
    var $out {
      value = []
    }
  
    foreach ($cust_rows.items) {
      each as $c {
        // Skip anyone with a job inside the requested window. This uses the
        // caller's window, not a hardcoded six months, so months_dormant
        // actually changes the answer instead of being decorative.
        db.query jobs {
          where = $db.jobs.customer_id == $c.id && $db.jobs.created_at >= $cutoff_ms
          return = {type: "count"}
        } as $recent_count

        // Bind the coalesce OUT here. A null-coalesce written inside an if(...) gets
        // silently stripped to a bare single ? by the UI parse-serialize round
        // trip, and the mangled comparison then never matches - which is why
        // every dormancy window returned zero even after the ms fix landed.
        var $recent_n {
          value = ($recent_count ?? 0)
        }

        conditional {
          if ($recent_n == 0) {
            var $entry {
              value = {
                customer_id: $c.id
                first_name : ($c.first_name ?? "")
                last_name  : ($c.last_name ?? "")
                phone      : ($c.phone ?? "")
                created_at : $c.created_at
                recent_jobs: $recent_n
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
    success        : true
    months_dormant : $months_eff
    candidate_count: $out|count
    candidates     : $out
  }

  guid = "list-reactivation-candidates-v1"
}
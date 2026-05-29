// Re-engagement candidate list — customers whose MOST RECENT
// completed job falls within months_min..months_max ago. Returns
// fields the agent uses to compose a personalized SMS.
query list_re_engagement_candidates verb=GET {
  api_group = "intake"

  input {
    int? months_min?
    int? months_max?
    int? limit?
  }

  stack {
    var $mmin { value = ($input.months_min ?? 6) }
    var $mmax { value = ($input.months_max ?? 12) }
    var $lim  { value = ($input.limit ?? 200) }

    var $cutoff_max_ms { value = ((now|to_ms) - ($mmax * 30 * 86400000)) }
    var $cutoff_min_ms { value = ((now|to_ms) - ($mmin * 30 * 86400000)) }

    // Pull completed jobs in the window (most recent first per customer)
    db.query jobs {
      filter {
        $this.scheduling_status == "completed"
        && $this.parallel_mode == true
        && $this.job_completed_at >= $cutoff_max_ms
        && $this.job_completed_at <= $cutoff_min_ms
      }
      sort = {job_completed_at: "desc"}
      per_page = ($lim * 2)
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }
    var $seen_customers { value = {} }

    foreach ($job in $rows.items) {
      var $cid_key { value = "c" ~ ($job.customer_id ?? 0) }
      conditional {
        if (!($seen_customers[$cid_key] ?? false) && $count < $lim) {
          var.update $seen_customers { value = ($seen_customers|set:$cid_key:true) }
          db.get customer {
            field_name  = "id"
            field_value = ($job.customer_id ?? 0)
          } as $cust
          conditional {
            if ($cust != null && ($cust.phone ?? "") != "") {
              var $months_since { value = (((now|to_ms) - $job.job_completed_at) / 2592000000) }
              var $entry {
                value = {
                  id                    : $cust.id
                  first_name            : ($cust.first_name ?? "")
                  last_name             : ($cust.last_name ?? "")
                  phone                 : ($cust.phone ?? "")
                  last_appliance        : ($job.appliance_type ?? "")
                  last_job_completed_at : $job.job_completed_at
                  months_since_last_job : $months_since
                }
              }
              var $items { value = $items|push:$entry }
              var $count { value = ($count + 1) }
            }
          }
        }
      }
    }
  }

  response = {
    items: $items
    count: $count
  }

  guid = "list-re-engagement-candidates-v1"
}

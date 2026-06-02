// Jobs that landed via vendor dispatch but need a human Accept click
// before they go onto tech dashboards. Currently SquareTrade dispatches
// (which require accepting on the SP/SquareTrade portal before booking).
// Surfaces on Office Today so Teddy/Danielle see them first thing.
query list_pending_accept_jobs verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $lim_raw { value = ($input.limit ?? 50) }
    var $lim { value = ($lim_raw > 200) ? 200 : $lim_raw }
    var $now_ms { value = (now|to_ms) }

    db.query jobs {
      where = $db.jobs.scheduling_status == "needs_more_info" && ($db.jobs.warranty_company == "SquareTrade" || $db.jobs.friendly_status == "SquareTrade — Needs Accept")
      sort = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows

    var $jobs_out { value = [] }

    foreach ($rows.items) {
      each as $j {
        var $cust_id { value = ($j.customer_id ?? 0) }
        var $cust { value = null }
        conditional {
          if ($cust_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id
            } as $cust_lookup
            var.update $cust { value = $cust_lookup }
          }
        }

        var $first_name { value = (($cust.first_name ?? "")|trim) }
        var $last_name { value = (($cust.last_name ?? "")|trim) }
        var $cust_name { value = ($first_name ~ " " ~ $last_name)|trim }

        var $item {
          value = {
            job_id          : $j.id
            customer_id     : $cust_id
            customer_name   : $cust_name
            customer_phone  : (($cust.phone ?? "")|trim)
            warranty_company: ($j.warranty_company ?? "")
            appliance_type  : ($j.appliance_type ?? "")
            brand           : ($j.brand ?? "")
            problem_summary : ($j.problem_summary ?? "")
            service_city    : ($j.service_city ?? "")
            service_zip     : ($j.service_zip ?? "")
            scheduled_start : ($j.scheduled_start ?? 0)
            claim_number    : ($j.claim_number ?? "")
            age_hours       : (($now_ms - ($j.created_at|to_ms)) / 3600000)
          }
        }

        var.update $jobs_out {
          value = $jobs_out|push:$item
        }
      }
    }
  }

  response = {
    success: true
    jobs   : $jobs_out
    count  : ($jobs_out|count)
  }

  guid = "list-pending-accept-jobs-v1"
}

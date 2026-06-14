//  Route-aware day suggestion (smart routing Part 2). Returns a tech's
//  upcoming scheduled stops over the next N days, each tagged with its
//  cluster (looked up from the zip via service_zone). The schedule cards
//  group these by day and suggest the day where the tech already has stops
//  in the same cluster, so the route densifies instead of scattering.
//
//  Read-only. XS rules: no em-dashes, no try/catch, ?? and |trim only
//  inside value = (...), (($rows.items|first) ?? null), |count not |length.
query get_tech_route_days verb=GET {
  api_group = "intake"

  input {
    int technician_id
    int? days?
  }

  stack {
    precondition ($input.technician_id > 0) {
      error_type = "inputerror"
      error = "technician_id required"
    }

    var $days_raw {
      value = ($input.days ?? 14)
    }

    var $days {
      value = ($days_raw > 30) ? 30 : (($days_raw < 1) ? 14 : $days_raw)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $end_ms {
      value = ($now_ms + ($days * 86400000))
    }

    //  The tech's scheduled stops inside the window. Day-start cushion of
    //  one day back so a job booked earlier today still counts.
    var $floor_ms {
      value = ($now_ms - 86400000)
    }

    db.query jobs {
      where = $db.jobs.technician_id == $input.technician_id && $db.jobs.scheduled_start != null && $db.jobs.scheduled_start >= $floor_ms && $db.jobs.scheduled_start <= $end_ms
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $job_rows

    var $stops {
      value = []
    }

    foreach ($job_rows.items) {
      each as $job {
        var $zip {
          value = (($job.service_zip ?? "")|trim)
        }

        var $cluster {
          value = ""
        }

        conditional {
          if ($zip != "") {
            db.query service_zone {
              where = $db.service_zone.zip_code == $zip
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $zrows

            var $zr {
              value = (($zrows.items|first) ?? null)
            }

            var.update $cluster {
              value = (($zr ?? {cluster: ""}).cluster ?? "")
            }
          }
        }

        var $stop {
          value = {
            job_id            : $job.id
            scheduled_start_ms: ($job.scheduled_start ?? 0)
            zip               : $zip
            city              : (($job.service_city ?? "")|trim)
            cluster           : $cluster
            appliance         : (($job.appliance_type ?? "")|trim)
          }
        }

        var.update $stops {
          value = $stops|push:$stop
        }
      }
    }
  }

  response = {
    success       : true
    technician_id : $input.technician_id
    window_days   : $days
    now_ms        : $now_ms
    stop_count    : $stops|count
    stops         : $stops
  }

  guid = "get-tech-route-days-v1"
}

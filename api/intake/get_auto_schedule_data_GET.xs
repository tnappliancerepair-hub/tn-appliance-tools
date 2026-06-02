// Single bundle for the auto-schedule matcher. Returns:
//   - job (just the fields the matcher needs)
//   - customer availability grid (the JSON string already on jobs)
//   - active techs (with hours, days-off rules, weekend opt-in,
//     service-area data when populated)
//   - tech_availability rows for the next 21 days (so the matcher can
//     skip day-offs)
//
// The matching algorithm runs in the JS agent — XS is just the data
// pull. Keeps the logic in one place + testable.
query get_auto_schedule_data verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return { value = { success: false, error: "job_not_found" } }
      }
    }

    db.query technicians {
      where = $db.technicians.active == true
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $techs

    var $now_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }

    var $today_str {
      value = $now_ct_ts|format_timestamp:"Y-m-d"
    }

    var $cutoff_str {
      value = $now_ct_ts|transform_timestamp:"+21 days"|format_timestamp:"Y-m-d"
    }

    db.query tech_availability {
      where = $db.tech_availability.blocked_date >= $today_str && $db.tech_availability.blocked_date <= $cutoff_str
      sort = {tech_availability.blocked_date: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $avail

    // Cluster lookup: service_zone (zip → cluster) → cluster_assignment
    // (cluster → tech_id + rank). Lets the matcher only consider techs
    // who cover this customer's zip area. Lower rank = higher priority
    // (1 = primary, 3 = overflow).
    var $job_zip {
      value = (($job.service_zip|to_text) ?? "")|trim
    }

    db.query service_zone {
      where = $db.service_zone.zip_code == $job_zip
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $sz_rows

    var $cluster_name {
      value = ""
    }

    conditional {
      if (($sz_rows.items|count) > 0) {
        var $first_sz {
          value = ($sz_rows.items|get:0)
        }
        var.update $cluster_name {
          value = (($first_sz.cluster|to_text) ?? "")|trim
        }
      }
    }

    var $cluster_techs_out {
      value = []
    }

    conditional {
      if ($cluster_name != "") {
        db.query cluster_assignment {
          where = $db.cluster_assignment.cluster == $cluster_name && $db.cluster_assignment.active == true
          sort = {cluster_assignment.rank: "asc"}
          return = {type: "list", paging: {page: 1, per_page: 30}}
        } as $ca_rows

        foreach ($ca_rows.items) {
          each as $ca {
            var.update $cluster_techs_out {
              value = $cluster_techs_out|push:{technician_id: ($ca.technician_id ?? 0), rank: ($ca.rank ?? 99)}
            }
          }
        }
      }
    }
  }

  response = {
    success                  : true
    job_id                   : $job.id
    customer_id              : ($job.customer_id ?? 0)
    service_zip              : $job_zip
    appliance_type           : (($job.appliance_type|to_text) ?? "")
    customer_availability_grid: (($job.customer_availability_grid|to_text) ?? "")
    today_ct                 : $today_str
    techs                    : $techs.items
    availability_blocks      : $avail.items
    preassigned_tech_id      : ($job.technician_id ?? 0)
    cluster                  : $cluster_name
    cluster_techs            : $cluster_techs_out
  }

  guid = "get-auto-schedule-data-v1"
}

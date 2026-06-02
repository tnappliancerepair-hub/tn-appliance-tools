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
  }

  response = {
    success                  : true
    job_id                   : $job.id
    customer_id              : ($job.customer_id ?? 0)
    service_zip              : (($job.service_zip|to_text) ?? "")
    appliance_type           : (($job.appliance_type|to_text) ?? "")
    customer_availability_grid: (($job.customer_availability_grid|to_text) ?? "")
    today_ct                 : $today_str
    techs                    : $techs.items
    availability_blocks      : $avail.items
  }

  guid = "get-auto-schedule-data-v1"
}

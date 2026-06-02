// Bundle for tech-scheduler.html. Returns:
//   - tech profile (all new + existing fields)
//   - upcoming jobs in the next N days (default 14)
//   - tech_availability blocks (day-off / partial blocks) in window
// Single round-trip so the page renders fast.
query get_tech_scheduler_data verb=GET {
  api_group = "intake"

  input {
    int tech_id
    int? days_forward?
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    conditional {
      if ($tech == null) {
        return {
          value = {
            success: false
            error  : "tech_not_found"
            tech_id: $input.tech_id
          }
        }
      }
    }

    var $days {
      value = ($input.days_forward ?? 14)
    }

    var $now_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }

    var $today_ct_str {
      value = $now_ct_ts|format_timestamp:"Y-m-d"
    }

    var $day_start_utc {
      value = (($today_ct_str ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }

    var $window_end_utc {
      value = $day_start_utc|transform_timestamp:("+" ~ ($days|to_text) ~ " days")
    }

    db.query jobs {
      where = $db.jobs.technician_id == $input.tech_id && $db.jobs.scheduled_start >= $day_start_utc && $db.jobs.scheduled_start < $window_end_utc && $db.jobs.scheduling_status != "canceled"
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows

    db.query tech_availability {
      where = $db.tech_availability.technician_id == $input.tech_id && $db.tech_availability.blocked_date >= $today_ct_str
      sort = {tech_availability.blocked_date: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $avail_rows
  }

  response = {
    success           : true
    tech              : $tech
    today_ct          : $today_ct_str
    days_forward      : $days
    jobs              : $job_rows.items
    availability      : $avail_rows.items
    window_start_utc  : $day_start_utc
    window_end_utc    : $window_end_utc
  }

  guid = "get-tech-scheduler-data-v1"
}

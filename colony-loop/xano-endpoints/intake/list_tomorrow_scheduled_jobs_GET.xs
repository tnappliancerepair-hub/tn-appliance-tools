// Returns all jobs scheduled tomorrow CT, with customer + tech joined.
// Used by appointment_no_show_predictor.
query list_tomorrow_scheduled_jobs verb=GET {
  api_function

  api_group = "intake"

  stack {
    var $now_ms { value = now|to_ms }
    var $tomorrow_start { value = ($now_ms + 86400000) }
    var $tomorrow_end   { value = ($now_ms + 172800000) }

    db.query jobs {
      filter {
        $this.scheduling_status == "scheduled"
        && $this.scheduled_start >= $tomorrow_start
        && $this.scheduled_start <  $tomorrow_end
        && $this.parallel_mode == true
      }
      sort = {scheduled_start: "asc"}
      per_page = 100
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }

    foreach ($job in $rows.items) {
      db.get customer {
        field_name  = "id"
        field_value = ($job.customer_id ?? 0)
      } as $cust
      db.get technicians {
        field_name  = "id"
        field_value = ($job.technician_id ?? 0)
      } as $tech

      var $cust_name { value = ($cust != null) ? (($cust.first_name ?? "") ~ " " ~ ($cust.last_name ?? "")) : "" }
      var $sched_ct { value = $job.scheduled_start|format_datetime:"D g:i A":"America/Chicago" }

      // Check waiver status
      var $waiver_needle { value = "\"job_id\":" ~ $job.id }
      db.query event_log {
        filter {
          $this.action == "waiver_submitted"
          && $this.metadata contains $waiver_needle
        }
        per_page = 1
      } as $waiver_rows
      var $waiver_signed { value = (($waiver_rows.items|first) != null) }

      var $entry {
        value = {
          id                : $job.id
          customer_id       : ($job.customer_id ?? 0)
          customer_name     : $cust_name|trim
          appliance_type    : ($job.appliance_type ?? "")
          scheduled_start_ms: $job.scheduled_start
          scheduled_start_ct: $sched_ct
          tech_first_name   : ($tech != null) ? ($tech.first_name ?? "") : ""
          waiver_signed     : $waiver_signed
        }
      }
      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    items: $items
    count: $count
  }

  guid = "list-tomorrow-scheduled-jobs-v1"
}

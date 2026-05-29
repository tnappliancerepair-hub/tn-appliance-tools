// Lightweight jobs-by-status lookup used by stuck_job_detector +
// any agent that needs to scan a single status bucket. Joins tech +
// customer first names for SMS-friendly output.
query list_jobs_by_status verb=GET {
  api_group = "intake"

  input {
    text status filters=trim
    int? limit?
  }

  stack {
    precondition ($input.status != "") {
      error_type = "inputerror"
      error      = "status required"
    }

    var $lim { value = ($input.limit ?? 200) }

    db.query jobs {
      filter {
        $this.scheduling_status == $input.status
        && $this.parallel_mode == true
      }
      sort = {updated_at: "desc"}
      per_page = $lim
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
      var $tech_first { value = ($tech != null) ? ($tech.first_name ?? "") : "" }

      var $entry {
        value = {
          id                : $job.id
          customer_name     : $cust_name|trim
          appliance_type    : ($job.appliance_type ?? "")
          brand             : ($job.brand ?? "")
          tech_first_name   : $tech_first
          warranty_company  : ($job.warranty_company ?? "")
          scheduled_start   : ($job.scheduled_start ?? 0)
          created_at        : $job.created_at
          updated_at        : $job.updated_at
        }
      }
      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    status: $input.status
    items : $items
    count : $count
  }

  guid = "list-jobs-by-status-v1"
}

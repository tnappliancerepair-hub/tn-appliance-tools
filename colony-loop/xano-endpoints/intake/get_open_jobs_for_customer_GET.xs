// Open jobs for a customer — what the phone brain needs to answer
// "what's the status of my appointment?" without asking.
//
// Filters: scheduling_status NOT in (completed, canceled). Includes
// tech first_name (joined), CT-formatted scheduled_start, parts hints.
query get_open_jobs_for_customer verb=GET {
  api_group = "intake"

  input {
    int customer_id
    int? limit?
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    var $lim { value = ($input.limit ?? 5) }
    var $excluded_statuses { value = ["completed", "canceled", "no_fix_possible"] }

    db.query jobs {
      filter {
        $this.customer_id == $input.customer_id
        && !($this.scheduling_status in $excluded_statuses)
      }
      sort = {scheduled_start: "desc"}
      per_page = $lim
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }

    foreach ($job in $rows.items) {
      db.get technicians {
        field_name  = "id"
        field_value = ($job.technician_id ?? 0)
      } as $tech

      var $tech_first { value = ($tech != null) ? ($tech.first_name ?? "") : "" }
      var $sched_ms { value = ($job.scheduled_start ?? 0) }
      var $sched_ct { value = ($sched_ms > 0) ? ($sched_ms|format_datetime:"M j, g:i A":"America/Chicago") : "" }

      var $entry {
        value = {
          id                : $job.id
          appliance_type    : ($job.appliance_type ?? "")
          brand             : ($job.brand ?? "")
          model_number      : ($job.model_number ?? "")
          problem_summary   : ($job.problem_summary ?? "")
          scheduling_status : ($job.scheduling_status ?? "")
          current_status    : ($job.current_status ?? "")
          scheduled_start_ms: $sched_ms
          scheduled_start_ct: $sched_ct
          technician_id     : ($job.technician_id ?? 0)
          tech_first_name   : $tech_first
          parts_status      : ($job.parts_status ?? "")
          parts_eta_date    : ($job.parts_eta_date ?? null)
          warranty_company  : ($job.warranty_company ?? "")
          claim_number      : ($job.claim_number ?? "")
        }
      }

      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    customer_id: $input.customer_id
    items      : $items
    count      : $count
  }

  guid = "get-open-jobs-for-customer-v1"
}

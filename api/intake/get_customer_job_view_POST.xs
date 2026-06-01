//  Read-only customer-facing job view. Used by customer-portal.html — the
//  link Ant sends in greeting/confirmation SMS includes ?job_id=X&last4=YYYY.
// 
//  Returns the minimal data needed to render the portal: status, tech first
//  name, appointment time, ETA when en-route. Phone-last4 gate prevents
//  random URL probing. POST keeps the last4 out of access logs.
query get_customer_job_view verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
  }

  stack {
    var $supplied_last4 {
      value = (($input.phone_last4 ?? "")|trim)
    }
  
    precondition ($supplied_last4 != "") {
      error_type = "inputerror"
      error = "phone_last4 is required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }
  
    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found for this job"
    }
  
    var $stored_digits {
      value = (($customer.phone ?? "")|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"")
    }
  
    var $stored_len {
      value = $stored_digits|strlen
    }
  
    var $stored_last4_start {
      value = ($stored_len - 4)
    }
  
    var $stored_last4 {
      value = ""
    }
  
    conditional {
      if ($stored_len >= 4) {
        var.update $stored_last4 {
          value = $stored_digits|substr:$stored_last4_start
        }
      }
    }
  
    precondition ($stored_last4 != "" && $stored_last4 == $supplied_last4) {
      error_type = "unauthorized"
      error = "phone_last4 does not match"
    }
  
    // Tech lookup
    var $tech {
      value = null
    }
  
    conditional {
      if ($job.technician_id != null && $job.technician_id > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $job.technician_id
        } as $tech_full
      
        var.update $tech {
          value = {
            id        : ($tech_full.id ?? 0)
            first_name: ($tech_full.first_name ?? "")
            last_name : ($tech_full.last_name ?? "")
          }
        }
      }
    }
  
    // Derive view-state
    var $sched_status {
      value = ($job.scheduling_status ?? "")
    }
  
    var $is_on_way {
      value = (($job.tech_en_route_at ?? null) != null && ($job.job_started_at ?? null) == null && $sched_status != "canceled")
    }
  
    var $is_in_progress {
      value = ($sched_status == "in_progress")
    }
  
    var $is_completed {
      value = ($sched_status == "completed" || $sched_status == "awaiting_parts" || $sched_status == "held" || $sched_status == "no_fix_possible")
    }
  
    var $view_state {
      value = ($sched_status == "canceled" ? "canceled" : ($is_completed ? "completed" : ($is_in_progress ? "in_progress" : ($is_on_way ? "on_way" : "scheduled"))))
    }
  }

  response = {
    success   : true
    job       : ```
      {
        id                  : $job.id
        scheduling_status   : $sched_status
        current_status      : ($job.current_status ?? "")
        appliance           : ($job.appliance ?? "")
        brand               : ($job.brand ?? "")
        problem_summary     : ($job.problem_summary ?? "")
        scheduled_start     : $job.scheduled_start
        eta_ms              : ($job.eta_ms ?? null)
        tech_en_route_at    : ($job.tech_en_route_at ?? null)
        job_started_at      : ($job.job_started_at ?? null)
        job_completed_at    : ($job.job_completed_at ?? null)
        parts_status        : ($job.parts_status ?? "")
        parts_eta_date      : ($job.parts_eta_date ?? null)
        access_notes        : ($job.access_notes ?? "")
        customer_preference_text: ($job.customer_preference_text ?? "")
      }
      ```
    customer  : ```
      {
        id        : $customer.id
        first_name: ($customer.first_name ?? "")
      }
      ```
    tech      : $tech
    view_state: $view_state
  }

  guid = "get-customer-job-view-v1"
}
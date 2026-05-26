// Single round-trip context for the try_auto_schedule agent
// (signal_type=JOB_INTAKE_COMPLETE handler). Returns enough job/customer
// state for the agent's gates plus two existence checks:
//   - has_pre_diagnosis: any TDR with technician_id=1 (Teddy's pre-diag)
//   - pending_propose_count: 1 if there's already a pending propose row
//     for this job (de-dup against re-firing the scheduler).
query get_auto_schedule_context verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error      = "job_id is required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    var $customer { value = null }

    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name  = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }

    db.query technician_decision_report {
      where  = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == 1
      sort   = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tdr_rows

    var $tdr_first {
      value = (($tdr_rows.items|first) ?? null)
    }

    var $has_pre_diagnosis {
      value = ($tdr_first != null)
    }

    db.query scheduling_queue {
      where  = $db.scheduling_queue.job_id == $input.job_id && $db.scheduling_queue.action_type == "propose" && $db.scheduling_queue.status == "pending"
      sort   = {scheduling_queue.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $pending_rows

    var $pending_first {
      value = (($pending_rows.items|first) ?? null)
    }

    var $pending_propose_count {
      value = ($pending_first != null) ? 1 : 0
    }
  }

  response = {
    success               : true
    job_id                : $job.id
    job                   : {
      warranty_company : ($job.warranty_company ?? "")
      parts_status     : ($job.parts_status ?? "")
      scheduling_status: ($job.scheduling_status ?? "")
      appliance_type   : ($job.appliance_type ?? "")
      brand            : ($job.brand ?? "")
      customer_type    : ($job.customer_type ?? "")
      scheduled_start  : ($job.scheduled_start ?? null)
    }
    customer              : {
      first_name: ($customer.first_name ?? "")
      last_name : ($customer.last_name ?? "")
      phone     : ($customer.phone ?? "")
    }
    has_pre_diagnosis     : $has_pre_diagnosis
    pending_propose_count : $pending_propose_count
  }

  guid = "get-auto-schedule-context-v1"
}

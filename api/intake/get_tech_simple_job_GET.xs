// Lightweight job loader for tech-simple.html — only the fields the
// stripped tech page actually needs. Much faster than
// get_job_for_dashboard which returns a heavy bundle.
query get_tech_simple_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $customer { value = null }
    conditional {
      if (($job.customer_id ?? 0) > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $c
        var.update $customer { value = $c }
      }
    }

    // Teddy's pre-diag = most recent TDR from technician_id=1
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == 1
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $teddy_tdr_rows

    // Attachments — completed uploads only, top 12
    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id && $db.job_attachments.upload_complete_at != null
      sort  = {job_attachments.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 12}}
    } as $att_rows
  }

  response = {
    success: true
    job: {
      id              : $job.id
      appliance_type  : ($job.appliance_type ?? "")
      appliance_brand : ($job.appliance_brand ?? "")
      appliance_model : ($job.appliance_model ?? "")
      problem_summary : ($job.problem_summary ?? "")
      scheduled_start : ($job.scheduled_start ?? null)
      scheduling_status: ($job.scheduling_status ?? "")
      current_status  : ($job.current_status ?? "")
      service_address : ($job.service_address ?? "")
    }
    customer: $customer
    appliance: {
      brand : ($job.appliance_brand ?? "")
      type  : ($job.appliance_type ?? "")
      model : ($job.appliance_model ?? "")
    }
    all_tdrs   : ($teddy_tdr_rows.items ?? [])
    attachments: ($att_rows.items ?? [])
  }

  guid = "get-tech-simple-job-v1"
}

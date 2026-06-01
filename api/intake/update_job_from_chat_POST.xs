//  Updates an EXISTING job from resume-mode chat (warranty customers landing
//  via the SMS greeting link with ?job_id=X&mode=resume). Does NOT create a
//  new job. Validates that the supplied phone_last4 matches the stored
//  customer phone before writing.
// 
//  Emits JOB_INTAKE_COMPLETE colony_signal on success so the loop can
//  downstream-trigger try_auto_schedule once pre-diagnosis + parts gate is
//  satisfied.
query update_job_from_chat verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
    text? customer_preference_text?
    text? customer_unavailability_text?
    text? scheduling_type?
    text? access_notes?
    text? appliance_type?
    text? brand?
    text? model_number?
    text? problem_summary?
  }

  stack {
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }
  
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
  
    var $new_avail {
      value = (($input.customer_preference_text ?? "")|trim)
    }
  
    var $new_unavail {
      value = (($input.customer_unavailability_text ?? "")|trim)
    }
  
    // Pack availability + unavailability into the single
    // customer_preference_text column with structured markers so the
    // auto-scheduler can parse both halves. Schema-change-free.
    var $combined_pref_raw {
      value = ($new_avail != "" ? ("AVAIL: " ~ $new_avail) : "") ~ (($new_avail != "" && $new_unavail != "") ? "\n" : "") ~ ($new_unavail != "" ? ("UNAVAIL: " ~ $new_unavail) : "")
    }
  
    var $combined_pref {
      value = $combined_pref_raw|trim
    }
  
    var $new_sched_type {
      value = (($input.scheduling_type ?? "")|trim)
    }
  
    var $new_access {
      value = (($input.access_notes ?? "")|trim)
    }
  
    var $new_appliance {
      value = (($input.appliance_type ?? "")|trim)
    }
  
    var $new_brand {
      value = (($input.brand ?? "")|trim)
    }
  
    var $new_model {
      value = (($input.model_number ?? "")|trim)
    }
  
    var $new_problem {
      value = (($input.problem_summary ?? "")|trim)
    }
  
    var $merged_pref {
      value = $combined_pref != "" ? $combined_pref : ($job.customer_preference_text ?? "")
    }
  
    var $merged_sched {
      value = $new_sched_type != "" ? $new_sched_type : ($job.scheduling_type ?? "")
    }
  
    var $merged_access {
      value = $new_access != "" ? $new_access : ($job.access_notes ?? "")
    }
  
    var $merged_appliance {
      value = $new_appliance != "" ? $new_appliance : ($job.appliance_type ?? "")
    }
  
    var $merged_brand {
      value = $new_brand != "" ? $new_brand : ($job.brand ?? "")
    }
  
    var $merged_model {
      value = $new_model != "" ? $new_model : ($job.model_number ?? "")
    }
  
    var $merged_problem {
      value = $new_problem != "" ? $new_problem : ($job.problem_summary ?? "")
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        customer_preference_text: $merged_pref
        scheduling_type         : $merged_sched
        access_notes            : $merged_access
        appliance_type          : $merged_appliance
        brand                   : $merged_brand
        model_number            : $merged_model
        problem_summary         : $merged_problem
      }
    } as $updated
  
    db.add event_log {
      data = {
        action  : "resume_chat_job_updated"
        metadata: {
        job_id                  : $input.job_id
        customer_id             : $customer.id
        customer_preference_text: $merged_pref
        scheduling_type         : $merged_sched
        access_notes_len        : $merged_access|strlen
        appliance_type          : $merged_appliance
        brand                   : $merged_brand
        model_number            : $merged_model
        problem_summary_len     : $merged_problem|strlen
      }
      }
    } as $log
  
    var $intake_payload_obj {
      value = {
        job_id                  : $input.job_id
        customer_id             : $customer.id
        customer_phone          : ($customer.phone ?? "")
        customer_first_name     : ($customer.first_name ?? "")
        appliance_type          : $merged_appliance
        brand                   : $merged_brand
        model_number            : $merged_model
        problem_summary         : $merged_problem
        source                  : "resume_chat"
        customer_preference_text: $merged_pref
        scheduling_type         : $merged_sched
        access_notes            : $merged_access
      }
    }
  
    var $intake_payload_str {
      value = $intake_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "JOB_INTAKE_COMPLETE"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $intake_payload_str
      }
    } as $signal
  }

  response = {
    success                 : true
    job_id                  : $input.job_id
    signal_id               : $signal.id
    customer_preference_text: $merged_pref
    scheduling_type         : $merged_sched
    access_notes            : $merged_access
    appliance_type          : $merged_appliance
    brand                   : $merged_brand
    model_number            : $merged_model
    problem_summary         : $merged_problem
  }

  guid = "update-job-from-chat-v1"
}
// Returns full triage information about a specific job for the internal dashboard.
// Returns full triage information about a specific job for the internal dashboard.
query get_job_for_dashboard verb=POST {
  api_group = "intake"

  input {
    // The ID of the job to retrieve.
    int job_id
  }

  stack {
    // 1. Validate that job_id is provided and greater than 0.
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }
  
    // 2. Fetch the job from the jobs table by id.
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    // If not found, return an error.
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    // 3. Fetch the customer from the customer table.
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
  
    // 4. Fetch the technician from the technicians table.
    var $tech_record {
      value = null
    }
  
    conditional {
      if ($job.technician_id != null && $job.technician_id > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $job.technician_id
        } as $tech_record
      }
    }
  
    // Prepare derived values
  
    // Customer Name: first + last (trimmed) or null
    var $customer_name {
      value = null
    }
  
    conditional {
      if ($customer != null) {
        var.update $customer_name {
          value = (($customer.first_name ?? "") ~ " " ~ ($customer.last_name ?? ""))|trim
        }
      }
    }
  
    // Tech Name: first + last (trimmed) or null
    var $tech_name {
      value = null
    }
  
    conditional {
      if ($tech_record != null) {
        var.update $tech_name {
          value = (($tech_record.first_name ?? "") ~ " " ~ ($tech_record.last_name ?? ""))|trim
        }
      }
    }
  
    // Address fallbacks: Use job.service_X if it has a value, otherwise customer.X
    var $res_address {
      value = null
    }
  
    var $res_city {
      value = null
    }
  
    var $res_state {
      value = null
    }
  
    var $res_zip {
      value = null
    }
  
    // Address
    conditional {
      if (($job.service_address|trim) != "") {
        var.update $res_address {
          value = $job.service_address
        }
      }
    
      else {
        var.update $res_address {
          value = $customer.address ?? null
        }
      }
    }
  
    // City
    conditional {
      if (($job.service_city|trim) != "") {
        var.update $res_city {
          value = $job.service_city
        }
      }
    
      else {
        var.update $res_city {
          value = $customer.city ?? null
        }
      }
    }
  
    // State
    conditional {
      if (($job.service_state|trim) != "") {
        var.update $res_state {
          value = $job.service_state
        }
      }
    
      else {
        var.update $res_state {
          value = $customer.state ?? null
        }
      }
    }
  
    // Zip
    conditional {
      if (($job.service_zip|trim) != "") {
        var.update $res_zip {
          value = $job.service_zip
        }
      }
    
      else {
        var.update $res_zip {
          value = $customer.zip ?? null
        }
      }
    }
  
    // Compute days_since_created (mirrors get_jobs_for_dashboard pattern).
    var $now_ms_for_job {
      value = now|to_ms
    }
  
    var $days_since_created {
      value = (($now_ms_for_job - ($job.created_at|to_ms)) / 86400000)|to_int
    }
  
    // Most recent TDR for this job (nullable - many jobs have none).
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "single"}
    } as $tdr_record
  
    // Recent events for this job (filter on metadata.job_id JSON path).
    db.query event_log {
      where = $db.event_log.metadata.job_id == $input.job_id
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $events_query
  
    var $events_trimmed {
      value = []
    }
  
    foreach ($events_query.items) {
      each as $ev {
        array.push $events_trimmed {
          value = {
            action    : $ev.action
            created_at: $ev.created_at
            metadata  : $ev.metadata
          }
        }
      }
    }
  
    // Earnings for this job (one row per tech who worked it).
    db.query tech_earnings {
      where = $db.tech_earnings.job_id == $input.job_id
      sort = {tech_earnings.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $earnings_query
  
    var $earnings_trimmed {
      value = []
    }
  
    foreach ($earnings_query.items) {
      each as $e {
        array.push $earnings_trimmed {
          value = {
            tech_id          : $e.tech_id
            commission_rate  : $e.commission_rate
            commission_earned: $e.commission_earned
            status           : $e.status
            earned_at        : $e.earned_at
          }
        }
      }
    }
  
    // 5. Build the clean response object.
    var $result {
      value = {
        success      : true
        job          : {
          id: $job.id,
          job_number: $job.job_number,
          created_at: $job.created_at,
          current_status: $job.current_status,
          friendly_status: $job.friendly_status,
          job_status: $job.job_status,
          payment_status: $job.payment_status,
          recommended_service: $job.recommended_service,
          customer_type: $job.customer_type,
          source_type: $job.source_type,
          scheduled_start: $job.scheduled_start,
          scheduled_end: $job.scheduled_end,
          service_eta_window: $job.service_eta_window,
          scheduling_status: $job.scheduling_status,
          days_since_created: $days_since_created,
          hcp_assigned_to: $job.hcp_assigned_to,
          housecall_pro_job_id: $job.housecall_pro_job_id,
          parts_decision: $job.parts_decision,
          parts_supplier: $job.parts_supplier,
          parts_eta_date: $job.parts_eta_date,
          parts_ordered_at: $job.parts_ordered_at,
          parts_status: $job.parts_status,
          tech_en_route_at: $job.tech_en_route_at,
          job_started_at: $job.job_started_at,
          job_completed_at: $job.job_completed_at,
          time_on_site_minutes: $job.time_on_site_minutes
        }
        appliance    : {
          type: $job.appliance_type,
          brand: $job.brand,
          model_number: $job.model_number,
          serial_number: $job.serial_number,
          problem_summary: $job.problem_summary,
          problem_description: $job.problem_description
        }
        customer     : {
          id: $customer.id ?? null,
          name: $customer_name,
          first_name: $customer.first_name ?? null,
          last_name: $customer.last_name ?? null,
          phone: $customer.phone ?? null,
          email: $customer.email ?? null,
          address: $res_address,
          city: $res_city,
          state: $res_state,
          zip: $res_zip
        }
        tech         : {
          id: $tech_record.id ?? null,
          name: $tech_name
        }
        tdr          : {
          diagnosis                : ($tdr_record.diagnosis ?? null)
          customer_facing_diagnosis: ($tdr_record.customer_facing_diagnosis ?? null)
          status                   : ($tdr_record.status ?? null)
          verified_part_number     : ($tdr_record.verified_part_number ?? null)
          technician_notes         : ($tdr_record.technician_notes ?? null)
          report_date              : ($tdr_record.report_date ?? null)
          failed_component         : ($tdr_record.failed_component ?? null)
          labor_time_hours         : ($tdr_record.labor_time_hours ?? null)
          repair_completed         : ($tdr_record.repair_completed ?? null)
        }
        recent_events: $events_trimmed
        earnings     : $earnings_trimmed
      }
    }
  }

  response = $result
  guid = "hnoagknyOloZ_0nrhcwAt00T5F0"
}
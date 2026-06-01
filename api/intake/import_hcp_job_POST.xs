//  HCP migration import — single-job import unit.
//  Called by colony-loop/scripts/hcp-migration-import.js for every open HCP
//  job. Idempotent on housecall_pro_job_id: insert if new, update if exists.
// 
//  Customer resolution: match by phone first, create if missing.
//  Tech resolution: map hcp_assigned_pro_id → technician_id via the same
//  table used by hcp_poll_recent_jobs (skipped here — caller can pass it).
// 
//  Field map mirrors docs/hcp-migration-plan.md.
// 
//  On success: writes audit row to event_log with action="hcp_migration_imported".
//  Does NOT emit APPOINTMENT_SCHEDULED (those customers got confirmations from
//  HCP already — we don't want to double-text on migration day).
query import_hcp_job verb=POST {
  api_group = "intake"

  input {
    text hcp_job_id
    text? hcp_job_number?
    text? work_status?
  
    // Customer block (from HCP customer object).
    text? customer_first_name?
  
    text? customer_last_name?
    text? customer_phone?
    text? customer_email?
  
    // Service address (from HCP service_address).
    text? service_address?
  
    text? service_city?
    text? service_state?
    text? service_zip?
  
    // Schedule (already converted to unix ms by the caller).
    int? scheduled_start_ms?
  
    int? scheduled_end_ms?
  
    // Assignment (caller has already mapped HCP pro id → our tech id).
    int? technician_id?
  
    text? hcp_assigned_to?
  
    // Job details.
    text? description?
  
    text? notes?
  
    // Optional warranty bucketing (caller may sniff HCP tags for AHS/SquareTrade/etc.).
    text? customer_type?
  
    text? warranty_company?
  }

  stack {
    var $hcp_id_clean {
      value = (($input.hcp_job_id ?? "")|trim)
    }
  
    precondition ($hcp_id_clean != "") {
      error_type = "inputerror"
      error = "hcp_job_id is required"
    }
  
    // 1. Idempotency: existing job by HCP id.
    db.query jobs {
      where = $db.jobs.housecall_pro_job_id == $hcp_id_clean
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows
  
    var $existing_job {
      value = (($existing_rows.items|first) ?? null)
    }
  
    // 2. Resolve customer (match by phone, else create).
    var $phone_clean {
      value = (($input.customer_phone ?? "")|trim)
    }
  
    var $first_clean {
      value = (($input.customer_first_name ?? "")|trim)
    }
  
    var $last_clean {
      value = (($input.customer_last_name ?? "")|trim)
    }
  
    var $email_clean {
      value = (($input.customer_email ?? "")|trim)
    }
  
    var $cust_id_final {
      value = 0
    }
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($existing_job != null && $existing_job.customer_id != null && $existing_job.customer_id > 0) {
        var.update $cust_id_final {
          value = $existing_job.customer_id
        }
      }
    }
  
    conditional {
      if ($cust_id_final == 0 && $phone_clean != "") {
        db.query customer {
          where = $db.customer.phone == $phone_clean
          sort = {customer.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $cust_rows
      
        var $cust_match {
          value = (($cust_rows.items|first) ?? null)
        }
      
        conditional {
          if ($cust_match != null) {
            var.update $cust_id_final {
              value = $cust_match.id
            }
          
            var.update $customer {
              value = $cust_match
            }
          }
        }
      }
    }
  
    conditional {
      if ($cust_id_final == 0) {
        conditional {
          if ($first_clean != "" || $phone_clean != "") {
            db.add customer {
              data = {
                first_name: $first_clean
                last_name : $last_clean
                phone     : $phone_clean
                email     : $email_clean
                address   : (($input.service_address ?? "")|trim)
                city      : (($input.service_city ?? "")|trim)
                state     : (($input.service_state ?? "")|trim)
                zip       : (($input.service_zip ?? "")|trim)
              }
            } as $new_cust
          
            var.update $customer {
              value = $new_cust
            }
          
            var.update $cust_id_final {
              value = $new_cust.id
            }
          }
        }
      }
    }
  
    // 3. Map HCP work_status → our scheduling_status enum.
    var $ws_lower {
      value = (($input.work_status ?? "")|to_lower|trim)
    }
  
    var $sched_status_mapped {
      value = "not_ready"
    }
  
    conditional {
      if ($ws_lower == "scheduled" || $ws_lower == "in progress" || $ws_lower == "in_progress" || $ws_lower == "schedule appointment" || $ws_lower == "schedule_appointment") {
        var.update $sched_status_mapped {
          value = "scheduled"
        }
      }
    
      elseif ($ws_lower == "completed" || $ws_lower == "complete" || $ws_lower == "complete unrated" || $ws_lower == "complete_unrated" || $ws_lower == "complete rated" || $ws_lower == "complete_rated") {
        var.update $sched_status_mapped {
          value = "completed"
        }
      }
    
      elseif ($ws_lower == "canceled" || $ws_lower == "cancelled" || $ws_lower == "pro canceled" || $ws_lower == "pro_canceled" || $ws_lower == "pro cancelled" || $ws_lower == "pro_cancelled") {
        var.update $sched_status_mapped {
          value = "canceled"
        }
      }
    }
  
    var $cust_type_final {
      value = (($input.customer_type ?? "self_pay")|trim)
    }
  
    var $warranty_co_final {
      value = (($input.warranty_company ?? "")|trim)
    }
  
    var $action_taken {
      value = "skipped"
    }
  
    var $resulting_job_id {
      value = 0
    }
  
    // 4. Insert or update.
    conditional {
      if ($existing_job == null) {
        db.add jobs {
          data = {
            housecall_pro_job_id: $hcp_id_clean
            job_number          : (($input.hcp_job_number ?? "")|trim)
            customer_id         : $cust_id_final
            first_name          : $first_clean
            last_name           : $last_clean
            phone               : $phone_clean
            service_address     : (($input.service_address ?? "")|trim)
            service_city        : (($input.service_city ?? "")|trim)
            service_state       : (($input.service_state ?? "")|trim)
            service_zip         : (($input.service_zip ?? "")|trim)
            zip                 : (($input.service_zip ?? "")|trim)
            problem_summary     : (($input.description ?? "")|trim)
            notes_internal      : (($input.notes ?? "")|trim)
            scheduled_start     : ($input.scheduled_start_ms ?? null)
            scheduled_end       : ($input.scheduled_end_ms ?? null)
            technician_id       : ($input.technician_id ?? null)
            hcp_assigned_to     : (($input.hcp_assigned_to ?? "")|trim)
            current_status      : (($input.work_status ?? "")|trim)
            scheduling_status   : $sched_status_mapped
            customer_type       : $cust_type_final
            warranty_company    : $warranty_co_final
            source_type         : "hcp_migration_import"
            intake_source       : "hcp_migration_import"
            recommended_service : "appliance_repair"
          }
        } as $new_job
      
        var.update $resulting_job_id {
          value = $new_job.id
        }
      
        var.update $action_taken {
          value = "created"
        }
      }
    
      else {
        db.edit jobs {
          field_name = "id"
          field_value = $existing_job.id
          data = {
            scheduling_status: $sched_status_mapped
            current_status   : (($input.work_status ?? $existing_job.current_status ?? "")|trim)
            scheduled_start  : ($input.scheduled_start_ms ?? $existing_job.scheduled_start)
            scheduled_end    : ($input.scheduled_end_ms ?? $existing_job.scheduled_end)
            technician_id    : ($input.technician_id ?? $existing_job.technician_id)
            hcp_assigned_to  : (($input.hcp_assigned_to ?? $existing_job.hcp_assigned_to ?? "")|trim)
          }
        } as $updated_job
      
        var.update $resulting_job_id {
          value = $existing_job.id
        }
      
        var.update $action_taken {
          value = "updated"
        }
      }
    }
  
    // 5. Audit row.
    db.add event_log {
      data = {
        action  : "hcp_migration_imported"
        metadata: {
        hcp_job_id        : $hcp_id_clean
        hcp_job_number    : $input.hcp_job_number ?? ""
        job_id            : $resulting_job_id
        customer_id       : $cust_id_final
        action_taken      : $action_taken
        work_status       : (($input.work_status ?? "")|trim)
        scheduled_start_ms: ($input.scheduled_start_ms ?? null)
        technician_id     : ($input.technician_id ?? null)
      }
      }
    } as $log
  }

  response = {
    success     : true
    action_taken: $action_taken
    job_id      : $resulting_job_id
    customer_id : $cust_id_final
    hcp_job_id  : $input.hcp_job_id
  }

  guid = "import-hcp-job-v1"
}
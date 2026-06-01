//  Office-Ant booking flow. Called from office-calendar.html when Teddy /
//  Danielle / Alyse click an empty cell or the "+ New Job" button.
// 
//  Creates a customer (or matches existing by phone) + creates a jobs row
//  with scheduled_start + technician_id set, then emits APPOINTMENT_SCHEDULED
//  so the customer auto-confirmation SMS fires through the existing colony
//  loop chain. NEVER touches HCP — Ant Office is now the writer.
// 
//  Distinct from create_job_from_chat because office bookings carry
//  scheduled_start + technician_id from the start; chat-side bookings get
//  scheduled later via the scheduling_queue flow.
query book_appointment_from_office verb=POST {
  api_group = "intake"

  input {
    // Either supply customer_id to reuse, OR first_name + last_name + phone
    // to create/match. Office UI does both: autocomplete sets customer_id;
    // "new customer" mode passes the name+phone+zip block.
    int? customer_id?
  
    text? first_name?
    text? last_name?
    text? phone?
    text? zip?
    text? email?
    text? service_address?
    text? service_city?
    text? service_state?
    text appliance_type
    text? brand?
    text? model_number?
    text problem_summary
    int technician_id
    int scheduled_start_ms
    int? scheduled_end_ms?
  
    // Time-window label for office display: "8-11am", "11am-2pm", "2-5pm"
    text? service_eta_window?
  
    text? customer_type?
    text? warranty_company?
    int? booked_by_user_id?
  }

  stack {
    precondition ($input.appliance_type != "" && $input.problem_summary != "" && $input.technician_id > 0 && $input.scheduled_start_ms > 0) {
      error_type = "inputerror"
      error = "appliance_type, problem_summary, technician_id, scheduled_start_ms are required"
    }
  
    var $cust_id_final {
      value = ($input.customer_id ?? 0)
    }
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($cust_id_final > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id_final
        } as $customer
      }
    }
  
    var $phone_clean {
      value = (($input.phone ?? "")|trim)
    }
  
    var $first_clean {
      value = (($input.first_name ?? "")|trim)
    }
  
    var $last_clean {
      value = (($input.last_name ?? "")|trim)
    }
  
    // Match-by-phone path when customer_id wasn't supplied.
    conditional {
      if ($customer == null && $phone_clean != "") {
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
            var.update $customer {
              value = $cust_match
            }
          
            var.update $cust_id_final {
              value = $cust_match.id
            }
          }
        }
      }
    }
  
    // Still no customer → create one. Requires at minimum first_name + phone.
    conditional {
      if ($customer == null) {
        precondition ($first_clean != "" && $phone_clean != "") {
          error_type = "inputerror"
          error = "first_name + phone required to create a new customer"
        }
      
        db.add customer {
          data = {
            first_name: $first_clean
            last_name : $last_clean
            phone     : $phone_clean
            email     : (($input.email ?? "")|trim)
            zip       : (($input.zip ?? "")|trim)
            address   : (($input.service_address ?? "")|trim)
            city      : (($input.service_city ?? "")|trim)
            state     : (($input.service_state ?? "")|trim)
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
  
    var $cust_type_final {
      value = (($input.customer_type ?? "self_pay")|trim)
    }
  
    var $warranty_co_final {
      value = (($input.warranty_company ?? "")|trim)
    }
  
    var $eta_window_final {
      value = (($input.service_eta_window ?? "")|trim)
    }
  
    db.add jobs {
      data = {
        customer_id        : $cust_id_final
        first_name         : $first_clean
        last_name          : $last_clean
        phone              : $phone_clean
        zip                : (($input.zip ?? "")|trim)
        appliance_type     : (($input.appliance_type ?? "")|trim)
        brand              : (($input.brand ?? "")|trim)
        model_number       : (($input.model_number ?? "")|trim)
        problem_summary    : (($input.problem_summary ?? "")|trim)
        service_address    : (($input.service_address ?? "")|trim)
        service_city       : (($input.service_city ?? "")|trim)
        service_state      : (($input.service_state ?? "")|trim)
        service_zip        : (($input.zip ?? "")|trim)
        technician_id      : $input.technician_id
        scheduled_start    : $input.scheduled_start_ms
        scheduled_end      : ($input.scheduled_end_ms ?? null)
        service_eta_window : $eta_window_final
        scheduling_status  : "scheduled"
        current_status     : "scheduled"
        customer_type      : $cust_type_final
        warranty_company   : $warranty_co_final
        source_type        : "office_ant"
        intake_source      : "office_ant"
        recommended_service: "appliance_repair"
      }
    } as $new_job
  
    db.add event_log {
      data = {
        action  : "office_ant_job_created"
        metadata: {
        job_id           : $new_job.id
        customer_id      : $cust_id_final
        technician_id    : $input.technician_id
        scheduled_start  : $input.scheduled_start_ms
        booked_by_user_id: ($input.booked_by_user_id ?? null)
      }
      }
    } as $log
  
    var $as_payload_obj {
      value = {
        job_id            : $new_job.id
        scheduled_start_ms: $input.scheduled_start_ms
        scheduled_end_ms  : ($input.scheduled_end_ms ?? null)
        technician_id     : $input.technician_id
        customer_id       : $cust_id_final
        customer_phone    : $phone_clean
        source            : "office_ant"
      }
    }
  
    var $as_payload_str {
      value = $as_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "APPOINTMENT_SCHEDULED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $as_payload_str
      }
    } as $as_signal
  
    db.add event_log {
      data = {
        action  : "appointment_scheduled_signal_emitted"
        metadata: {
        job_id            : $new_job.id
        signal_id         : $as_signal.id
        scheduled_start_ms: $input.scheduled_start_ms
        source            : "office_ant"
      }
      }
    } as $as_log
  }

  response = {
    success              : true
    job_id               : $new_job.id
    customer_id          : $cust_id_final
    scheduled_start_ms   : $input.scheduled_start_ms
    appointment_signal_id: $as_signal.id
  }

  guid = "book-appointment-from-office-v1"
}
// Tech tap "Start Job" button - stamps job_started_at.
// Called from tech-ant-live.html action bar.
query tech_job_started verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job not found"}
        }
      }
    }
  
    conditional {
      if ($job.technician_id != $input.technician_id) {
        return {
          value = {success: false, error: "tech does not own this job"}
        }
      }
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        job_started_at   : now
        scheduling_status: "in_progress"
        current_status   : "in_progress"
      }
    } as $job_updated

    db.add event_log {
      data = {
        action  : "tech_job_started"
        metadata: {
        job_id       : $input.job_id
        technician_id: $input.technician_id
      }
      }
    } as $log

    // Phase 5.5B: emit JOB_STARTED colony signal (no agent listens today;
    // dispatcher returns no_agent_yet cleanly, hook in place for future).
    var $js_started_at_ms {
      value = (now|to_ms)
    }

    var $js_payload_obj {
      value = {
        job_id       : $input.job_id
        technician_id: $input.technician_id
        source       : "tech_button_start"
        started_at_ms: $js_started_at_ms
      }
    }

    var $js_payload_str {
      value = $js_payload_obj|json_encode
    }

    db.add colony_signals {
      data = {
        signal_type    : "JOB_STARTED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $js_payload_str
      }
    } as $js_signal

    // SMS Teddy with the update. Composed from customer + tech name.
    var $cust_id_val {
      value = ($job.customer_id ?? 0)
    }

    var $cust_name {
      value = "customer"
    }

    conditional {
      if ($cust_id_val > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id_val
        } as $cust

        var $cust_first {
          value = ($cust.first_name ?? "")|trim
        }

        var $cust_last {
          value = ($cust.last_name ?? "")|trim
        }

        var $cust_joined {
          value = ($cust_first ~ " " ~ $cust_last)|trim
        }

        conditional {
          if ($cust_joined != "") {
            var.update $cust_name {
              value = $cust_joined
            }
          }
        }
      }
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech

    var $tech_first {
      value = ($tech.first_name ?? "tech")|trim
    }

    var $appliance_str {
      value = ($job.appliance_type ?? "")|trim
    }

    var $sms_body {
      value = "[ant] " ~ $tech_first ~ " started job #" ~ ($input.job_id|to_text) ~ " - " ~ $cust_name ~ ", " ~ $appliance_str
    }

    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to     : ($env.OWNER_PHONE_NUMBER ?? "")
        message: $sms_body
      }
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $teddy_sms_resp

    // Customer arrival SMS - "tech has arrived at your door".
    // Gated on $cust_id_val > 0 because $cust is only declared inside the
    // matching customer-load conditional above.
    conditional {
      if ($cust_id_val > 0) {
        var $cust_pref_raw {
          value = (($cust.preferred_name ?? "")|trim)
        }

        var $cust_first_clean {
          value = (($cust.first_name ?? "")|trim)
        }

        var $cust_display_name {
          value = ($cust_pref_raw != "") ? $cust_pref_raw : (($cust_first_clean != "") ? $cust_first_clean : "there")
        }

        var $tech_first_clean {
          value = (($tech.first_name ?? "")|trim)
        }

        var $tech_first_disp {
          value = ($tech_first_clean != "") ? ($tech_first_clean|to_lower) : "your tech"
        }

        var $appliance_clean {
          value = (($job.appliance_type ?? "")|trim)
        }

        var $appliance_disp_arr {
          value = ($appliance_clean != "") ? $appliance_clean : "appliance"
        }

        var $cust_phone_raw {
          value = (($cust.phone ?? "")|trim)
        }

        var $cust_phone_e164 {
          value = ($cust_phone_raw != "" && (($cust_phone_raw|starts_with:"+") == false)) ? ("+1" ~ $cust_phone_raw) : $cust_phone_raw
        }

        var $arrival_sms_body {
          value = "Hi " ~ $cust_display_name ~ " - " ~ $tech_first_disp ~ " has arrived and is ready to look at your " ~ $appliance_disp_arr ~ "!"
        }

        conditional {
          if ($cust_phone_e164 != "") {
            api.request {
              url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method  = "POST"
              params  = {to: $cust_phone_e164, message: $arrival_sms_body}
              headers = ["Content-Type: application/json"]
              timeout = 30
            } as $cust_arrival_sms_resp

            db.add event_log {
              data = {
                action  : "tech_arrival_customer_sms"
                metadata: {
                  job_id       : $input.job_id
                  technician_id: $input.technician_id
                  recipient    : $cust_phone_e164
                }
              }
            } as $arr_log
          }
        }
      }
    }
  }

  response = {success: true}
  guid = "F6uuTqoOb83MLbbowA_B4Zih7KA"
}
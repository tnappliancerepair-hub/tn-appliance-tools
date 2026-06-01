//  Tech tap "On My Way" button - notifies customer en-route via SMS with
//  a computed ETA, stamps tech_en_route_at + eta_ms on the job, and emits
//  a TECH_ON_WAY colony_signal. Idempotent: refuses if already sent.
//  Called from tech-ant-live.html action bar.
// 
//  ETA inputs are all optional for back-compat with older clients:
//    - eta_minutes: drive-time minutes (incl. tool_pack buffer)
//    - eta_timestamp_ms: absolute unix-ms moment of expected arrival
//    - eta_time_str: pre-formatted "2:47pm CT" for the customer SMS
//  If none supplied, the SMS falls back to the original short form.
query tech_on_the_way verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    int? eta_minutes?
    int? eta_timestamp_ms?
    text? eta_time_str?
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
  
    conditional {
      if ($job.tech_en_route_at != null) {
        return {
          value = {success: false, error: "already sent"}
        }
      }
    }
  
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech
  
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
  
    var $eta_ms_clean {
      value = ($input.eta_timestamp_ms ?? null)
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {tech_en_route_at: now, eta_ms: $eta_ms_clean}
    } as $job_updated
  
    var $cust_pref_raw {
      value = (($customer.preferred_name ?? "")|trim)
    }
  
    var $cust_first_raw {
      value = (($customer.first_name ?? "")|trim)
    }
  
    var $cust_display_name {
      value = ($cust_pref_raw != "") ? $cust_pref_raw : (($cust_first_raw != "") ? $cust_first_raw : "there")
    }
  
    var $tech_first_raw {
      value = (($tech.first_name ?? "")|trim)
    }
  
    var $tech_first_lower {
      value = ($tech_first_raw != "") ? ($tech_first_raw|to_lower) : "your tech"
    }
  
    var $appliance_word {
      value = (($job.appliance_type ?? "")|trim)
    }
  
    var $appliance_disp {
      value = ($appliance_word != "") ? $appliance_word : "appliance"
    }
  
    var $cust_phone_raw {
      value = (($customer.phone ?? "")|trim)
    }
  
    var $cust_phone_e164 {
      value = ($cust_phone_raw != "" && (($cust_phone_raw|starts_with:"+") == false)) ? ("+1" ~ $cust_phone_raw) : $cust_phone_raw
    }
  
    var $eta_str_clean {
      value = (($input.eta_time_str ?? "")|trim)
    }
  
    var $sms_body_with_eta {
      value = "Hi " ~ $cust_display_name ~ " - " ~ $tech_first_lower ~ " is on the way to your " ~ $appliance_disp ~ " repair. Expected arrival: " ~ $eta_str_clean ~ ". Reply STOP to cancel."
    }
  
    var $sms_body_plain {
      value = "hi " ~ $cust_display_name ~ " - " ~ $tech_first_lower ~ " is on the way to your " ~ $appliance_disp ~ " appointment. see you soon!"
    }
  
    var $sms_body {
      value = ($eta_str_clean != "") ? $sms_body_with_eta : $sms_body_plain
    }
  
    conditional {
      if ($cust_phone_e164 != "") {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $cust_phone_e164, message: $sms_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sms_resp
      }
    }
  
    db.add event_log {
      data = {
        action  : "tech_on_the_way"
        metadata: {
        job_id          : $input.job_id
        technician_id   : $input.technician_id
        customer_id     : ($customer.id ?? null)
        recipient       : $cust_phone_e164
        phone_present   : ($cust_phone_e164 != "")
        eta_minutes     : ($input.eta_minutes ?? null)
        eta_timestamp_ms: $eta_ms_clean
        eta_time_str    : $eta_str_clean
      }
      }
    } as $log
  
    var $tow_payload_obj {
      value = {
        job_id          : $input.job_id
        technician_id   : $input.technician_id
        customer_id     : ($customer.id ?? null)
        customer_phone  : $cust_phone_e164
        eta_minutes     : ($input.eta_minutes ?? null)
        eta_timestamp_ms: $eta_ms_clean
        eta_time_str    : $eta_str_clean
        source          : "tech_button_on_my_way"
      }
    }
  
    var $tow_payload_str {
      value = $tow_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "TECH_ON_WAY"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $tow_payload_str
      }
    } as $tow_signal
  }

  response = {
    success         : true
    eta_minutes     : ($input.eta_minutes ?? null)
    eta_timestamp_ms: $eta_ms_clean
    sms_sent        : ($cust_phone_e164 != "")
  }

  guid = "P-6iC7I4EzQIqYzMNgpv7oBBzlI"
}
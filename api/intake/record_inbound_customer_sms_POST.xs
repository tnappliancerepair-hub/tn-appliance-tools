//  Customer-direction inbound SMS receiver. Called by
//  netlify/functions/customer-sms-inbound.js (Telnyx webhook proxy).
// 
//  Flow:
//    1. Normalize the inbound phone to +1XXXXXXXXXX.
//    2. Look up the customer by phone (E.164 OR raw).
//    3. Find their active job (most recent non-canceled non-completed).
//    4. Audit-log the inbound message to event_log.
//    5. Emit INBOUND_CUSTOMER_SMS signal with phone + body + customer_id +
//       job_id. The colony-loop agent (inbound_customer_sms.js) picks it up
//       and routes to the right sms_response_* responder.
// 
//  Returns success/failure synchronously so the Netlify function can ack the
//  Telnyx webhook with 200 even when the customer is unknown.
query record_inbound_customer_sms verb=POST {
  api_group = "intake"

  input {
    text phone filters=trim
    text body filters=trim
    text? sid?
    text? to?
  }

  stack {
    precondition (($input.phone|strlen) > 0 && ($input.body|strlen) > 0) {
      error_type = "inputerror"
      error = "phone and body are required"
    }
  
    // 1. Normalize phone to E.164.
    var $digits {
      value = "/[^0-9]/"|regex_replace:"":$input.phone
    }
  
    var $clean_phone {
      value = ""
    }
  
    conditional {
      if (($digits|strlen) == 10) {
        var.update $clean_phone {
          value = "+1" ~ $digits
        }
      }
    
      elseif ((($digits|strlen) == 11) && ($digits|starts_with:"1")) {
        var.update $clean_phone {
          value = "+" ~ $digits
        }
      }
    
      else {
        var.update $clean_phone {
          value = "+" ~ $digits
        }
      }
    }
  
    // 2. Look up customer.
    db.query customer {
      where = $db.customer.phone == $clean_phone || $db.customer.phone == $input.phone
      return = {type: "single"}
    } as $customer
  
    var $customer_id_val {
      value = ($customer != null) ? $customer.id : 0
    }
  
    // 3. Find most-recent active job for this customer.
    var $job_id_val {
      value = 0
    }
  
    var $job_appliance {
      value = ""
    }
  
    var $job_status {
      value = ""
    }
  
    conditional {
      if ($customer != null) {
        db.query jobs {
          where = $db.jobs.customer_id == $customer.id
          sort = {jobs.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 5}}
        } as $jobs_rows
      
        foreach ($jobs_rows.items) {
          each as $jcand {
            conditional {
              if ($job_id_val == 0) {
                var $ss {
                  value = ($jcand.scheduling_status ?? "")
                }
              
                conditional {
                  if ($ss != "completed" && $ss != "canceled" && $ss != "no_fix_possible") {
                    var.update $job_id_val {
                      value = $jcand.id
                    }
                  
                    var.update $job_appliance {
                      value = ($jcand.appliance_type ?? "")
                    }
                  
                    var.update $job_status {
                      value = $ss
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    // 4. Audit row.
    db.add event_log {
      data = {
        action  : "inbound_customer_sms_received"
        metadata: {
        phone       : $clean_phone
        customer_id : $customer_id_val
        job_id      : $job_id_val
        body_preview: $input.body|substr:0:200
        provider_sid: ($input.sid ?? "")
        to          : ($input.to ?? "")
      }
      }
    } as $audit
  
    // 5. Emit signal for the inbound_customer_sms agent.
    var $ics_payload_obj {
      value = ```
        {
          phone          : $clean_phone
          customer_id    : $customer_id_val
          customer_phone : $clean_phone
          customer_name  : ($customer != null) ? (($customer.first_name ?? "") ~ " " ~ ($customer.last_name ?? "")) : ""
          first_name     : ($customer != null) ? ($customer.first_name ?? "") : ""
          job_id         : $job_id_val
          appliance_type : $job_appliance
          scheduling_status: $job_status
          body           : $input.body
          message        : $input.body
          provider_sid   : ($input.sid ?? "")
          to             : ($input.to ?? "")
        }
        ```
    }
  
    var $ics_payload_str {
      value = $ics_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "INBOUND_CUSTOMER_SMS"
        signal_strength: 70
        source_colony  : ""
        target_colonies: ""
        payload        : $ics_payload_str
      }
    } as $ics_signal
  
    db.add event_log {
      data = {
        action  : "inbound_customer_sms_signal_emitted"
        metadata: {
        signal_id     : $ics_signal.id
        customer_id   : $customer_id_val
        job_id        : $job_id_val
        customer_known: ($customer != null)
      }
      }
    } as $log
  }

  response = {
    success       : true
    signal_id     : $ics_signal.id
    customer_id   : $customer_id_val
    job_id        : $job_id_val
    customer_known: ($customer != null)
  }

  guid = "record-inbound-customer-sms-v1"
}
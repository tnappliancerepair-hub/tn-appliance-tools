// Sends a waiver SMS to the customer for a specific job.
query send_waiver_sms verb=POST {
  api_group = "intake"

  input {
    // The ID of the job
    int job_id
  
    // Optional phone number to override the customer's phone
    text phone?
  }

  stack {
    // Retrieve the job record
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error = "Job not found"
    }
  
    // Retrieve the customer record
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    precondition ($customer != null) {
      error = "Customer not found"
    }
  
    // Determine the target phone number
    var $target_phone {
      value = ($input.phone != null && ($input.phone|strlen) > 0) ? $input.phone : $customer.phone
    }
  
    precondition (($target_phone|is_empty) == false) {
      error_type = "inputerror"
      error = "Target phone number is missing"
    }
  
    // Construct the Jotform waiver URL
    var $prefilled_url {
      value = "https://form.jotform.com/260495320372050?job_id=" ~ $job.id ~ "&name=" ~ ($customer.first_name|url_encode) ~ "&phone=" ~ ($target_phone|url_encode)
    }
  
    // Construct the SMS message text
    var $sms_body {
      value = "Hi " ~ $customer.first_name ~ ", please sign your service waiver here: " ~ $prefilled_url
    }
  
    // Check if Twilio environment variables are configured
    var $twilio_configured {
      value = ($env.TWILIO_ACCOUNT_SID|is_empty|not) && ($env.TWILIO_AUTH_TOKEN|is_empty|not) && ($env.TWILIO_FROM_NUMBER|is_empty|not)
    }
  
    // Send the SMS via Twilio if configured
    conditional {
      if ($twilio_configured) {
        // ── SMS_ENABLED gate (call_site: send_waiver_sms_POST.xs:63) ──
        var $gate63_recipient_e164 {
          value = ($target_phone ?? "")|trim
        }
      
        var $gate63_recipient_bare {
          value = $gate63_recipient_e164|replace:"+1":""
        }
      
        var $gate63_is_owner {
          value = ($gate63_recipient_e164 == "+16154855795") || ($gate63_recipient_bare == "6154855795")
        }
      
        var $gate63_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate63_should_send {
          value = $gate63_sms_enabled || $gate63_is_owner
        }
      
        conditional {
          if ($gate63_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate63_recipient_e164
                body_preview: $sms_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "send_waiver_sms_POST.xs:63"
                job_id      : $job.id
              }
              }
            } as $gate63_log
          }
        
          else {
            conditional {
              if ($gate63_is_owner && $gate63_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate63_recipient_e164
                    body_preview: $sms_body|substr:0:200
                    call_site   : "send_waiver_sms_POST.xs:63"
                    job_id      : $job.id
                  }
                  }
                } as $bypass63_log
              }
            }
          
            api.request {
              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
              method = "POST"
              params = {}
                |set:"To":$target_phone
                |set:"From":$env.TWILIO_FROM_NUMBER
                |set:"Body":$sms_body
              headers = []
                |push:("Authorization: Basic %s"
                  |sprintf:($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN|base64_encode)
                )
                |push:"Content-Type: application/x-www-form-urlencoded"
            } as $twilio_response
          }
        }
      }
    }
  
    // Update the job with the waiver sent timestamp
    db.edit jobs {
      field_name = "id"
      field_value = $job.id
      data = {waiver_sent_at: "now"}
    } as $updated_job
  
    // Log the waiver sent event
    db.add event_log {
      data = {
        action  : "waiver_sent"
        metadata: {
        job_id      : $job.id
        customer_id : $customer.id
        target_phone: $target_phone
      }
      }
    } as $event_log
  
    // Prepare the response
    var $response_data {
      value = null
    }
  
    conditional {
      if ($twilio_configured) {
        var.update $response_data {
          value = {
            success: true
            job_id : $job.id
            phone  : $target_phone
            message: "Waiver SMS sent successfully"
          }
        }
      }
    
      else {
        var.update $response_data {
          value = {
            success    : true
            sms_skipped: true
            reason     : "Twilio environment variables not configured"
            job_id     : $job.id
          }
        }
      }
    }
  }

  response = $response_data
  guid = "7te_wNorkd6bqvq92icmc3Y1P3M"
}
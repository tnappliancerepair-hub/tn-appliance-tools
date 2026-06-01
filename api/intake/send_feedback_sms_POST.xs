// Sends the initial feedback request SMS to a customer.
query send_feedback_sms verb=POST {
  api_group = "intake"

  input {
    int job_id {
      table = "jobs"
    }
  
    text customer_phone filters=trim
    text customer_first_name filters=trim
  }

  stack {
    // 1. Check jobs table — if feedback_sent = true, stop
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error = "Job not found"
    }
  
    conditional {
      if ($job.feedback_sent) {
        return {
          value = {success: true, message: "Feedback already sent"}
        }
      }
    }
  
    // 2. Build SMS body
    var $sms_body {
      value = "Hey " ~ $input.customer_first_name ~ "! It's TN Appliance Exchange — your repair is complete. How did we do?\n\nReply 5 = Great experience 👍\nReply 0 = Had an issue 👎\nJust reply with a number and we'll take it from there."
    }
  
    // 3. Call Twilio send_sms
    // ── SMS_ENABLED gate (call_site: send_feedback_sms_POST.xs:40) ──
    var $gate40_recipient_e164 {
      value = ($input.customer_phone ?? "")|trim
    }
  
    var $gate40_recipient_bare {
      value = $gate40_recipient_e164|replace:"+1":""
    }
  
    var $gate40_is_owner {
      value = ($gate40_recipient_e164 == "+16154855795") || ($gate40_recipient_bare == "6154855795")
    }
  
    var $gate40_sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    var $gate40_should_send {
      value = $gate40_sms_enabled || $gate40_is_owner
    }
  
    conditional {
      if ($gate40_should_send == false) {
        db.add event_log {
          data = {
            action  : "sms_gated"
            metadata: {
            recipient   : $gate40_recipient_e164
            body_preview: $sms_body|substr:0:200
            gated_reason: "SMS_ENABLED=false, non-owner recipient"
            call_site   : "send_feedback_sms_POST.xs:40"
            job_id      : $input.job_id
          }
          }
        } as $gate40_log
      }
    
      else {
        conditional {
          if ($gate40_is_owner && $gate40_sms_enabled == false) {
            db.add event_log {
              data = {
                action  : "sms_owner_bypass"
                metadata: {
                recipient   : $gate40_recipient_e164
                body_preview: $sms_body|substr:0:200
                call_site   : "send_feedback_sms_POST.xs:40"
                job_id      : $input.job_id
              }
              }
            } as $bypass40_log
          }
        }
      
        api.request {
          url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
          method = "POST"
          params = {
            From: "+16292840444"
            To  : $input.customer_phone
            Body: $sms_body
          }
        
          headers = [
            "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
            "Content-Type: application/x-www-form-urlencoded"
          ]
        } as $twilio_response
      
        // 4. Update jobs table: set feedback_sent = true, feedback_sent_at = now()
        db.patch jobs {
          field_name = "id"
          field_value = $input.job_id
          data = {feedback_sent: true, feedback_sent_at: now}
        }
      
        // 5. Log the attempt
        db.add event_log {
          data = {
            action  : "feedback_sms_sent"
            metadata: {
            job_id         : $input.job_id
            customer_phone : $input.customer_phone
            twilio_response: $twilio_response.response.result
          }
          }
        }
      }
    }
  }

  response = {success: true}
  guid = "N2Y0ZrsufypgQ-n8QfwGe1gFub0"
}
// Handles the followup complaint message from a customer after negative feedback.
query handle_negative_followup verb=POST {
  api_group = "intake"

  input {
    text From
    text Body
  }

  stack {
    // 1. Look up most recent job by phone where feedback_type = negative
    db.query jobs {
      join = {
        customer: {
          table: "customer"
          where: $db.jobs.customer_id == $db.customer.id
        }
      }
    
      where = $db.customer.phone == $input.From && $db.jobs.feedback_type == "negative"
      sort = {created_at: "desc"}
      return = {type: "single"}
    } as $job
  
    conditional {
      if ($job == null) {
        db.add event_log {
          data = {
            action  : "negative_followup_no_job"
            metadata: {from: $input.From, body: $input.Body}
          }
        }
      
        return {
          value = {success: true}
        }
      }
    }
  
    // 2. Update jobs table: feedback_note = Body
    db.patch jobs {
      field_name = "id"
      field_value = $job.id
      data = {feedback_note: $input.Body}
    }
  
    // 3. Forward to owner
    // Get customer name and tech name
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    var $tech_name {
      value = "Unknown"
    }
  
    conditional {
      if ($job.technician_id != null) {
        db.get technicians {
          field_name = "id"
          field_value = $job.technician_id
        } as $tech
      
        var.update $tech_name {
          value = ($tech.first_name ?? "") ~ " " ~ ($tech.last_name ?? "")
        }
      }
    }
  
    var $owner_msg {
      value = "⚠️ CUSTOMER COMPLAINT DETAIL\nJob: " ~ ($job.id|to_text) ~ "\nCustomer: " ~ ($customer.first_name ?? "") ~ " " ~ ($customer.last_name ?? "") ~ "\nTech: " ~ $tech_name ~ "\nTheir message: " ~ $input.Body
    }
  
    // ── SMS_ENABLED gate (call_site: handle_negative_followup_POST.xs:76) ──
    // Recipient is hardcoded owner; gate still wraps for consistency + audit trail.
    var $gate76_recipient_e164 {
      value = "+16154855795"
    }
  
    var $gate76_is_owner {
      value = true
    }
  
    var $gate76_sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    var $gate76_should_send {
      value = $gate76_sms_enabled || $gate76_is_owner
    }
  
    conditional {
      if ($gate76_should_send == false) {
        db.add event_log {
          data = {
            action  : "sms_gated"
            metadata: {
            recipient   : $gate76_recipient_e164
            body_preview: $owner_msg|substr:0:200
            gated_reason: "SMS_ENABLED=false, non-owner recipient"
            call_site   : "handle_negative_followup_POST.xs:76"
          }
          }
        } as $gate76_log
      }
    
      else {
        conditional {
          if ($gate76_is_owner && $gate76_sms_enabled == false) {
            db.add event_log {
              data = {
                action  : "sms_owner_bypass"
                metadata: {
                recipient   : $gate76_recipient_e164
                body_preview: $owner_msg|substr:0:200
                call_site   : "handle_negative_followup_POST.xs:76"
              }
              }
            } as $bypass76_log
          }
        }
      
        api.request {
          url = "https://api.telnyx.com/v2/messages"
          method = "POST"
          params = {
            from: $env.TELNYX_FROM_TECH
            to  : "+16154855795"
            text: $owner_msg
          }
        
          headers = [
            "Authorization: Bearer " ~ $env.TELNYX_API_KEY
            "Content-Type: application/json"
          ]
        }
      }
    }
  
    // 4. Send SMS to customer
    var $cust_thanks_body {
      value = "Thank you for letting us know. The owner has been notified and will personally review this. We appreciate you giving us the chance to make it right."
    }
  
    // ── SMS_ENABLED gate (call_site: handle_negative_followup_POST.xs:92) ──
    var $gate92_recipient_e164 {
      value = ($input.From ?? "")|trim
    }
  
    var $gate92_recipient_bare {
      value = $gate92_recipient_e164|replace:"+1":""
    }
  
    var $gate92_is_owner {
      value = ($gate92_recipient_e164 == "+16154855795") || ($gate92_recipient_bare == "6154855795")
    }
  
    var $gate92_sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    var $gate92_should_send {
      value = $gate92_sms_enabled || $gate92_is_owner
    }
  
    conditional {
      if ($gate92_should_send == false) {
        db.add event_log {
          data = {
            action  : "sms_gated"
            metadata: {
            recipient   : $gate92_recipient_e164
            body_preview: $cust_thanks_body|substr:0:200
            gated_reason: "SMS_ENABLED=false, non-owner recipient"
            call_site   : "handle_negative_followup_POST.xs:92"
          }
          }
        } as $gate92_log
      }
    
      else {
        conditional {
          if ($gate92_is_owner && $gate92_sms_enabled == false) {
            db.add event_log {
              data = {
                action  : "sms_owner_bypass"
                metadata: {
                recipient   : $gate92_recipient_e164
                body_preview: $cust_thanks_body|substr:0:200
                call_site   : "handle_negative_followup_POST.xs:92"
              }
              }
            } as $bypass92_log
          }
        }
      
        api.request {
          url = "https://api.telnyx.com/v2/messages"
          method = "POST"
          params = {
            from: $env.TELNYX_FROM_TECH
            to  : $input.From
            text: $cust_thanks_body
          }
        
          headers = [
            "Authorization: Bearer " ~ $env.TELNYX_API_KEY
            "Content-Type: application/json"
          ]
        }
      }
    }
  
    // 5. Log to event_log
    db.add event_log {
      data = {
        action  : "negative_feedback_detail"
        metadata: {job_id: $job.id, body: $input.Body}
      }
    }
  }

  response = {success: true}
  guid = "vLcHjy_jiJJtREOjKd4IfX9kbE8"
}
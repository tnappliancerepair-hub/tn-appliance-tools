// Webhook: process Jotform waiver signature + send self-schedule SMS
query jotform_waiver_webhook verb=POST {
  api_group = "intake"

  input {
    text rawRequest
  }

  stack {
    var $parsed {
      value = $input.rawRequest|json_decode
    }
  
    conditional {
      if ($parsed == null) {
        db.add event_log {
          data = {
            action  : "waiver_webhook_malformed_rawRequest"
            metadata: {rawRequest: $input.rawRequest}
          }
        } as $malformed_log
      
        return {
          value = {success: false, message: "Malformed rawRequest JSON"}
        }
      }
    }
  
    var $job_id {
      value = $parsed.job_id|to_int
    }
  
    var $submission_id {
      value = $parsed.submission_id
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $job_id
    } as $job
  
    conditional {
      if ($job == null) {
        db.add event_log {
          data = {
            action  : "waiver_webhook_job_not_found"
            metadata: {job_id: $job_id, submission_id: $submission_id}
          }
        } as $error_log
      
        return {
          value = {
            success: false
            message: "Job not found"
            job_id : $job_id
          }
        }
      }
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $job_id
      data = {
        waiver_signed               : true
        waiver_signed_at            : "now"
        waiver_text_version         : "v1.0_2026-04-20"
        waiver_jotform_submission_id: $submission_id
        waiver_channel              : "jotform"
      }
    } as $updated_job
  
    db.get customer {
      field_name = "id"
      field_value = $updated_job.customer_id
    } as $customer
  
    conditional {
      if ($customer != null) {
        db.edit customer {
          field_name = "id"
          field_value = $customer.id
          data = {last_waiver_signed_at: "now"}
        } as $updated_customer
      }
    }
  
    db.add event_log {
      data = {
        action  : "waiver_signed"
        metadata: {
        job_id     : $job_id
        customer_id: $updated_job.customer_id
        channel    : "jotform"
      }
      }
    } as $success_log
  
    // ============================================================
    // SEND BOOKING SMS — self-schedule link
    // ============================================================
  
    var $sms_sent {
      value = false
    }
  
    var $twilio_configured {
      value = ($env.TWILIO_ACCOUNT_SID|is_empty|not) && ($env.TWILIO_AUTH_TOKEN|is_empty|not) && ($env.TWILIO_FROM_NUMBER|is_empty|not)
    }
  
    conditional {
      if ($customer != null && $customer.phone != null && $twilio_configured) {
        var $first_name {
          value = $customer.first_name|first_notempty:"there"
        }
      
        var $customer_zip {
          value = $customer.zip|first_notempty:""
        }
      
        var $url_name {
          value = $first_name|url_encode
        }
      
        var $book_url {
          value = "https://tnapplianceexchange.net/book.html?job_id=" ~ $job_id ~ "&zip=" ~ $customer_zip ~ "&name=" ~ $url_name
        }
      
        var $sms_body {
          value = "Hi " ~ $first_name ~ "! Your TN Appliance Exchange waiver is signed. Pick your appointment time here: " ~ $book_url ~ ". Questions? Call 866-268-0111. Reply STOP to opt out."
        }
      
        // ── SMS_ENABLED gate (call_site: jotform_waiver_webhook_POST.xs:134) ──
        var $gate134_recipient_e164 {
          value = ($customer.phone ?? "")|trim
        }
      
        var $gate134_recipient_bare {
          value = $gate134_recipient_e164|replace:"+1":""
        }
      
        var $gate134_is_owner {
          value = ($gate134_recipient_e164 == "+16154855795") || ($gate134_recipient_bare == "6154855795")
        }
      
        var $gate134_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate134_should_send {
          value = $gate134_sms_enabled || $gate134_is_owner
        }
      
        conditional {
          if ($gate134_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate134_recipient_e164
                body_preview: $sms_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "jotform_waiver_webhook_POST.xs:134"
                job_id      : $job_id
                customer_id : $customer.id
              }
              }
            } as $gate134_log
          }
        
          else {
            conditional {
              if ($gate134_is_owner && $gate134_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate134_recipient_e164
                    body_preview: $sms_body|substr:0:200
                    call_site   : "jotform_waiver_webhook_POST.xs:134"
                    job_id      : $job_id
                    customer_id : $customer.id
                  }
                  }
                } as $bypass134_log
              }
            }
          
            api.request {
              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
              method = "POST"
              params = {}
                |set:"To":$customer.phone
                |set:"From":$env.TWILIO_FROM_NUMBER
                |set:"Body":$sms_body
              headers = []
                |push:("Authorization: Basic %s"
                  |sprintf:($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN|base64_encode)
                )
                |push:"Content-Type: application/x-www-form-urlencoded"
            } as $twilio_response
          
            var.update $sms_sent {
              value = true
            }
          
            db.add event_log {
              data = {
                action  : "booking_sms_sent"
                metadata: {
                job_id     : $job_id
                customer_id: $customer.id
                phone      : $customer.phone
                book_url   : $book_url
              }
              }
            } as $sms_log
          
            db.add job_event {
              data = {
                job_id    : $job_id
                event_type: "booking_sms_sent"
                source    : "waiver_webhook"
                created_by: "system"
                payload   : {phone: $customer.phone, book_url: $book_url}
              }
            } as $job_event_log
          }
        }
      }
    
      else {
        db.add event_log {
          data = {
            action  : "booking_sms_skipped"
            metadata: {
            job_id           : $job_id
            customer_id      : $updated_job.customer_id
            twilio_configured: $twilio_configured
            has_customer     : ($customer != null)
          }
          }
        } as $skip_log
      }
    }
  
    var $response_data {
      value = {
        success         : true
        message         : "Waiver processed successfully"
        job_id          : $job_id
        customer_id     : $updated_job.customer_id
        waiver_signed_at: $updated_job.waiver_signed_at
        booking_sms_sent: $sms_sent
      }
    }
  }

  response = $response_data
  guid = "ILrbqkv4xP-hJqKhoVWvm1cRjQA"
}
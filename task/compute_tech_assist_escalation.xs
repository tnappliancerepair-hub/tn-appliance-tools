// Phase 1c. Tech Ant Assist escalation cron. Every 15 minutes, finds
// tech_assist_session rows where:
//   - status == "awaiting_completion"
//   - last_message_at older than 2 hours
//   - escalated_at is null (not yet escalated)
// For each, SMS OWNER_PHONE_NUMBER (placeholder for DANIELLE_PHONE), set
// escalated_at and escalated_to, log event. Gated on $env.TECH_ASSIST_ENABLED.
// See docs/ant-tech-assist-design-v1.md.
task compute_tech_assist_escalation {
  stack {
    // ── 0. Test-mode gate ──
    conditional {
      if ($env.TECH_ASSIST_ENABLED != "true") {
        debug.log {
          value = "compute_tech_assist_escalation skipped: TECH_ASSIST_ENABLED != 'true'"
        }
      
        return {
          value = null
        }
      }
    }
  
    // ── 1. Find stale awaiting_completion sessions ──
    var $two_hours_ago {
      value = now|transform_timestamp:"-2 hours"
    }
  
    db.query tech_assist_session {
      where = $db.tech_assist_session.status == "awaiting_completion" && $db.tech_assist_session.last_message_at < $two_hours_ago && $db.tech_assist_session.escalated_at == null
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $stale_sessions
  
    // ── 2. Walk each, escalate ──
    foreach ($stale_sessions.items) {
      each as $sess {
        // Defensive null check for tech (footgun #7).
        var $tech_id_for_get {
          value = $sess.technician_id
        }
      
        var $sess_tech {
          value = null
        }
      
        conditional {
          if ($tech_id_for_get != null && $tech_id_for_get > 0) {
            db.get technicians {
              field_name = "id"
              field_value = $tech_id_for_get
            } as $sess_tech
          }
        }
      
        // Compose escalation body.
        var $tech_first_raw {
          value = ($sess_tech.first_name ?? "")|trim
        }
      
        var $tech_first_lower {
          value = ($tech_first_raw != "") ? ($tech_first_raw|to_lower) : "(unknown tech)"
        }
      
        var $job_id_str {
          value = $sess.job_id|to_text
        }
      
        var $missing_json {
          value = ($sess.required_fields_remaining ?? [])|json_encode
        }
      
        var $sms_body {
          value = "tech " ~ $tech_first_lower ~ " completed job " ~ $job_id_str ~ " but TDR is missing: " ~ $missing_json ~ ". tried 3 times, no reply. heads up."
        }
      
        // SMS to OWNER_PHONE_NUMBER (placeholder for DANIELLE_PHONE).
        var $esc_sms_action {
          value = "tech_assist_escalated_to_owner_failed"
        }
      
        var $owner_phone {
          value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
        }
      
        conditional {
          if ($owner_phone != "") {
            // ── SMS_ENABLED gate (call_site: compute_tech_assist_escalation.xs:81) ──
            var $gate81_recipient_e164 {
              value = $owner_phone
            }
          
            var $gate81_recipient_bare {
              value = $gate81_recipient_e164|replace:"+1":""
            }
          
            var $gate81_is_owner {
              value = ($gate81_recipient_e164 == "+16154855795") || ($gate81_recipient_bare == "6154855795")
            }
          
            var $gate81_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate81_should_send {
              value = $gate81_sms_enabled || $gate81_is_owner
            }
          
            conditional {
              if ($gate81_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate81_recipient_e164
                    body_preview: $sms_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "compute_tech_assist_escalation.xs:81"
                    session_id  : $sess.id
                  }
                  }
                } as $gate81_log
              }
            
              else {
                conditional {
                  if ($gate81_is_owner && $gate81_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate81_recipient_e164
                        body_preview: $sms_body|substr:0:200
                        call_site   : "compute_tech_assist_escalation.xs:81"
                        session_id  : $sess.id
                      }
                      }
                    } as $bypass81_log
                  }
                }
              
                var $danielle_phone {
                  value = "+16154850713"
                }
              
                api.request {
                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                  method = "POST"
                  params = {
                    From: $env.TWILIO_FROM_NUMBER
                    To  : $danielle_phone
                    Body: $sms_body
                  }
                
                  headers = [
                    "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                    "Content-Type: application/x-www-form-urlencoded"
                  ]
                } as $owner_sms_resp
              
                conditional {
                  if (($owner_sms_resp.response.status == 201) || ($owner_sms_resp.response.status == 200)) {
                    var.update $esc_sms_action {
                      value = "tech_assist_escalated_to_owner"
                    }
                  }
                }
              }
            }
          }
        }
      
        // Mark escalated even if SMS failed (don't retry forever).
        db.edit tech_assist_session {
          field_name = "id"
          field_value = $sess.id
          data = {
            escalated_at: now
            escalated_to: "danielle_owner_placeholder"
            status      : "escalated"
            updated_at  : now
          }
        } as $marked_escalated
      
        // Audit.
        db.add event_log {
          data = {
            action  : $esc_sms_action
            metadata: {
            session_id    : $sess.id
            job_id        : $sess.job_id
            technician_id : $sess.technician_id
            missing_fields: $sess.required_fields_remaining
          }
          }
        } as $esc_event_log
      }
    }
  }

  schedule = [{starts_on: 2026-05-04 21:00:00+0000, freq: 900}]
  guid = "ZrF10UJ4_NADadbvJv6r0MbvTbk"
}
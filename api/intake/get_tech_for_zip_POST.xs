// Assigns a technician for a given zip code based on cluster assignments and availability.
query get_tech_for_zip verb=POST {
  api_group = "intake"

  input {
    // The zip code to search for
    text zip_code filters=trim
  
    // Whether the waiver has been signed by the customer
    bool waiver_signed?
  }

  stack {
    // Query the service_zone table to find a matching zip code
    db.query service_zone {
      where = $db.service_zone.zip_code == $input.zip_code
      return = {type: "single"}
    } as $zone
  
    var $result {
      value = null
    }
  
    conditional {
      // Check if zone is null
      if ($zone == null) {
        var.update $result {
          value = {
            status: "reject_zone"
            reason: "outside_service_area"
          }
        }
      
        conditional {
          if ($env.OWNER_PHONE_NUMBER != null && $env.OWNER_PHONE_NUMBER != "" && $env.TWILIO_ACCOUNT_SID != null && $env.TWILIO_ACCOUNT_SID != "") {
            // ── SMS_ENABLED gate (call_site: get_tech_for_zip_POST.xs:37) ──
            var $gate37_body {
              value = "Zone rejected for zip: " ~ $input.zip_code
            }
          
            var $gate37_recipient_e164 {
              value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
            }
          
            var $gate37_recipient_bare {
              value = $gate37_recipient_e164|replace:"+1":""
            }
          
            var $gate37_is_owner {
              value = ($gate37_recipient_e164 == "+16154855795") || ($gate37_recipient_bare == "6154855795")
            }
          
            var $gate37_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate37_should_send {
              value = $gate37_sms_enabled || $gate37_is_owner
            }
          
            conditional {
              if ($gate37_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate37_recipient_e164
                    body_preview: $gate37_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "get_tech_for_zip_POST.xs:37"
                  }
                  }
                } as $gate37_log
              }
            
              else {
                conditional {
                  if ($gate37_is_owner && $gate37_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate37_recipient_e164
                        body_preview: $gate37_body|substr:0:200
                        call_site   : "get_tech_for_zip_POST.xs:37"
                      }
                      }
                    } as $bypass37_log
                  }
                }
              
                api.request {
                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                  method = "POST"
                  params = {}
                    |set:"To":$env.OWNER_PHONE_NUMBER
                    |set:"From":$env.TWILIO_FROM_NUMBER
                    |set:"Body":$gate37_body
                  headers = []
                    |push:("Authorization: Basic %s"
                      |sprintf:($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN|base64_encode)
                    )
                } as $sms_res
              }
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : "zone_rejected"
            metadata: {zip_code: $input.zip_code}
          }
        } as $log
      
        return {
          value = $result
        }
      }
    
      // Check if zone is inactive or not accepting new jobs
      elseif ($zone.active == false || $zone.accept_new_jobs == false) {
        var.update $result {
          value = {status: "reject_zone", reason: "zone_inactive"}
        }
      
        conditional {
          if ($env.OWNER_PHONE_NUMBER != null && $env.OWNER_PHONE_NUMBER != "" && $env.TWILIO_ACCOUNT_SID != null && $env.TWILIO_ACCOUNT_SID != "") {
            // ── SMS_ENABLED gate (call_site: get_tech_for_zip_POST.xs:72) ──
            var $gate72_body {
              value = "Zone inactive for zip: " ~ $input.zip_code
            }
          
            var $gate72_recipient_e164 {
              value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
            }
          
            var $gate72_recipient_bare {
              value = $gate72_recipient_e164|replace:"+1":""
            }
          
            var $gate72_is_owner {
              value = ($gate72_recipient_e164 == "+16154855795") || ($gate72_recipient_bare == "6154855795")
            }
          
            var $gate72_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate72_should_send {
              value = $gate72_sms_enabled || $gate72_is_owner
            }
          
            conditional {
              if ($gate72_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate72_recipient_e164
                    body_preview: $gate72_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "get_tech_for_zip_POST.xs:72"
                  }
                  }
                } as $gate72_log
              }
            
              else {
                conditional {
                  if ($gate72_is_owner && $gate72_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate72_recipient_e164
                        body_preview: $gate72_body|substr:0:200
                        call_site   : "get_tech_for_zip_POST.xs:72"
                      }
                      }
                    } as $bypass72_log
                  }
                }
              
                api.request {
                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                  method = "POST"
                  params = {}
                    |set:"To":$env.OWNER_PHONE_NUMBER
                    |set:"From":$env.TWILIO_FROM_NUMBER
                    |set:"Body":$gate72_body
                  headers = []
                    |push:("Authorization: Basic %s"
                      |sprintf:($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN|base64_encode)
                    )
                } as $sms_res
              }
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : "zone_inactive"
            metadata: {zip_code: $input.zip_code}
          }
        } as $log
      
        return {
          value = $result
        }
      }
    
      // Check if waiver is signed
      elseif ($input.waiver_signed == false || $input.waiver_signed == null) {
        var.update $result {
          value = {status: "waiver_required", cluster: $zone.cluster}
        }
      
        return {
          value = $result
        }
      }
    }
  
    // Query cluster assignments for the zone's cluster
    db.query cluster_assignment {
      where = $db.cluster_assignment.cluster == $zone.cluster && $db.cluster_assignment.active == true
      sort = {cluster_assignment.rank: "asc"}
      return = {type: "list"}
    } as $cluster_assignments
  
    var $assigned_technician {
      value = null
    }
  
    var $assigned_rank {
      value = null
    }
  
    // Iterate through cluster assignments to find an active technician
    foreach ($cluster_assignments) {
      each as $assignment {
        conditional {
          if ($assigned_technician == null) {
            db.query technicians {
              where = $db.technicians.id == $assignment.technician_id && $db.technicians.active == true
              return = {type: "single"}
            } as $tech
          
            conditional {
              if ($tech != null) {
                var.update $assigned_technician {
                  value = $tech
                }
              
                var.update $assigned_rank {
                  value = $assignment.rank
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      // If an active technician was found
      if ($assigned_technician != null) {
        var.update $result {
          value = {
            status         : "assigned"
            zip_code       : $input.zip_code
            cluster        : $zone.cluster
            technician_id  : $assigned_technician.id
            technician_name: $assigned_technician.first_name ~ " " ~ $assigned_technician.last_name
            rank           : $assigned_rank
            reason         : "rank_" ~ $assigned_rank ~ "_assigned"
          }
        }
      
        db.add event_log {
          data = {action: "assigned", metadata: $result}
        } as $log
      }
    
      // If no active technician was found
      else {
        var.update $result {
          value = {
            status: "queue_for_later"
            reason: "no_active_tech_in_cluster"
          }
        }
      
        conditional {
          if ($env.OWNER_PHONE_NUMBER != null && $env.OWNER_PHONE_NUMBER != "" && $env.TWILIO_ACCOUNT_SID != null && $env.TWILIO_ACCOUNT_SID != "") {
            // ── SMS_ENABLED gate (call_site: get_tech_for_zip_POST.xs:183) ──
            var $gate183_body {
              value = "No active tech in cluster: " ~ $zone.cluster ~ " for zip: " ~ $input.zip_code
            }
          
            var $gate183_recipient_e164 {
              value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
            }
          
            var $gate183_recipient_bare {
              value = $gate183_recipient_e164|replace:"+1":""
            }
          
            var $gate183_is_owner {
              value = ($gate183_recipient_e164 == "+16154855795") || ($gate183_recipient_bare == "6154855795")
            }
          
            var $gate183_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate183_should_send {
              value = $gate183_sms_enabled || $gate183_is_owner
            }
          
            conditional {
              if ($gate183_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate183_recipient_e164
                    body_preview: $gate183_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "get_tech_for_zip_POST.xs:183"
                  }
                  }
                } as $gate183_log
              }
            
              else {
                conditional {
                  if ($gate183_is_owner && $gate183_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate183_recipient_e164
                        body_preview: $gate183_body|substr:0:200
                        call_site   : "get_tech_for_zip_POST.xs:183"
                      }
                      }
                    } as $bypass183_log
                  }
                }
              
                api.request {
                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                  method = "POST"
                  params = {}
                    |set:"To":$env.OWNER_PHONE_NUMBER
                    |set:"From":$env.TWILIO_FROM_NUMBER
                    |set:"Body":$gate183_body
                  headers = []
                    |push:("Authorization: Basic %s"
                      |sprintf:($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN|base64_encode)
                    )
                } as $sms_res
              }
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : "queue_for_later"
            metadata: {zip_code: $input.zip_code, cluster: $zone.cluster}
          }
        } as $log
      }
    }
  }

  response = $result
  guid = "pk_96FwNvCFfiZftUq52NSDHz_k"
}
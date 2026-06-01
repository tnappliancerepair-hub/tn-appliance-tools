//  Handler for customer YES/NO replies to extra_work_offer SMS.
//  Called by the Netlify customer-sms-inbound webhook BEFORE the generic
//  inbound flow. Returns matched=false if this isn't a response to an
//  active extra-work offer, so the caller can fall through.
// 
//  First-wins logic: a "blast group" is all extra_work_offer_sent
//  event_log rows from the same tech_id within a 15-min window. The
//  first customer in that group to reply YES wins — the job gets booked
//  to the tech, an extra_work_winner_claimed row is written. Subsequent
//  YES from other customers in the same blast: get the consolation reply.
query process_customer_extra_yes verb=POST {
  api_group = "intake"

  input {
    text phone
    text body
  }

  stack {
    var $phone_in {
      value = (($input.phone ?? "")|trim)
    }
  
    var $body_in {
      value = (($input.body ?? "")|trim)
    }
  
    var $body_u {
      value = $body_in|to_upper
    }
  
    var $is_yes {
      value = ($body_u == "YES" || $body_u == "Y" || $body_u == "YEAH" || $body_u == "OK" || $body_u == "OKAY" || $body_u == "SURE")
    }
  
    var $is_no {
      value = ($body_u == "NO" || $body_u == "N" || $body_u == "NOPE" || $body_u == "PASS")
    }
  
    conditional {
      if (!$is_yes && !$is_no) {
        return {
          value = {matched: false, reason: "not_yes_or_no"}
        }
      }
    }
  
    // Normalize phone to digit forms for customer lookup
    var $digits_only {
      value = $phone_in
        |replace:"+":""
        |replace:"-":""
        |replace:"(":""
        |replace:")":""
        |replace:" ":""
    }
  
    var $dig_len {
      value = $digits_only|strlen
    }
  
    var $last10_start {
      value = $dig_len - 10
    }
  
    var $last10 {
      value = ($dig_len >= 10) ? ($digits_only|substr:$last10_start) : $digits_only
    }
  
    var $plus_e164 {
      value = "+" ~ $digits_only
    }
  
    var $plus_us {
      value = "+1" ~ $last10
    }
  
    db.query customer {
      where = $db.customer.phone == $phone_in || $db.customer.phone == $plus_e164 || $db.customer.phone == $plus_us || $db.customer.phone == $last10
      sort = {customer.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $cust_rows
  
    var $customer {
      value = (($cust_rows.items|first) ?? null)
    }
  
    conditional {
      if ($customer == null) {
        return {
          value = {matched: false, reason: "unknown_customer"}
        }
      }
    }
  
    var $cust_id {
      value = $customer.id
    }
  
    // Find any active extra-work offer for this customer in last 15 min
    var $now_ms {
      value = now|to_ms
    }
  
    var $cutoff_ms {
      value = $now_ms - 900000
    }
  
    db.query event_log {
      where = $db.event_log.action == "extra_work_offer_sent" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $offer_rows
  
    var $my_offer {
      value = null
    }
  
    var $my_offer_meta {
      value = null
    }
  
    foreach ($offer_rows.items) {
      each as $or {
        conditional {
          if ($my_offer == null) {
            var $om_raw {
              value = ($or.metadata ?? "")
            }
          
            var $om {
              value = $om_raw|json_decode
            }
          
            conditional {
              if (($om.customer_id ? 0) == $cust_id) {
                var.update $my_offer {
                  value = $or
                }
              
                var.update $my_offer_meta {
                  value = $om
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      if ($my_offer == null) {
        return {
          value = {matched: false, reason: "no_active_offer"}
        }
      }
    }
  
    var $offer_tech_id {
      value = ($my_offer_meta.tech_id ?? 0)
    }
  
    var $offer_job_id {
      value = ($my_offer_meta.job_id ?? 0)
    }
  
    // NO path — log + polite reply, no booking
    conditional {
      if ($is_no) {
        db.add event_log {
          data = {
            action  : "extra_work_offer_declined"
            metadata: {
            tech_id    : $offer_tech_id
            job_id     : $offer_job_id
            customer_id: $cust_id
          }
          }
        } as $no_log
      
        // Send the customer reply inline (Telnyx customer webhook
        // doesn't reply inline; we always send via send_sms).
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {
            recipient_phone: $phone_in
            message_text   : "No problem — we'll text you when we have a regular appointment slot for your repair. Thanks for letting us know."
            recipient_role : "customer"
            message_type   : "extra_work_offer_declined"
            related_job_id : $offer_job_id
          }
        
          headers = []
            |push:"Content-Type: application/json"
        } as $no_send
      
        return {
          value = {matched: true, action: "declined"}
        }
      }
    }
  
    // YES path — first-wins check. Any prior winner_claimed for the
    // same tech in the same 15-min window?
    db.query event_log {
      where = $db.event_log.action == "extra_work_winner_claimed" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $winners
  
    var $existing_winner {
      value = null
    }
  
    var $existing_winner_meta {
      value = null
    }
  
    foreach ($winners.items) {
      each as $wr {
        conditional {
          if ($existing_winner == null) {
            var $wm_raw {
              value = ($wr.metadata ?? "")
            }
          
            var $wm {
              value = $wm_raw|json_decode
            }
          
            conditional {
              if (($wm.tech_id ? 0) == $offer_tech_id) {
                var.update $existing_winner {
                  value = $wr
                }
              
                var.update $existing_winner_meta {
                  value = $wm
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      if ($existing_winner != null) {
        // Someone else already won the tech's slot. Log this customer
        // as an interested-loser so the tech can ADD them later.
        db.add event_log {
          data = {
            action  : "extra_work_offer_loser_interested"
            metadata: {
            tech_id    : $offer_tech_id
            job_id     : $offer_job_id
            customer_id: $cust_id
            winning_job: ($existing_winner_meta.job_id ?? 0)
          }
          }
        } as $loser_log
      
        // SMS the tech: "Bob ALSO said yes — reply ADD Bob to fit him too"
        db.get technicians {
          field_name = "id"
          field_value = $offer_tech_id
        } as $tech_for_alert
      
        db.get jobs {
          field_name = "id"
          field_value = $offer_job_id
        } as $loser_job
      
        var $tech_phone {
          value = (($tech_for_alert.phone ?? "")|trim)
        }
      
        var $tech_first {
          value = (($tech_for_alert.first_name ?? "")|trim)
        }
      
        var $cust_first {
          value = (($customer.first_name ?? "")|trim)
        }
      
        var $loser_appliance {
          value = (($loser_job.appliance_type ?? "")|trim)
        }
      
        conditional {
          if ($tech_phone != "") {
            var $tech_alert_body {
              value = "[ant] " ~ $cust_first ~ " also said YES (" ~ $loser_appliance ~ ", job #" ~ ($offer_job_id|to_text) ~ "). Reply ADD " ~ ($offer_job_id|to_text) ~ " to fit them in next, or ignore to let it go."
            }
          
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method = "POST"
              params = {
                recipient_phone: $tech_phone
                message_text   : $tech_alert_body
                recipient_role : "technician"
                message_type   : "extra_work_loser_alert"
                related_job_id : $offer_job_id
              }
            
              headers = []
                |push:"Content-Type: application/json"
            } as $tech_alert_send
          }
        }
      
        // Send the customer the consolation reply inline
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {
            recipient_phone: $phone_in
            message_text   : ("Another customer was a few minutes ahead of you — but we've let " ~ $tech_first ~ " know you're also available. If he can fit you in we'll text you back!")
            recipient_role : "customer"
            message_type   : "extra_work_offer_lost_race"
            related_job_id : $offer_job_id
          }
        
          headers = []
            |push:"Content-Type: application/json"
        } as $loser_send
      
        return {
          value = {matched: true, action: "lost_race"}
        }
      }
    }
  
    // YES + no prior winner = this customer wins. Book the job.
    var $book_start_ms {
      value = $now_ms
    }
  
    var $book_end_ms {
      value = $now_ms + 7200000
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/auto_book_existing_job"
      method = "POST"
      params = {
        job_id            : $offer_job_id
        technician_id     : $offer_tech_id
        scheduled_start_ms: $book_start_ms
        scheduled_end_ms  : $book_end_ms
        source            : "extra_work_winner"
      }
    
      headers = []
        |push:"Content-Type: application/json"
    } as $book_resp
  
    var $book_ok {
      value = (($book_resp.response.status ?? 0) >= 200 && ($book_resp.response.status ?? 0) < 300)
    }
  
    conditional {
      if (!$book_ok) {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {
            recipient_phone: $phone_in
            message_text   : "We had a hiccup booking your appointment — we'll text you back shortly."
            recipient_role : "customer"
            message_type   : "extra_work_book_failed"
            related_job_id : $offer_job_id
          }
        
          headers = []
            |push:"Content-Type: application/json"
        } as $fail_send
      
        return {
          value = {matched: true, action: "book_failed"}
        }
      }
    }
  
    // Write winner-claimed marker for first-wins dedup
    db.add event_log {
      data = {
        action  : "extra_work_winner_claimed"
        metadata: {
        tech_id        : $offer_tech_id
        job_id         : $offer_job_id
        customer_id    : $cust_id
        booked_start_ms: $book_start_ms
      }
      }
    } as $win_log
  
    // Notify tech that customer accepted
    db.get technicians {
      field_name = "id"
      field_value = $offer_tech_id
    } as $win_tech
  
    db.get jobs {
      field_name = "id"
      field_value = $offer_job_id
    } as $win_job
  
    var $win_tech_phone {
      value = (($win_tech.phone ?? "")|trim)
    }
  
    var $win_tech_first {
      value = (($win_tech.first_name ?? "")|trim)
    }
  
    var $win_cust_first {
      value = (($customer.first_name ?? "")|trim)
    }
  
    var $win_cust_last {
      value = (($customer.last_name ?? "")|trim)
    }
  
    var $win_addr {
      value = (($win_job.service_address ?? "") ~ " " ~ ($win_job.service_city ?? "") ~ " " ~ ($win_job.service_zip ?? ""))|trim
    }
  
    var $win_appliance {
      value = (($win_job.appliance_type ?? "")|trim)
    }
  
    conditional {
      if ($win_tech_phone != "") {
        var $tech_win_body {
          value = "[ant] " ~ $win_cust_first ~ " " ~ $win_cust_last ~ " accepted — added to your schedule. " ~ $win_appliance ~ ", " ~ $win_addr ~ ". Job #" ~ ($offer_job_id|to_text)
        }
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {
            recipient_phone: $win_tech_phone
            message_text   : $tech_win_body
            recipient_role : "technician"
            message_type   : "extra_work_winner_alert"
            related_job_id : $offer_job_id
          }
        
          headers = []
            |push:"Content-Type: application/json"
        } as $tech_win_send
      }
    }
  
    // Send the winning customer their "you got it" reply inline
    var $win_customer_reply {
      value = "You got it! " ~ $win_tech_first ~ " is on the way for your " ~ $win_appliance ~ "."
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        recipient_phone: $phone_in
        message_text   : $win_customer_reply
        recipient_role : "customer"
        message_type   : "extra_work_winner_confirmed"
        related_job_id : $offer_job_id
      }
    
      headers = []
        |push:"Content-Type: application/json"
    } as $win_cust_send
  }

  response = {
    matched: true
    action : "winner_booked"
    job_id : $offer_job_id
    tech_id: $offer_tech_id
  }

  guid = "process-customer-extra-yes-v1"
}
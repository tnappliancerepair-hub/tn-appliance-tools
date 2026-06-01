// Creates a new job from direct input (Ant chat)
query create_job verb=POST {
  api_group = "intake"

  input {
    text rawRequest?
    text first_name?
    text last_name?
    text phone?
    text zip?
    text appliance_type?
    text brand?
    text model_number?
    text problem_summary?
    text recommended_service?
    text source_type?
    text channel?
  }

  stack {
    var $first_name {
      value = $input.first_name
    }
  
    var $last_name {
      value = $input.last_name
    }
  
    var $phone {
      value = $input.phone
    }
  
    var $email {
      value = null
    }
  
    var $appliance_type {
      value = $input.appliance_type
    }
  
    var $brand {
      value = $input.brand
    }
  
    var $model_number {
      value = $input.model_number
    }
  
    var $problem_summary {
      value = $input.problem_summary
    }
  
    var $zip {
      value = $input.zip
    }
  
    var $address {
      value = null
    }
  
    var $state {
      value = null
    }
  
    var $city {
      value = null
    }
  
    var $recommended_service {
      value = $input.recommended_service
    }
  
    var $source_type {
      value = $input.source_type
    }
  
    db.query customer {
      where = $db.customer.phone == $phone
      return = {type: "single"}
    } as $existing_customer
  
    conditional {
      if ($existing_customer == null) {
        db.add customer {
          data = {
            first_name: $first_name
            last_name : $last_name
            phone     : $phone
            email     : $email
            address   : $address
            city      : $city
            state     : $state
            zip       : $zip
          }
        } as $new_customer
      
        var $customer_id {
          value = $new_customer.id
        }
      }
    
      else {
        var $customer_id {
          value = $existing_customer.id
        }
      }
    }
  
    db.add jobs {
      data = {
        customer_id        : $customer_id
        job_number         : null
        current_status     : "pending"
        friendly_status    : "Pending Review"
        problem_summary    : $problem_summary
        appliance_type     : $appliance_type
        brand              : $brand
        model_number       : $model_number
        payment_status     : "unpaid"
        source_type        : $source_type
        source_agent       : "system"
        customer_type      : "self_pay"
        warranty_company   : ""
        claim_number       : ""
        recommended_service: $recommended_service
        job_status         : "submitted"
        triage_status      : "not_reviewed"
        parts_status       : "not_needed"
        scheduling_status  : "not_ready"
      }
    } as $new_job
  
    db.add job_financial {
      data = {job_id: $new_job.id, payment_status: "unpaid"}
    } as $new_job_financial
  
    db.add job_event {
      data = {
        job_id      : $new_job.id
        event_type  : "intake_created"
        event_source: "Web Chat"
        created_by  : "system"
      }
    } as $new_job_event
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:intake/send_sms"
      method = "POST"
      params = {
        customer_phone     : $phone
        customer_first_name: $first_name
        job_number         : $new_job.id|to_text
      }
    
      headers = ["Content-Type: application/json"]
    } as $api1
  
    // Simplified quick check detection logic as requested
    conditional {
      if ($recommended_service == "quick_check" || $recommended_service == "Quick Check" || $recommended_service == "$50 Quick Check" || $recommended_service == "premium_call" || $recommended_service == "Premium" || $recommended_service == "$90") {
        db.edit jobs {
          field_name = "id"
          field_value = $new_job.id
          data = {technician_id: 1, triage_status: "routed"}
        } as $jobs1
      }
    
      else {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_tech_for_zip"
          method = "POST"
          params = {zip_code: $zip, waiver_signed: true}
          headers = ["Content-Type: application/json"]
        } as $routing_response
      
        var $routing_result {
          value = $routing_response.response.result
        }
      
        conditional {
          if ($routing_result.status == "assigned") {
            db.edit jobs {
              field_name = "id"
              field_value = $new_job.id
              data = {
                technician_id: $routing_result.technician_id
                triage_status: "routed"
              }
            } as $jobs1
          }
        
          elseif ($routing_result.status == "reject_zone") {
            db.edit jobs {
              field_name = "id"
              field_value = $new_job.id
              data = {
                triage_status  : "needs_review"
                current_status : "out_of_area"
                friendly_status: "Out of Service Area"
              }
            } as $jobs1
          
            db.add job_event {
              data = {
                job_id      : $new_job.id
                event_type  : "routing_reject_zone"
                event_source: "get_tech_for_zip"
                created_by  : "system"
              }
            } as $reject_event
          }
        
          elseif ($routing_result.status == "queue_for_later") {
            db.edit jobs {
              field_name = "id"
              field_value = $new_job.id
              data = {
                triage_status  : "needs_tech_assignment"
                current_status : "needs_tech_assignment"
                friendly_status: "Awaiting Tech Assignment"
              }
            } as $jobs1
          
            db.add job_event {
              data = {
                job_id      : $new_job.id
                event_type  : "routing_queue_for_later"
                event_source: "get_tech_for_zip"
                created_by  : "system"
              }
            } as $queue_event
          }
        }
      }
    }
  
    api.request {
      url = $env.HCP_BASE_URL ~ "/customers"
      method = "POST"
      params = {
        first_name   : $first_name
        last_name    : $last_name
        email        : $email
        mobile_number: $phone
      }
    
      headers = [
        "Content-Type: application/json"
        "Authorization: Token " ~ $env.HCP_API_KEY
      ]
    } as $hcp_customer_response
  
    var $hcp_customer_id {
      value = $hcp_customer_response.response.result.id ?? null
    }
  
    conditional {
      if ($hcp_customer_id != null) {
        api.request {
          url = $env.HCP_BASE_URL ~ "/jobs"
          method = "POST"
          params = {customer_id: $hcp_customer_id}
          headers = [
            "Content-Type: application/json"
            "Authorization: Token " ~ $env.HCP_API_KEY
          ]
        } as $hcp_job_response
      
        conditional {
          if ($hcp_job_response.response.result.id != null) {
            api.request {
              url = $env.HCP_BASE_URL ~ "/jobs/" ~ ($hcp_job_response.response.result.id|to_text) ~ "/notes"
              method = "POST"
              params = {content: $problem_summary}
              headers = [
                "Authorization: Token " ~ $env.HCP_API_KEY
                "Content-Type: application/json"
              ]
            } as $hcp_job_note_response
          }
        }
      }
    }
  
    var $teddy_full_name {
      value = ($first_name ?? "") ~ " " ~ ($last_name ?? "")
    }
  
    api.request {
      url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/send-teddy-sms"
      method = "POST"
      params = {
        job_id       : $new_job.id|to_text
        customer_name: $teddy_full_name
        appliance    : $appliance_type ?? ""
        brand        : $brand ?? ""
        problem      : $problem_summary ?? ""
      }
    
      headers = ["Content-Type: application/json"]
    } as $teddy_sms_response
  
    db.add event_log {
      data = {
        action  : "teddy_sms_triggered"
        metadata: {
        job_id        : $new_job.id
        customer_phone: $phone
        response      : $teddy_sms_response.response.result
      }
      }
    } as $teddy_sms_log
  }

  response = $new_job
  guid = "qQRF335pY8HiwgzKbw1ywAM-yuA"
}
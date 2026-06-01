//  One-shot test rig for Ant Assist (tech_sms_assist). Creates a parallel-mode
//  test customer + job + parallel marker. Returns job_id + ready-to-use URLs.
//  Used when an operator wants to dogfood the scribe-mode TDR flow without
//  waiting for a real warranty email or HCP-origin job.
// 
//  POST /create_test_tech_job
//    { tech_id?: int (default 1 Teddy), appliance?: text, problem?: text }
// 
//  Returns { success, job_id, customer_id, tech_assist_url, tech_sms_test_hint }
query create_test_tech_job verb=POST {
  api_group = "intake"

  input {
    int? tech_id?
    text? appliance?
    text? problem?
  }

  stack {
    var $tech_id_in {
      value = ($input.tech_id ?? 1)
    }
  
    var $appliance_in_raw {
      value = (($input.appliance ?? "Refrigerator")|trim)
    }
  
    var $appliance_clean {
      value = ($appliance_in_raw == "") ? "Refrigerator" : $appliance_in_raw
    }
  
    var $problem_in_raw {
      value = (($input.problem ?? "Ant Assist test — fridge not cooling, possible compressor")|trim)
    }
  
    var $problem_clean {
      value = ($problem_in_raw == "") ? "Ant Assist test — fridge not cooling, possible compressor" : $problem_in_raw
    }
  
    var $now_ms {
      value = now|to_ms
    }
  
    // Reuse the persistent test customer if it exists (match on test phone)
    db.query customer {
      where = $db.customer.phone == "+16155550001"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_cust
  
    var $cust_id {
      value = 0
    }
  
    conditional {
      if (($existing_cust.items|count) > 0) {
        var.update $cust_id {
          value = $existing_cust.items|get:0|get:"id"
        }
      }
    
      else {
        db.add customer {
          data = {
            first_name: "Ant"
            last_name : "Test"
            phone     : "+16155550001"
            email     : "anttest@tnappliancerepair.local"
            address   : "123 Test Lane"
            city      : "Antioch"
            state     : "TN"
            zip       : "37013"
            company_id: 1
          }
        } as $new_cust
      
        var.update $cust_id {
          value = $new_cust.id
        }
      }
    }
  
    // Schedule the job for 30 min from now so the dashboard shows it
    var $scheduled {
      value = $now_ms + 1800000
    }
  
    db.add jobs {
      data = {
        customer_id      : $cust_id
        technician_id    : $tech_id_in
        appliance_type   : $appliance_clean
        brand            : "LG"
        model            : "LFXS28968S"
        problem_summary  : $problem_clean
        customer_type    : "self_pay"
        warranty_company : ""
        scheduling_status: "scheduled"
        current_status   : "scheduled"
        scheduled_start  : $scheduled
        service_address  : "123 Test Lane"
        service_city     : "Antioch"
        service_state    : "TN"
        service_zip      : "37013"
        intake_source    : "manual"
        company_id       : 1
      }
    } as $job
  
    // Write the parallel marker so tech_sms_assist scope-guard lets this job
    // through to scribe mode (rather than routing to legacy)
    db.add event_log {
      data = {
        action  : "parallel_job_created_from_email"
        metadata: {
        job_id       : $job.id
        customer_id  : $cust_id
        intake_source: "manual_test"
        source_label : "ant_assist_test_rig"
      }
      }
    } as $marker
  
    // Audit row for visibility in office-pulse
    db.add event_log {
      data = {
        action  : "test_tech_job_created"
        metadata: {
        job_id   : $job.id
        tech_id  : $tech_id_in
        appliance: $appliance_clean
      }
      }
    } as $audit
  
    var $assist_url {
      value = "https://tnapplianceexchange.net/tech-ant-live.html?job_id=" ~ $job.id ~ "&tech_id=" ~ $tech_id_in
    }
  }

  response = {
    success           : true
    job_id            : $job.id
    customer_id       : $cust_id
    scheduled_start_ms: $scheduled
    tech_assist_url   : $assist_url
    tech_sms_test_hint: "Or text +1-615-857-8800 (tech line) — your messages route to Ant Assist for any open parallel-mode job. Try something like: 'compressor failed, replaced compressor, 1.5 hours, all done'"
  }

  guid = "create-test-tech-job-v1"
}
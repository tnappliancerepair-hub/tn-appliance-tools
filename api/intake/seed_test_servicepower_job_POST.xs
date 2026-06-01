//  One-shot test seeder. Creates a fake ServicePower warranty job in
//  "completed, needs portal submission" state so it appears at the top
//  of Office Today's warranty_submissions_due section. Used to verify
//  the SP portal URL button without waiting for a real completion.
// 
//  Inserts:
//    - one customer (first_name="ServicePower", last_name="Test <ts>")
//    - one job (warranty_company="ServicePower",
//               customer_type="warranty",
//               scheduling_status="completed",
//               job_completed_at=now)
//    - one TDR row tied to the job, with all 5 completeness fields filled
// 
//  Returns the job_id so the caller can deep-link straight to it.
query seed_test_servicepower_job verb=POST {
  api_group = "intake"

  input {
    text? note?
  }

  stack {
    var $now_ms {
      value = now|to_ms
    }
  
    var $ts_text {
      value = $now_ms|to_text
    }
  
    var $note_clean {
      value = (($input.note ?? "")|trim)
    }
  
    db.add customer {
      data = {
        first_name: "ServicePower"
        last_name : ("Test " ~ $ts_text)
        phone     : "+16154855795"
        email     : "test+sp@tnappliancerepair.com"
        address   : "123 Test St"
        city      : "Antioch"
        state     : "TN"
        zip       : "37013"
        company_id: 1
      }
    } as $new_cust
  
    db.add jobs {
      data = {
        customer_id      : $new_cust.id
        customer_type    : "warranty"
        warranty_company : "ServicePower"
        appliance_type   : "Refrigerator"
        brand            : "Whirlpool"
        model_number     : "WRS555SIHZ"
        serial_number    : "TEST0000001"
        problem_summary  : "Test job — verifying ServicePower portal link from Office Today"
        scheduling_status: "completed"
        intake_source    : "manual"
        job_completed_at : $now_ms
        scheduled_start  : ($now_ms - 7200000)
        technician_id    : 1
        company_id       : 1
        parallel_mode    : false
        notes            : ("seeded by seed_test_servicepower_job at " ~ $ts_text ~ " — " ~ $note_clean)
      }
    } as $new_job
  
    db.add technician_decision_report {
      data = {
        job_id             : $new_job.id
        technician_id      : 1
        diagnosis          : "Test diagnosis — compressor relay failed, replaced with OEM part."
        failed_component   : "Compressor start relay"
        failure_cause      : "normal_wear"
        failure_cause_notes: "Aged relay - typical 8-year wear pattern"
        labor_time_hours   : 1
        repair_completed   : "Replaced compressor start relay, verified cooling cycle, customer signed off"
      }
    } as $new_tdr
  
    db.add event_log {
      data = {
        action  : "seed_test_servicepower_job"
        metadata: {
        job_id      : $new_job.id
        customer_id : $new_cust.id
        tdr_id      : $new_tdr.id
        note        : $note_clean
        seeded_at_ms: $now_ms
      }
      }
    } as $audit
  }

  response = {
    success         : true
    job_id          : $new_job.id
    customer_id     : $new_cust.id
    tdr_id          : $new_tdr.id
    office_today_url: "https://tnapplianceexchange.net/office-today.html"
    job_detail_url  : ("https://tnapplianceexchange.net/job-detail.html?job_id=" ~ ($new_job.id|to_text))
  }

  guid = "seed-test-servicepower-job-v1"
}
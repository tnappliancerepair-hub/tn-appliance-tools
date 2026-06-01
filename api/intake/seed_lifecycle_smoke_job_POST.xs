// Lifecycle smoke seed. Minimal version.
query seed_lifecycle_smoke_job verb=POST {
  api_group = "intake"

  input {
    text? note?
  }

  stack {
    db.add customer {
      data = {
        first_name : "LifecycleSmoke"
        last_name  : "SmokeTest"
        phone      : "+16154855795"
        email      : "test+lifecycle@tnappliancerepair.com"
        address    : "5500 Smithers Dr"
        city       : "Antioch"
        state      : "TN"
        zip        : "37013"
        company_id : 1
      }
    } as $cust

    db.add jobs {
      data = {
        customer_id       : $cust.id
        customer_type     : "warranty"
        warranty_company  : "AHS"
        appliance_type    : "Refrigerator"
        brand             : "Whirlpool"
        problem_summary   : "Lifecycle smoke test"
        scheduling_status : "not_ready"
        intake_source     : "manual"
        parallel_mode     : true
        company_id        : 1
        service_address   : "5500 Smithers Dr"
        service_city      : "Antioch"
        service_state     : "TN"
        service_zip       : "37013"
      }
    } as $job
  }

  response = {
    success    : true
    job_id     : $job.id
    customer_id: $cust.id
  }

  guid = "seed-lifecycle-smoke-job-v1"
}

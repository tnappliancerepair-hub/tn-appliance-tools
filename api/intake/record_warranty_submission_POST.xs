//  Record that a warranty claim has been submitted to the vendor portal.
//  Danielle's "✓ Mark submitted" button on Office Today fires this after
//  she pastes the claim into the AHS / ServicePower portal and gets a
//  confirmation #.
// 
//  Writes event_log action="warranty_submitted" so the Office Today
//  query filters this job out of the "due" list.
// 
//  FUTURE: when warranty portal automation (Playwright/API adapters)
//  lands, the same endpoint records the submission — only the caller
//  changes from human-click to agent-driven.
query record_warranty_submission verb=POST {
  api_group = "intake"

  input {
    int job_id
    text confirmation_id
    text? vendor?
    text? notes?
    int? submitted_by_tech_id?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    var $vendor_eff {
      value = `(($input.vendor ?? "")|trim != "") ? $input.vendor : ($job.warranty_company ?? "unknown")`
    }
  
    var $confirmation_clean {
      value = ($input.confirmation_id ?? "")|trim
    }
  
    var $submitter {
      value = ($input.submitted_by_tech_id ?? 0)
    }
  
    var $action_key {
      value = "warranty_submitted_" ~ ($input.job_id|to_text)
    }
  
    db.add event_log {
      data = {
        action  : $action_key
        metadata: {
        job_id              : $input.job_id
        vendor              : $vendor_eff
        confirmation_id     : $confirmation_clean
        notes               : (($input.notes ?? "")|trim)
        submitted_by_tech_id: $submitter
        customer_id         : ($job.customer_id ?? 0)
        warranty_company    : ($job.warranty_company ?? "")
      }
      }
    } as $audit
  }

  response = {
    success        : true
    job_id         : $input.job_id
    confirmation_id: ($input.confirmation_id ?? "")
    vendor         : $vendor_eff
    audit_event_id : $audit.id
  }

  guid = "record-warranty-submission-v1"
}
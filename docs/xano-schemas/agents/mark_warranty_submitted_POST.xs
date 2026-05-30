// Mark a warranty job as submitted (or undo a submission).
//
// Powers the submit / undo button on warranty-submission-dashboard.html.
//
// Contract:
//   Request:  { job_id: int, submitted: bool }
//     - submitted=true  -> sets jobs.warranty_submitted_at = now (ms)
//     - submitted=false -> sets jobs.warranty_submitted_at = null (undo)
//   Response: {
//     success: bool,
//     job_id: int,
//     warranty_submitted: bool,                  // derived: (warranty_submitted_at != null)
//     warranty_submitted_at: int|null            // the new timestamp value
//   }
//
// Schema fact (verified 2026-05-30):
//   jobs.warranty_submitted_at — timestamp (ms), nullable, default null.
//   Column added 2026-05-30 via Metadata API.
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if, every
// filter paren-wrapped, ?? only in value = (...).

query mark_warranty_submitted verb=POST {
  api_group = "intake"

  input {
    int job_id
    bool submitted
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required and must be positive"
    }

    // Confirm the job exists before mutating
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job_row

    precondition ($job_row != null) {
      error_type = "notfound"
      error = "job not found"
    }

    // Build the target timestamp value: now-as-ms if submitting,
    // null if undoing. We capture in a plain var to keep the
    // db.edit data block trivial.
    var $target_ts {
      value = null
    }

    conditional {
      if ($input.submitted == true) {
        var.update $target_ts {
          value = (now|to_ms)
        }
      }
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        warranty_submitted_at: $target_ts
      }
    } as $updated_job

    // Audit row — useful for "who submitted what when" later.
    db.add event_log {
      data = {
        action: "warranty_submission_toggled"
        metadata: {
          job_id: $input.job_id
          submitted: $input.submitted
          warranty_submitted_at: $target_ts
          warranty_company: ($job_row.warranty_company ?? "")
          claim_number: ($job_row.claim_number ?? "")
        }
      }
    } as $audit_log

    var $is_submitted {
      value = ($target_ts != null)
    }
  }

  response = {
    success: true
    job_id: $input.job_id
    warranty_submitted: $is_submitted
    warranty_submitted_at: $target_ts
  }

  guid = "mark-warranty-submitted-v1"
}

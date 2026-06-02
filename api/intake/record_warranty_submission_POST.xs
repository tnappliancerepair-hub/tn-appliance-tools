// Records a warranty claim submission lifecycle event.
//
// Callers today:
//   - office-today.html "✓ Mark submitted" button (after Danielle pastes
//     the claim into the vendor portal)
//   - warranty-review.html "Mark submitted" UI (Phase 0)
//   - Future vendor adapter agents (Phase 1 — API / Playwright)
//   - gmail-vendor-watcher Netlify fn (flips status to paid / denied when
//     vendor confirmation emails land)
//
// Behavior:
//   - Idempotent upsert by (job_id, vendor) into warranty_submissions table
//   - Always writes an event_log audit row (matches office-today's existing
//     filter pattern: action="warranty_submitted_<job_id>")
//   - Newer fields are all optional so v1 callers keep working
query record_warranty_submission verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? confirmation_id?
    text? vendor?
    text? status?
    text? submission_method?
    decimal? paid_amount?
    text? notes?
    text? submitted_by?
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

    // Effective vendor: input wins, else job.warranty_company, else "unknown"
    var $vendor_in    { value = (($input.vendor ?? "")|trim) }
    var $vendor_eff   { value = ($vendor_in != "") ? $vendor_in : (($job.warranty_company ?? "unknown")|trim) }
    var $vendor_norm  { value = $vendor_eff|lower }

    var $confirmation_clean { value = ($input.confirmation_id ?? "")|trim }

    var $status_in    { value = (($input.status ?? "")|trim|lower) }
    // Default status: 'submitted' if confirmation_id present, else 'pending'
    var $status_clean { value = ($status_in != "") ? $status_in : (($confirmation_clean != "") ? "submitted" : "pending") }

    var $method_in    { value = (($input.submission_method ?? "")|trim|lower) }
    var $method_clean { value = ($method_in != "") ? $method_in : "mark_submitted_ui" }

    var $notes_clean  { value = ($input.notes ?? "")|trim }

    var $submitter_text_in { value = (($input.submitted_by ?? "")|trim) }
    var $submitter_tech_id { value = ($input.submitted_by_tech_id ?? 0) }
    var $submitter_eff     { value = ($submitter_text_in != "") ? $submitter_text_in : (($submitter_tech_id > 0) ? ("tech_" ~ ($submitter_tech_id|to_text)) : "office") }

    var $paid_amount_val { value = ($input.paid_amount ?? 0) }
    var $paid_at_val     { value = ($status_clean == "paid") ? now : null }

    // Upsert by (job_id, vendor_norm) into warranty_submissions.
    db.query warranty_submissions {
      where = $db.warranty_submissions.job_id == $input.job_id
      sort = {warranty_submissions.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $existing_rows

    var $matched_id     { value = 0 }
    var $prior_attempts { value = 0 }

    foreach ($existing_rows.items) {
      each as $r {
        conditional {
          if ($matched_id == 0) {
            var $r_vendor { value = (($r.vendor ?? "")|trim|lower) }
            conditional {
              if ($r_vendor == $vendor_norm) {
                var.update $matched_id { value = $r.id }
                var.update $prior_attempts { value = ($r.attempts ?? 0) }
              }
            }
          }
        }
      }
    }

    var $new_attempts { value = $prior_attempts + 1 }
    var $submission_id { value = 0 }

    conditional {
      if ($matched_id > 0) {
        db.edit warranty_submissions {
          field_name = "id"
          field_value = $matched_id
          data = {
            status            : $status_clean
            confirmation_id   : $confirmation_clean
            submission_method : $method_clean
            attempts          : $new_attempts
            last_attempt_at   : now
            paid_amount       : $paid_amount_val
            paid_at           : $paid_at_val
            notes             : $notes_clean
            submitted_by      : $submitter_eff
            vendor            : $vendor_norm
          }
        } as $updated
        var.update $submission_id { value = $matched_id }
      }
    }

    conditional {
      if ($matched_id == 0) {
        db.add warranty_submissions {
          data = {
            job_id            : $input.job_id
            vendor            : $vendor_norm
            status            : $status_clean
            confirmation_id   : $confirmation_clean
            submission_method : $method_clean
            attempts          : 1
            last_attempt_at   : now
            paid_amount       : $paid_amount_val
            paid_at           : $paid_at_val
            notes             : $notes_clean
            submitted_by      : $submitter_eff
          }
        } as $created
        var.update $submission_id { value = $created.id }
      }
    }

    // Back-compat audit row (office-today filter looks for
    // action == "warranty_submitted_<job_id>" — preserve that exact shape).
    var $action_key { value = "warranty_submitted_" ~ ($input.job_id|to_text) }

    db.add event_log {
      data = {
        action  : $action_key
        metadata: {
          submission_id        : $submission_id
          job_id               : $input.job_id
          vendor               : $vendor_eff
          confirmation_id      : $confirmation_clean
          status               : $status_clean
          submission_method    : $method_clean
          notes                : $notes_clean
          submitted_by         : $submitter_eff
          submitted_by_tech_id : $submitter_tech_id
          customer_id          : ($job.customer_id ?? 0)
          warranty_company     : ($job.warranty_company ?? "")
          updated_existing     : ($matched_id > 0)
        }
      }
    } as $audit
  }

  response = {
    success         : true
    submission_id   : $submission_id
    job_id          : $input.job_id
    confirmation_id : $confirmation_clean
    vendor          : $vendor_eff
    status          : $status_clean
    updated         : ($matched_id > 0)
    audit_event_id  : $audit.id
  }

  guid = "record-warranty-submission-v1"
}

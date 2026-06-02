// Writes a part_number + confidence_tier to a job's latest TDR. Called
// by the parts search modal's "Apply to TDR" button after a tech /
// Teddy / Danielle picks a candidate.
//
// Behavior:
//   - Finds the latest TDR for the job (any tech)
//   - If no TDR exists yet, creates a minimal one
//   - Sets verified_part_number + verified_part_confidence
//   - Writes audit row so we can trace where each part number came from
//
// The confidence tier is preserved DOWNSTREAM:
//   - warranty-review paste fields show the badge
//   - office-today TDR view shows it
//   - tech-ant-chat briefing shows it
// If Danielle sees a LOW or GUESS, she clicks the badge → re-opens the
// search modal pre-filled to re-verify before warranty submission.
query apply_part_to_tdr verb=POST {
  api_group = "intake"

  input {
    int job_id
    text part_number
    text? confidence_tier?
    text? part_name?
    text? source_summary?
    text? applied_by?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    var $part_clean   { value = ($input.part_number ?? "")|trim }
    var $conf_in      { value = (($input.confidence_tier ?? "")|trim|upper) }
    var $conf_clean   { value = ($conf_in != "") ? $conf_in : "UNVERIFIED" }
    var $applied_by_clean { value = (($input.applied_by ?? "office")|trim) }

    precondition ($part_clean != "") {
      error_type = "inputerror"
      error = "part_number required"
    }

    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $existing { value = (($rows.items|first) ?? null) }
    var $tdr_id   { value = 0 }

    conditional {
      if ($existing != null) {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing.id
          data = {
            verified_part_number     : $part_clean
            verified_part_confidence : $conf_clean
          }
        } as $updated
        var.update $tdr_id { value = $existing.id }
      }
    }

    conditional {
      if ($existing == null) {
        db.add technician_decision_report {
          data = {
            job_id                   : $input.job_id
            verified_part_number     : $part_clean
            verified_part_confidence : $conf_clean
            technician_id            : 0
          }
        } as $created
        var.update $tdr_id { value = $created.id }
      }
    }

    db.add event_log {
      data = {
        action    : "part_applied_to_tdr"
        metadata  : {
          job_id            : $input.job_id
          tdr_id            : $tdr_id
          part_number       : $part_clean
          confidence_tier   : $conf_clean
          part_name         : (($input.part_name ?? "")|trim)
          source_summary    : (($input.source_summary ?? "")|trim)
          applied_by        : $applied_by_clean
          updated_existing  : ($existing != null)
        }
      }
    } as $audit
  }

  response = {
    success           : true
    tdr_id            : $tdr_id
    job_id            : $input.job_id
    part_number       : $part_clean
    confidence_tier   : $conf_clean
    updated_existing  : ($existing != null)
    audit_event_id    : $audit.id
  }

  guid = "apply-part-to-tdr-v1"
}

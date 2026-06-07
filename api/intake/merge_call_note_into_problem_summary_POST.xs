// Merges a phone-call summary into jobs.problem_summary so the customer's
// spoken problem reaches the tech's TDR pre-fill (tech-ant-chat reads
// jobs.problem_summary). Called by vapi-webhook.js at end-of-call when the
// caller is matched to a job. Append-only + idempotent: if the note text is
// already a substring of problem_summary, it is a no-op (guards against the
// same end-of-call-report being processed twice). When problem_summary is
// empty, it becomes the note verbatim; otherwise the note is appended with a
// clear delimiter so the original intake text is preserved.
query merge_call_note_into_problem_summary verb=POST {
  api_group = "intake"

  input {
    int job_id
    text note
    text? source?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job not found"}
        }
      }
    }

    var $note_clean {
      value = ($input.note ?? "")|trim
    }

    conditional {
      if ($note_clean == "") {
        return {
          value = {success: true, merged: false, skipped: "empty_note"}
        }
      }
    }

    var $existing {
      value = ($job.problem_summary ?? "")|trim
    }

    var $already_present {
      value = ($existing|contains:$note_clean)
    }

    conditional {
      if ($already_present == true) {
        return {
          value = {success: true, merged: false, skipped: "already_present"}
        }
      }
    }

    var $prefix {
      value = (($input.source ?? "Phone call")|trim)
    }

    var $merged {
      value = ($existing == "") ? $note_clean : ($existing ~ "  ||  [" ~ $prefix ~ "] " ~ $note_clean)
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {problem_summary: $merged}
    } as $updated

    db.add event_log {
      data = {
        action  : "call_note_merged_into_problem_summary"
        metadata: {
          job_id: $input.job_id
          source: $prefix
        }
      }
    } as $log
  }

  response = {success: true, merged: true, job_id: $input.job_id}
  guid = "merge-call-note-problem-summary-v1"
}

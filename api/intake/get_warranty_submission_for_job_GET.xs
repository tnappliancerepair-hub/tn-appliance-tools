// Returns the most recent warranty submission record for a given job
// (any vendor). Used by warranty-review.html to render status badges +
// pre-fill the confirmation # input when re-marking.
query get_warranty_submission_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.query warranty_submissions {
      where = $db.warranty_submissions.job_id == $input.job_id
      sort = {warranty_submissions.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $rows

    var $row { value = (($rows.items|first) ?? null) }
  }

  response = {
    success    : true
    job_id     : $input.job_id
    has_record : ($row != null)
    submission : $row
  }

  guid = "get-warranty-submission-for-job-v1"
}

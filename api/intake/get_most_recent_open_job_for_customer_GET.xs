// Tags inbound Vapi calls with the customer's most-recent OPEN job
// so the call summary surfaces on the right per-job timeline.
query get_most_recent_open_job_for_customer verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    db.query jobs {
      where = $db.jobs.customer_id == $input.customer_id && $db.jobs.scheduling_status != "completed" && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $job { value = (($rows.items|first) ?? null) }
    var $job_id { value = ($job == null) ? 0 : $job.id }
  }

  response = {
    success: true
    job_id : $job_id
    found  : ($job_id > 0)
  }

  guid = "get-most-recent-open-job-for-customer-v1"
}

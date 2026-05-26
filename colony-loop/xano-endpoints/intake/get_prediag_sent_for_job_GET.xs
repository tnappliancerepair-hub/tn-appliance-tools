// Dedup: has a pre-diagnosis-request SMS already been sent for this job?
// Used by job_created.js to avoid re-spamming Teddy + assigned tech on
// repeated JOB_CREATED signals (e.g. retry / requeue / DRY_RUN reruns).
// Looks back 48 hours so a same-day duplicate is suppressed but a stale
// row from weeks ago doesn't permanently block re-asking.
query get_prediag_sent_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    var $cutoff {
      value = ((now|to_ms) - (48 * 60 * 60 * 1000))
    }

    db.query event_log {
      where = $db.event_log.action == "prediag_request_sent" && $db.event_log.metadata.job_id == $input.job_id && $db.event_log.created_at >= $cutoff
      sort  = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first {
      value = (($rows.items|first) ?? null)
    }

    var $sent_flag { value = ($first != null) }
    var $last_at   { value = ($first.created_at ?? null) }
  }

  response = {
    success     : true
    sent        : $sent_flag
    last_sent_at: $last_at
  }

  guid = "get-prediag-sent-for-job-v1"
}

// Returns the cached pre-job intelligence summary written by the
// nightly pre_job_intelligence_prestager. Tech Assist + the tech
// dashboard call this at session start.
query get_pre_job_intelligence verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error      = "job_id required"
    }

    var $action_name {
      value = "pre_job_intelligence_" ~ $input.job_id
    }
    var $cutoff_ms {
      value = ((now|to_ms) - 86400000)  // 24h freshness window
    }

    db.query event_log {
      filter {
        $this.action == $action_name
        && $this.created_at >= $cutoff_ms
      }
      sort = {created_at: "desc"}
      per_page = 1
    } as $rows

    var $top { value = (($rows.items|first) ?? null) }
    var $found { value = ($top != null) }
    var $meta { value = ($found) ? $top.metadata : "" }
  }

  response = {
    job_id   : $input.job_id
    found    : $found
    metadata : $meta
  }

  guid = "get-pre-job-intelligence-v1"
}

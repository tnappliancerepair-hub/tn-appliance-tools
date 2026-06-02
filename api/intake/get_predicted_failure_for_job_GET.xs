// Returns the latest AI-generated pre-diagnosis (tdr_suggestion_drafted)
// for a job, parsed into structured fields. Used by tech-ant-chat and
// tech-daily-dashboard to show 'before you go: order this part' guidance.
query get_predicted_failure_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    var $marker { value = "\"job_id\":" ~ ($input.job_id|to_text) }

    db.query event_log {
      where = $db.event_log.action == "tdr_suggestion_drafted"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows

    var $match { value = null }

    foreach ($rows.items) {
      each as $r {
        conditional {
          if ($match == null) {
            var $meta_str { value = ($r.metadata|json_encode) }
            var $stripped { value = $meta_str|replace:$marker:"" }
            var $len_a { value = $meta_str|strlen }
            var $len_b { value = $stripped|strlen }
            conditional {
              if ($len_b < $len_a) {
                var.update $match {
                  value = {
                    id        : $r.id
                    created_at: $r.created_at
                    metadata  : $r.metadata
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success    : true
    job_id     : $input.job_id
    has_draft  : ($match != null)
    suggestion : $match
  }

  guid = "get-predicted-failure-for-job-v1"
}

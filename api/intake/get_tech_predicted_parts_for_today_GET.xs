// Tech-side morning brief data — returns today's jobs for one tech +
// the most recent TDR per job so the agent can compile a parts-grab
// list for the Marcones-first SMS.
query get_tech_predicted_parts_for_today verb=GET {
  api_group = "intake"

  input {
    int tech_id
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    precondition ($tech != null) {
      error_type = "notfound"
      error = "tech not found"
    }

    var $now_ms { value = (now|to_ms) }
    var $window_start_ms { value = ($now_ms - (12 * 3600 * 1000)) }
    var $window_end_ms   { value = ($now_ms + (18 * 3600 * 1000)) }

    db.query jobs {
      where = $db.jobs.technician_id == $input.tech_id && $db.jobs.scheduled_start >= $window_start_ms && $db.jobs.scheduled_start <= $window_end_ms
      sort  = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $jobs

    // Latest TDR (any author) per today's jobs — capped at 50 rows total
    // because today's queue is bounded. Caller-side agent computes hints.
    db.query technician_decision_report {
      where = $db.technician_decision_report.technician_id == $input.tech_id && $db.technician_decision_report.created_at >= ($window_start_ms - (7 * 86400 * 1000))
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tdrs
  }

  response = {
    success         : true
    tech_id         : $input.tech_id
    tech_first_name : ($tech.first_name ?? "")
    job_count       : (($jobs.items ?? [])|length)
    jobs            : ($jobs.items ?? [])
    recent_tdrs     : ($tdrs.items ?? [])
  }

  guid = "get-tech-predicted-parts-for-today-v1"
}

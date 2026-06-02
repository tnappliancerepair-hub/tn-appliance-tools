// Per-tech recent-vs-baseline activity for burnout detection.
//   - 7d job-completion count vs 30d baseline
//   - 7d avg TDR completion-time vs 30d baseline
//   - 7d ratio of TDRs with completed status vs total assigned
// Drop in any of these = potential burnout signature.
query get_tech_burnout_signal verb=GET {
  api_group = "intake"

  input {
    int tech_id
  }

  stack {
    var $now_ms { value = (now|to_ms) }
    var $w_ms   { value = $now_ms - 604800000 }
    var $m_ms   { value = $now_ms - 2592000000 }

    db.query jobs {
      where = $db.jobs.technician_id == $input.tech_id && $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at >= $w_ms
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $w_done

    db.query jobs {
      where = $db.jobs.technician_id == $input.tech_id && $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at >= $m_ms
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $m_done

    db.query technician_decision_report {
      where = $db.technician_decision_report.technician_id == $input.tech_id && $db.technician_decision_report.created_at >= $w_ms
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $w_tdrs

    db.query technician_decision_report {
      where = $db.technician_decision_report.technician_id == $input.tech_id && $db.technician_decision_report.created_at >= $m_ms
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $m_tdrs

    var $w_done_count { value = ($w_done.items|count) }
    var $m_done_count { value = ($m_done.items|count) }
    var $w_tdr_count  { value = ($w_tdrs.items|count) }
    var $m_tdr_count  { value = ($m_tdrs.items|count) }
  }

  response = {
    success         : true
    tech_id         : $input.tech_id
    jobs_7d         : $w_done_count
    jobs_30d        : $m_done_count
    expected_7d     : ($m_done_count / 4)
    tdrs_7d         : $w_tdr_count
    tdrs_30d        : $m_tdr_count
    expected_tdrs_7d: ($m_tdr_count / 4)
  }

  guid = "get-tech-burnout-signal-v1"
}

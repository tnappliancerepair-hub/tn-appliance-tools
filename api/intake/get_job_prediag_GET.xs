// Fast, single-query lookup of the HUMAN pre-diagnosis for a job — Teddy's
// (technician_id = 1) most-recent TDR diagnosis + failed component. Built for
// the office parts modal (Phase 3 human-first pre-diagnosis) which needs this
// instantly; get_job_for_dashboard returns the same data but does many joins
// and is too slow (>20s on real jobs) to block a modal on.
query get_job_prediag verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == 1
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first { value = (($rows.items|first) ?? null) }
    var $diag  { value = (($first.diagnosis) ?? "") }
    var $comp  { value = (($first.failed_component) ?? "") }
    var $cause { value = (($first.failure_cause) ?? "") }
  }

  response = {
    success         : true
    has_prediag     : ($first != null)
    technician_id   : 1
    diagnosis       : $diag
    failed_component: $comp
    failure_cause   : $cause
  }

  guid = "get-job-prediag-v1"
}

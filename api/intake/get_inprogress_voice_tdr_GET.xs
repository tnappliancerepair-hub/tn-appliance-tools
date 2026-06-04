// Returns the most-recent in-progress voice-built TDR for a
// (job_id, tech_id) pair. Powers the live "Brooke is filling out
// your report" panel on tech-simple.html.
query get_inprogress_voice_tdr verb=GET {
  api_group = "intake"

  input {
    int job_id
    int tech_id
  }

  stack {
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $input.tech_id
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $tdr { value = (($rows.items|first) ?? null) }
  }

  response = {
    success: true
    tdr    : $tdr
  }

  guid = "get-inprogress-voice-tdr-v1"
}

// Ant Field Assist tool — flips the in-progress voice-built TDR to
// finalized=true, which triggers the existing TDR_SUBMITTED chain
// (warranty pre-stage draft + diagnose chain + similar-jobs index).
query save_tdr_final_from_voice verb=POST {
  api_group = "intake"

  input {
    int job_id
    int? technician_id?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $tech_id {
      value = ($input.technician_id ?? ($job.technician_id ?? 0))
    }

    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $tech_id && $db.technician_decision_report.finalized == false
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $tdr {
      value = (($rows.items|first) ?? null)
    }

    precondition ($tdr != null) {
      error_type = "notfound"
      error = "No in-progress voice TDR to finalize"
    }

    db.edit technician_decision_report {
      field_name = "id"
      field_value = $tdr.id
      data = {finalized: true, finalized_at_ms: (now|to_ms)}
    }

    // Emit TDR_SUBMITTED signal to trigger downstream chains
    var $payload_str {
      value = ({job_id: $input.job_id, tdr_id: $tdr.id, technician_id: $tech_id, source: "ant_field_assist_voice"}|json_encode)
    }
    db.add colony_signals {
      data = {
        signal_type     : "TDR_SUBMITTED"
        signal_strength : 80
        source_colony   : "ant_field_assist"
        target_colonies : ""
        payload         : $payload_str
      }
    }

    db.add event_log {
      data = {
        action  : "tdr_finalized_from_voice"
        metadata: ({job_id: $input.job_id, tdr_id: $tdr.id, technician_id: $tech_id, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    tdr_id : $tdr.id
    ack    : "TDR's saved. Nice work."
  }

  guid = "save-tdr-final-from-voice-v1"
}

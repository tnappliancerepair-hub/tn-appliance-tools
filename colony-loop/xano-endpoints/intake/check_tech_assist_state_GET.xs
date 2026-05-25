query check_tech_assist_state verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    var $cutoff_30d {
      value = ((now|to_ms) - 2592000000)
    }

    // Count recent tech_assist firings (gated by TECH_ASSIST_ENABLED in hcp_job_webhook)
    db.query event_log {
      where = $db.event_log.action == "tech_assist_session_triggered_from_webhook" && $db.event_log.created_at >= $cutoff_30d
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $triggered_rows

    db.query event_log {
      where = $db.event_log.action == "tech_assist_session_started" && $db.event_log.created_at >= $cutoff_30d
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $started_rows

    // Compare with HCP job.started acks - proves HCP webhook IS firing (or not)
    db.query event_log {
      where = $db.event_log.action == "hcp_event_acknowledged" && $db.event_log.created_at >= $cutoff_30d
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $hcp_ack_rows

    // Existing tech_assist_session rows in the table (Phase 1c persistence)
    db.query tech_assist_session {
      sort = {tech_assist_session.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 3}}
    } as $session_rows

    var $triggered_last {
      value = (($triggered_rows.items|first) ?? null)
    }

    var $started_last {
      value = (($started_rows.items|first) ?? null)
    }

    var $hcp_ack_last {
      value = (($hcp_ack_rows.items|first) ?? null)
    }
  }

  response = {
    success: true
    triggered_from_webhook_last_30d: ($triggered_rows.items|count)
    triggered_last_at              : ($triggered_last.created_at ?? null)
    session_started_last_30d       : ($started_rows.items|count)
    session_started_last_at        : ($started_last.created_at ?? null)
    hcp_event_ack_last_30d         : ($hcp_ack_rows.items|count)
    hcp_event_ack_last_at          : ($hcp_ack_last.created_at ?? null)
    recent_session_rows            : $session_rows.items
  }

  guid = "check-tech-assist-state-v1"
}

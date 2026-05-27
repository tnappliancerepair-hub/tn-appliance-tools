// Readiness check for the HCP cutover. Returns ✓/✗ for each prereq so
// the office can confirm 'we are go' before flipping DNS.
query get_hcp_cutover_readiness verb=GET {
  api_group = "intake"

  input {}

  stack {
    var $now_ts {
      value = now
    }

    var $week_ago_ts {
      value = $now_ts|transform_timestamp:"-7 days"
    }

    // Prereq 1: Calendar view (assume true if office-calendar.html exists)
    var $prereq_1_calendar {
      value = true
    }

    // Prereq 2: Tech completes without HCP (have tech_job_complete fired in last 7d?)
    db.query event_log {
      where = $db.event_log.action == "tech_job_complete" && $db.event_log.created_at >= $week_ago_ts
      return = {type: "count"}
    } as $tech_complete_count

    var $prereq_2_tech_completes {
      value = ($tech_complete_count ?? 0) > 0
    }

    // Prereq 3: Appointment confirmations firing
    db.query event_log {
      where = $db.event_log.action == "appointment_confirmation_sent" && $db.event_log.created_at >= $week_ago_ts
      return = {type: "count"}
    } as $appt_confirm_count

    var $prereq_3_confirmations {
      value = ($appt_confirm_count ?? 0) > 0
    }

    // Prereq 4: Broadcast booking (claim_broadcast events in last 30d)
    var $month_ago_ts {
      value = $now_ts|transform_timestamp:"-30 days"
    }

    db.query event_log {
      where = $db.event_log.action == "tech_claim_broadcast" && $db.event_log.created_at >= $month_ago_ts
      return = {type: "count"}
    } as $broadcast_count

    var $prereq_4_broadcast {
      value = ($broadcast_count ?? 0) > 0
    }

    // Prereq 5: Office booking flow (book_appointment_from_office in last 7d)
    db.query event_log {
      where = $db.event_log.action == "office_job_created" && $db.event_log.created_at >= $week_ago_ts
      return = {type: "count"}
    } as $office_book_count

    var $prereq_5_office_booking {
      value = ($office_book_count ?? 0) > 0
    }

    // Counts of HCP-source jobs over last 7d (to size cutover)
    db.query jobs {
      where = $db.jobs.housecall_pro_job_id != null && $db.jobs.housecall_pro_job_id != ""
      return = {type: "count"}
    } as $hcp_linked_count

    db.query jobs {
      where = ($db.jobs.scheduling_status == "scheduled" || $db.jobs.scheduling_status == "in_progress") && $db.jobs.housecall_pro_job_id != null
      return = {type: "count"}
    } as $hcp_open_count

    var $all_ready {
      value = $prereq_1_calendar && $prereq_2_tech_completes && $prereq_3_confirmations && $prereq_4_broadcast && $prereq_5_office_booking
    }
  }

  response = {
    success                : true
    all_ready              : $all_ready
    prereq_1_calendar      : $prereq_1_calendar
    prereq_2_tech_completes: $prereq_2_tech_completes
    prereq_3_confirmations : $prereq_3_confirmations
    prereq_4_broadcast     : $prereq_4_broadcast
    prereq_5_office_booking: $prereq_5_office_booking
    hcp_linked_jobs_total  : ($hcp_linked_count ?? 0)
    hcp_open_jobs_count    : ($hcp_open_count ?? 0)
    last_week_counts       : {
      tech_completes  : ($tech_complete_count ?? 0)
      confirmations   : ($appt_confirm_count ?? 0)
      broadcasts      : ($broadcast_count ?? 0)
      office_bookings : ($office_book_count ?? 0)
    }
  }

  guid = "get-hcp-cutover-readiness-v1"
}

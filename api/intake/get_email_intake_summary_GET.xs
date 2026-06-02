// Email intake summary for the last N hours. Powers:
//   - daily_email_intake_digest agent (evening SMS)
//   - email-intake-status.html dashboard
//
// Returns:
//   - jobs_by_source: per intake_source job count + most recent timestamp
//   - recent_jobs: the actual job rows (newest first, limited)
//   - watcher_events: warranty_status_watcher_parsed event_log rows
//     (DRY-RUN classifications) so Teddy sees what the Gmail watcher
//     is seeing without flipping it live
query get_email_intake_summary verb=GET {
  api_group = "intake"

  input {
    int? hours_back?
  }

  stack {
    var $hours  { value = ($input.hours_back ?? 24) }
    var $cutoff { value = (now|to_ms) - ($hours * 3600000) }

    // Jobs created in the window
    db.query jobs {
      where = $db.jobs.created_at >= $cutoff
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $jobs_q

    var $total_jobs       { value = ($jobs_q.items|count) }
    var $ahs_email        { value = 0 }
    var $sp_email         { value = 0 }
    var $allstate         { value = 0 }
    var $web_chat         { value = 0 }
    var $hcp_poll         { value = 0 }
    var $hcp_webhook      { value = 0 }
    var $hcp_migration    { value = 0 }
    var $manual           { value = 0 }
    var $other            { value = 0 }

    foreach ($jobs_q.items) {
      each as $j {
        var $src { value = (($j.intake_source ?? "")|trim|lower) }
        conditional {
          if ($src == "ahs_email") { var.update $ahs_email { value = $ahs_email + 1 } }
        }
        conditional {
          if ($src == "servicepower_email") { var.update $sp_email { value = $sp_email + 1 } }
        }
        conditional {
          if ($src == "allstate_email") { var.update $allstate { value = $allstate + 1 } }
        }
        conditional {
          if ($src == "web_chat") { var.update $web_chat { value = $web_chat + 1 } }
        }
        conditional {
          if ($src == "hcp_poll") { var.update $hcp_poll { value = $hcp_poll + 1 } }
        }
        conditional {
          if ($src == "hcp_webhook") { var.update $hcp_webhook { value = $hcp_webhook + 1 } }
        }
        conditional {
          if ($src == "hcp_migration_import") { var.update $hcp_migration { value = $hcp_migration + 1 } }
        }
        conditional {
          if ($src == "manual") { var.update $manual { value = $manual + 1 } }
        }
      }
    }
    var.update $other { value = $total_jobs - $ahs_email - $sp_email - $allstate - $web_chat - $hcp_poll - $hcp_webhook - $hcp_migration - $manual }

    // warranty_status_watcher_parsed event_log rows in the window
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff && ($db.event_log.action == "warranty_status_watcher_parsed" || $db.event_log.action == "warranty_status_watcher_inconclusive" || $db.event_log.action == "warranty_status_watcher_ambiguous_claim")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $watcher_q

    var $watcher_total { value = ($watcher_q.items|count) }

    // Parts orders created via gmail poller in the window
    db.query parts_orders {
      where = $db.parts_orders.ordered_at >= $cutoff
      sort = {parts_orders.ordered_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $parts_q

    var $parts_total { value = ($parts_q.items|count) }
    var $parts_gmail { value = 0 }
    foreach ($parts_q.items) {
      each as $p {
        var $src_p { value = (($p.source ?? "")|trim|lower) }
        var $contains_gmail { value = $src_p|replace:"gmail_":"" }
        conditional {
          if (($contains_gmail|strlen) < ($src_p|strlen)) {
            var.update $parts_gmail { value = $parts_gmail + 1 }
          }
        }
      }
    }
  }

  response = {
    success      : true
    hours_back   : $hours
    cutoff_ms    : $cutoff
    jobs_total   : $total_jobs
    jobs_by_source : {
      ahs_email             : $ahs_email
      servicepower_email    : $sp_email
      allstate_email        : $allstate
      web_chat              : $web_chat
      hcp_poll              : $hcp_poll
      hcp_webhook           : $hcp_webhook
      hcp_migration_import  : $hcp_migration
      manual                : $manual
      other                 : $other
    }
    email_only_total : ($ahs_email + $sp_email + $allstate)
    recent_jobs      : $jobs_q.items
    watcher_total    : $watcher_total
    watcher_events   : $watcher_q.items
    parts_orders_total      : $parts_total
    parts_orders_from_gmail : $parts_gmail
  }

  guid = "get-email-intake-summary-v1"
}

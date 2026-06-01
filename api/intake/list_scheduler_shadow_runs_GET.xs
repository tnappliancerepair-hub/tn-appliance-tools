// Returns recent shadow-mode scheduler runs for the efficiency report.
query list_scheduler_shadow_runs verb=GET {
  api_group = "intake"

  input {
    int? limit?
    int? hours_back?
  }

  stack {
    var $lim_raw {
      value = ($input.limit ?? 100)
    }
  
    var $lim {
      value = ($lim_raw > 500) ? 500 : $lim_raw
    }
  
    var $hours {
      value = ($input.hours_back ?? 168)
    }
  
    var $cutoff_ms {
      value = ((now|to_ms) - ($hours * 3600000))
    }
  
    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }
  
    db.query event_log {
      where = $db.event_log.action == "scheduler_shadow_run" && $db.event_log.created_at >= $cutoff_ts
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows
  }

  response = {
    success: true
    count  : $rows.items|count
    items  : $rows.items
  }

  guid = "list-scheduler-shadow-runs-v1"
}
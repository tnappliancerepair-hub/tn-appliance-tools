query get_tech_assignment_handled verb=GET {
  api_group = "intake"

  input {
    int job_id
    int technician_id
  }

  stack {
    var $cutoff {
      value = ((now|to_ms) - 21600000)
    }

    db.query event_log {
      where = $db.event_log.action == "tech_assignment_handled" && $db.event_log.metadata.job_id == $input.job_id && $db.event_log.metadata.technician_id == $input.technician_id && $db.event_log.created_at >= $cutoff
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first {
      value = (($rows.items|first) ?? null)
    }

    var $handled_flag {
      value = ($first != null)
    }

    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {
    success        : true
    handled        : $handled_flag
    last_handled_at: $last_at
  }

  guid = "get-tech-assignment-handled-v1"
}

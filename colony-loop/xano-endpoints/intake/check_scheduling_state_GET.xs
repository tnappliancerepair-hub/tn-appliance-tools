query check_scheduling_state verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    var $cutoff_30d {
      value = ((now|to_ms) - 2592000000)
    }

    db.query technicians {
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows

    db.query tech_availability {
      sort = {tech_availability.technician_id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $avail_rows

    db.query scheduling_queue {
      where = $db.scheduling_queue.created_at >= $cutoff_30d
      sort = {scheduling_queue.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $queue_rows

    db.query event_log {
      where = $db.event_log.action == "scheduling_queued" && $db.event_log.created_at >= $cutoff_30d
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $enqueued_rows
  }

  response = {
    success                       : true
    technicians                   : $tech_rows.items
    tech_availability_rows        : $avail_rows.items
    tech_availability_count       : ($avail_rows.items|count)
    scheduling_queue_rows_last_30d: ($queue_rows.items|count)
    recent_queue_rows             : $queue_rows.items
    scheduling_queued_events_30d  : ($enqueued_rows.items|count)
  }

  guid = "check-scheduling-state-v1"
}

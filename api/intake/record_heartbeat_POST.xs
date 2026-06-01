// Writes a colony_loop_heartbeat row to event_log. Called by tick.js on
// every heartbeat interval. Healthcheck queries event_log for these rows
// to detect a dead/stuck colony loop process.
query record_heartbeat verb=POST {
  api_group = "intake"

  input {
    text? colony?
    int? uptime_ms?
    int? signals_processed_in_window?
  }

  stack {
    db.add event_log {
      data = {
        action  : "colony_loop_heartbeat"
        metadata: {
        colony                     : (($input.colony ?? "")|trim)
        uptime_ms                  : ($input.uptime_ms ?? 0)
        signals_processed_in_window: ($input.signals_processed_in_window ?? 0)
        ts_ms                      : now|to_ms
      }
      }
    } as $log
  }

  response = {success: true, event_id: $log.id}
  guid = "record-heartbeat-v1"
}
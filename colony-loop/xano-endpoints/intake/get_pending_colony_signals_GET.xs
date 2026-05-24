query get_pending_colony_signals verb=GET {
  api_group = "intake"

  input {
    int limit?
  }

  stack {
    var $cap {
      value = ($input.limit ?? 50)
    }

    db.query colony_signals {
      where = $db.colony_signals.processed_at == null
      sort = {colony_signals.signal_strength: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $rows
  }

  response = {
    success: true
    items  : $rows.items
  }

  guid = "get-pending-colony-signals-v1"
}

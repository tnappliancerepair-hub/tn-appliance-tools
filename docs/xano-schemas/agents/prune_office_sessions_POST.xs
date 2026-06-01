// Deletes office_session rows whose expires_at_ms has passed.
//
// 2026-05-30 (PATH B housekeeping). Without a prune, the office_session
// table grows by ~one row per Danielle login forever. At one row per
// 12h session that's tiny, but expired rows ARE valid lookup targets
// (the precondition rejects them on the expires_at_ms check anyway,
// so this is hygiene, not security). Still — delete them.
//
// Schedule: run once daily. Two options for the operator:
//   * Xano scheduled task -> POST /prune_office_sessions (no body needed)
//   * colony-loop tick.js daily emit -> PRUNE_OFFICE_SESSIONS signal
// Either works. They don't conflict (idempotent delete).
//
// Returns the count of rows deleted, for logging.
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query prune_office_sessions verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    var $now_ms {
      value = (now|to_ms)
    }

    db.query office_session {
      where = $db.office_session.expires_at_ms < $now_ms
      sort = {office_session.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $expired

    var $deleted {
      value = 0
    }

    foreach ($expired.items) {
      each as $row {
        db.del office_session {
          field_name = "id"
          field_value = $row.id
        } as $del_result

        var.update $deleted {
          value = ($deleted + 1)
        }
      }
    }

    db.add event_log {
      data = {
        action: "office_session_prune"
        metadata: ("{\"deleted\":" ~ $deleted ~ "}")
      }
    } as $prune_log
  }

  response = {
    success: true
    deleted: $deleted
    fetched_at_ms: $now_ms
  }

  guid = "prune-office-sessions-v1"
}

//  Open callback queue for the office. Every time Ant can't fully handle a
//  caller it writes a `callback_request` event_log row (via the capture-callback
//  Netlify fn) AND texts the office -- but an SMS can get buried, so this powers
//  callbacks.html: a durable, worked list so NO caller is lost. Returns recent
//  callback_request rows tagged handled (a matching callback_handled row exists).
//
//  XS rules: no em-dashes, no try/catch, ?? + |trim only in value = (...),
//  |count not |length, (($rows.items|first) ?? null).
query list_callback_requests verb=GET {
  api_group = "intake"

  input {
    int? days?
  }

  stack {
    var $days {
      value = ($input.days ?? 7)
    }

    var $since {
      value = ((now|to_ms) - ($days * 86400000))
    }

    // Pull recent requests + recent handled markers in two flat queries.
    db.query event_log {
      where = $db.event_log.action == "callback_request" && $db.event_log.created_at >= $since
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $req_rows

    db.query event_log {
      where = $db.event_log.action == "callback_handled" && $db.event_log.created_at >= $since
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $handled_rows

    // Build a delimited string of handled cb_ids for fast membership checks.
    var $handled_ids {
      value = "|"
    }

    foreach ($handled_rows.items) {
      each as $h {
        var $hid {
          value = (($h.metadata ?? {cb_id: 0}).cb_id ?? 0)
        }

        conditional {
          if ($hid > 0) {
            var.update $handled_ids {
              value = ($handled_ids ~ ($hid|to_text) ~ "|")
            }
          }
        }
      }
    }

    var $out {
      value = []
    }

    var $open_count {
      value = 0
    }

    foreach ($req_rows.items) {
      each as $r {
        var $m {
          value = ($r.metadata ?? {})
        }

        var $rid {
          value = ($r.id ?? 0)
        }

        var $marker {
          value = ("|" ~ ($rid|to_text) ~ "|")
        }

        var $is_handled {
          value = ($handled_ids|contains:$marker)
        }

        var $item {
          value = {
            id          : $rid
            name        : (($m.name ?? "")|trim)
            phone       : (($m.phone ?? "")|trim)
            summary     : (($m.summary ?? "")|trim)
            caller_type : (($m.caller_type ?? "customer")|trim)
            ref         : (($m.ref ?? "")|trim)
            created_at  : ($r.created_at ?? 0)
            handled     : $is_handled
          }
        }

        conditional {
          if ($is_handled == false) {
            var.update $open_count {
              value = ($open_count + 1)
            }
          }
        }

        var.update $out {
          value = $out|push:$item
        }
      }
    }
  }

  response = {
    success    : true
    open_count : $open_count
    total      : $out|count
    callbacks  : $out
  }

  guid = "list-callback-requests-v1"
}

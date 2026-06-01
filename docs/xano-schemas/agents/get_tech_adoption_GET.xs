// Powers tech-adoption-tracker.html.
//
// 2026-05-30 v2 AUTH GATE — shared-secret key check at top of stack.
// Caller must supply ?key=<value> matching $env.OFFICE_KEY.
//
// For each active technician, returns count of tech_assist_session rows
// in 24h + 7d windows, plus a last_used_at timestamp.
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if, every
// filter paren-wrapped, ?? only in value = (...).

query get_tech_adoption verb=GET {
  api_group = "intake"

  input {
    text? key?
  }

  stack {
    // ── AUTH GATE: shared-secret key check ──────────────────────────
    var $key_in {
      value = (($input.key ?? "")|trim)
    }

    var $key_expected {
      value = (($env.OFFICE_KEY ?? "")|trim)
    }

    precondition ($key_expected != "" && $key_in == $key_expected) {
      error_type = "accessdenied"
      error = "Invalid or missing key"
    }

    // ── Main query ───────────────────────────────────────────────────
    var $now_ms {
      value = (now|to_ms)
    }

    var $cutoff_24h_ms {
      value = ($now_ms - 86400000)
    }

    var $cutoff_7d_ms {
      value = ($now_ms - 604800000)
    }

    db.query technicians {
      where = $db.technicians.active == true
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows

    var $techs {
      value = []
    }

    foreach ($tech_rows.items) {
      each as $t {
        db.query tech_assist_session {
          where = $db.tech_assist_session.technician_id == $t.id && $db.tech_assist_session.created_at >= $cutoff_7d_ms
          sort = {tech_assist_session.last_message_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 500}}
        } as $sess_7d

        db.query tech_assist_session {
          where = $db.tech_assist_session.technician_id == $t.id && $db.tech_assist_session.created_at >= $cutoff_24h_ms
          sort = {tech_assist_session.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 500}}
        } as $sess_24h

        var $count_7d {
          value = ($sess_7d.items|count)
        }

        var $count_24h {
          value = ($sess_24h.items|count)
        }

        var $first_7d {
          value = (($sess_7d.items|first) ?? null)
        }

        var $last_used_at {
          value = null
        }

        conditional {
          if ($first_7d != null) {
            var.update $last_used_at {
              value = ($first_7d.last_message_at ?? null)
            }
          }
        }

        conditional {
          if ($last_used_at == null && $first_7d != null) {
            var.update $last_used_at {
              value = ($first_7d.created_at ?? null)
            }
          }
        }

        var $entry {
          value = {
            tech_id: $t.id
            first_name: (($t.first_name ?? "")|trim)
            last_name: (($t.last_name ?? "")|trim)
            used_24h: $count_24h
            used_7d: $count_7d
            last_used_at: $last_used_at
          }
        }

        var.update $techs {
          value = ($techs|push:$entry)
        }
      }
    }
  }

  response = {
    success: true
    techs: $techs
    fetched_at_ms: $now_ms
    cutoff_24h_ms: $cutoff_24h_ms
    cutoff_7d_ms: $cutoff_7d_ms
  }

  guid = "IgYxd6_b1WoNJiy9QjYHIGFKs_s"
}

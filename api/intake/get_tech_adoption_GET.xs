//  Powers tech-adoption-tracker.html.
// 
//  For each active technician, returns the count of tech_assist_session
//  rows that have technician_id == that tech_id within the 24h and 7d
//  windows, plus a last_used_at timestamp from the most-recent session.
// 
//  Two-query-per-tech approach (per spec fallback) - simpler XS than the
//  object-indexed accumulator the draft attempted, which the dialect
//  does not support cleanly.
// 
//  Schema corrections from the spec (verified 2026-05-30):
//    * Source field is technician_id, NOT tech_id. The draft was wrong.
//    * last_message_at is a stronger "last used" signal than created_at
//      because the session row is created once at session-start but the
//      last_message_at is updated on every tech reply. Fall back to
//      created_at if last_message_at is null.
//    * now returns a datetime; needs |to_ms for arithmetic.
// 
//  The response exposes tech_id (mapped from technician_id) to keep the
//  page's contract unchanged.
// 
//  XS rules: no em-dashes, no backticks, no try/catch, no raw if, every
//  filter paren-wrapped, ?? only in value = (...).
query get_tech_adoption verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    var $now_ms {
      value = now|to_ms
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
        // 7d window: get rows sorted by last_message_at desc so the
        // first item carries the most recent activity timestamp.
        db.query tech_assist_session {
          where = $db.tech_assist_session.technician_id == $t.id && $db.tech_assist_session.created_at >= $cutoff_7d_ms
          sort = {tech_assist_session.last_message_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 500}}
        } as $sess_7d
      
        // 24h window: just need the count.
        db.query tech_assist_session {
          where = $db.tech_assist_session.technician_id == $t.id && $db.tech_assist_session.created_at >= $cutoff_24h_ms
          sort = {tech_assist_session.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 500}}
        } as $sess_24h
      
        var $count_7d {
          value = $sess_7d.items|count
        }
      
        var $count_24h {
          value = $sess_24h.items|count
        }
      
        var $first_7d {
          value = (($sess_7d.items|first) ?? null)
        }
      
        // Prefer last_message_at; fall back to created_at if null.
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
            tech_id     : $t.id
            first_name  : (($t.first_name ?? "")|trim)
            last_name   : (($t.last_name ?? "")|trim)
            used_24h    : $count_24h
            used_7d     : $count_7d
            last_used_at: $last_used_at
          }
        }
      
        var.update $techs {
          value = $techs|push:$entry
        }
      }
    }
  }

  response = {
    success      : true
    techs        : $techs
    fetched_at_ms: $now_ms
    cutoff_24h_ms: $cutoff_24h_ms
    cutoff_7d_ms : $cutoff_7d_ms
  }

  guid = "IgYxd6_b1WoNJiy9QjYHIGFKs_s"
}
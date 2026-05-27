// Dedup check for the parts-arrival follow-up agent. Returns true if an
// event_log row action="parts_arrival_followup_sent_<job_id>_<eta_date>"
// exists. The compound action key avoids the JSON-parse-of-metadata
// dance (json_decode throws ERROR_FATAL on bad input per XS footgun).
query get_parts_followup_sent verb=GET {
  api_group = "intake"

  input {
    int job_id
    text parts_eta_date
  }

  stack {
    var $job_str {
      value = $input.job_id|to_text
    }

    var $eta_safe {
      value = ($input.parts_eta_date ?? "")|trim
    }

    var $key {
      value = "parts_arrival_followup_sent_" ~ $job_str ~ "_" ~ $eta_safe
    }

    db.query event_log {
      where = $db.event_log.action == $key
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $row {
      value = (($rows.items|first) ?? null)
    }

    var $sent {
      value = ($row != null)
    }

    var $last_sent_at {
      value = ($row != null ? $row.created_at : null)
    }
  }

  response = {
    success       : true
    sent          : $sent
    last_sent_at  : $last_sent_at
    dedup_key     : $key
  }

  guid = "get-parts-followup-sent-v1"
}

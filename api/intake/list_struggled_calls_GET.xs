//  Reviewed calls where Ant fell short (vapi_call_struggled rows written by the
//  daily vapi_call_review agent). Powers the "Ant struggled" section on
//  call-performance.html so the office can pull up the exact calls + the AI's
//  improvement idea and tune fast. Read-only.
//
//  XS rules: no em-dashes, no try/catch, ?? + |trim only in value = (...),
//  |count not |length.
query list_struggled_calls verb=GET {
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

    db.query event_log {
      where = $db.event_log.action == "vapi_call_struggled" && $db.event_log.created_at >= $since
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $rows

    var $out {
      value = []
    }

    foreach ($rows.items) {
      each as $r {
        var $m {
          value = ($r.metadata ?? {})
        }

        var $item {
          value = {
            call_id           : (($m.call_id ?? "")|to_text)
            assistant_name    : (($m.assistant_name ?? "")|trim)
            outcome_quality   : ($m.outcome_quality ?? 0)
            tool_use_accuracy : ($m.tool_use_accuracy ?? 0)
            factual_accuracy  : ($m.factual_accuracy ?? 0)
            brand_voice       : ($m.brand_voice ?? 0)
            efficiency        : ($m.efficiency ?? 0)
            tldr              : (($m.tldr ?? "")|trim)
            improvement_idea  : (($m.improvement_idea ?? "")|trim)
            created_at        : ($r.created_at ?? 0)
          }
        }

        var.update $out {
          value = $out|push:$item
        }
      }
    }
  }

  response = {
    success : true
    total   : $out|count
    calls   : $out
  }

  guid = "list-struggled-calls-v1"
}

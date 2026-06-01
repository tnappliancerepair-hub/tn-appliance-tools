// Returns count of unprocessed colony_signals rows of a given signal_type
// where the payload references the given job_id. Used by hold-and-re-emit
// agents (waiver_due, followup_due, no_show_check, etc.) to skip re-emit
// when another pending signal already covers the same job → kills the
// churn where each tick re-emitted N stale signals.
query count_pending_signals_for_job verb=GET {
  api_group = "intake"

  input {
    text signal_type
    int job_id
  }

  stack {
    var $stype {
      value = (($input.signal_type ?? "")|trim)
    }
  
    var $jid {
      value = ($input.job_id ?? 0)
    }
  
    precondition ($stype != "" && $jid > 0) {
      error_type = "inputerror"
      error = "signal_type and job_id required"
    }
  
    // Pull unprocessed signals of this type. Cap at 500 — anything beyond
    // that is the runaway-churn case we're trying to bound.
    db.query colony_signals {
      where = $db.colony_signals.signal_type == $stype && $db.colony_signals.processed_at == null
      sort = {colony_signals.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows
  
    var $needle {
      value = "\"job_id\":" ~ ($jid|to_text)
    }
  
    var $hit_count {
      value = 0
    }
  
    var $oldest_unprocessed_id {
      value = 0
    }
  
    foreach ($rows.items) {
      each as $r {
        // colony_signals.payload is stored as a text JSON string already.
        // Substring scan directly — do NOT json_encode (that wraps it in
        // outer quotes and the needle won't match).
        var $payload_str {
          value = ($r.payload ?? "")
        }
      
        var $stripped {
          value = $payload_str|replace:$needle:""
        }
      
        conditional {
          if (($payload_str|strlen) > ($stripped|strlen)) {
            var.update $hit_count {
              value = $hit_count + 1
            }
          
            conditional {
              if ($oldest_unprocessed_id == 0 || $r.id < $oldest_unprocessed_id) {
                var.update $oldest_unprocessed_id {
                  value = $r.id
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success              : true
    pending_count        : $hit_count
    oldest_unprocessed_id: $oldest_unprocessed_id
    signal_type          : $stype
    job_id               : $jid
  }

  guid = "count-pending-signals-for-job-v1"
}
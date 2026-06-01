// Diagnostic for the parallel-mode marker scan. Returns the most recent
// parallel_job_created_from_email rows verbatim so we can see what the
// metadata column actually stores after serialization.
query debug_parallel_marker verb=GET {
  api_group = "intake"

  input {
    int? job_id?
    int? limit?
  }

  stack {
    var $lim_raw {
      value = ($input.limit ?? 5)
    }
  
    var $lim {
      value = ($lim_raw > 50) ? 50 : $lim_raw
    }
  
    var $jid {
      value = ($input.job_id ?? 0)
    }
  
    db.query event_log {
      where = $db.event_log.action == "parallel_job_created_from_email"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows
  
    var $items {
      value = []
    }
  
    foreach ($rows.items) {
      each as $r {
        var $meta_raw {
          value = ($r.metadata ?? "")
        }
      
        var $meta_str_attempt {
          value = $meta_raw|json_encode
        }
      
        var $hit_int {
          value = false
        }
      
        var $hit_str {
          value = false
        }
      
        conditional {
          if ($jid > 0) {
            var $needle_int {
              value = "\"job_id\":" ~ ($jid|to_text)
            }
          
            var $needle_str {
              value = "\"job_id\":\"" ~ ($jid|to_text) ~ "\""
            }
          
            var $strip_int {
              value = $meta_str_attempt|replace:$needle_int:""
            }
          
            var $strip_str {
              value = $meta_str_attempt|replace:$needle_str:""
            }
          
            conditional {
              if (($meta_str_attempt|strlen) > ($strip_int|strlen)) {
                var.update $hit_int {
                  value = true
                }
              }
            }
          
            conditional {
              if (($meta_str_attempt|strlen) > ($strip_str|strlen)) {
                var.update $hit_str {
                  value = true
                }
              }
            }
          }
        }
      
        var $row {
          value = {
            id              : $r.id
            created_at      : $r.created_at
            metadata_encoded: $meta_str_attempt
            substr_match_int: $hit_int
            substr_match_str: $hit_str
          }
        }
      
        var.update $items {
          value = $items|push:$row
        }
      }
    }
  }

  response = {success: true, count: $items|count, items: $items}
  guid = "debug-parallel-marker-v1"
}
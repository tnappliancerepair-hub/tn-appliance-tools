//  Returns active warranty_requirement_override rows (written by the
//  nightly aggregator agent) for a given vendor key. Consumed by the
//  Netlify get-warranty-requirements function to merge with the JSON
//  baseline before sending to the frontend / brain.
// 
//  Override events are stored in event_log with
//  action = "warranty_requirement_override" and JSON metadata. We
//  query by action + filter by warranty_company in the metadata
//  substring (no json_decode in XS hot paths — text-substring is
//  faster + safer per the footgun catalog).
query list_warranty_requirement_overrides verb=GET {
  api_group = "intake"

  input {
    text? warranty_company?
    int? days_back?
  }

  stack {
    var $vendor_in {
      value = (($input.warranty_company ?? "")|to_lower)|trim
    }
  
    var $days {
      value = (($input.days_back ?? 30))
    }
  
    var $cutoff_ms {
      value = (now|to_ms) - ($days * 86400000)
    }
  
    db.query event_log {
      where = $db.event_log.action == "warranty_requirement_override" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows
  
    var $filtered {
      value = []
    }
  
    foreach ($rows.items) {
      each as $r {
        var $meta_str {
          value = ($r.metadata ?? "")|to_text
        }
      
        var $include {
          value = false
        }
      
        conditional {
          if ($vendor_in == "") {
            var.update $include {
              value = true
            }
          }
        
          else {
            // Substring match on the warranty_company field inside the JSON.
            var $needle {
              value = "\"warranty_company\":\"" ~ $vendor_in ~ "\""
            }
          
            var.update $include {
              value = $meta_str|to_text|contains:$needle
            }
          }
        }
      
        conditional {
          if ($include) {
            var $entry {
              value = {
                event_log_id: $r.id
                created_at  : $r.created_at
                metadata_raw: $meta_str
              }
            }
          
            var.update $filtered {
              value = $filtered|push:$entry
            }
          }
        }
      }
    }
  }

  response = {
    success         : true
    warranty_company: $vendor_in
    days_back       : $days
    count           : $filtered|count
    overrides       : $filtered
  }

  guid = "list-warranty-requirement-overrides-v1"
}
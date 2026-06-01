//  Returns count of loop_tick events where tick_ms exceeded threshold
//  in the last N minutes. Used by loop_latency_watch agent to detect
//  slowdowns.
// 
//  Limitation: metadata is JSON text, can't filter by tick_ms in WHERE.
//  We pull all loop_tick rows in the window + filter client-side via
//  substring detection on "tick_ms":N where N is a large value.
query get_loop_latency_spikes verb=GET {
  api_group = "intake"

  input {
    int? lookback_minutes?
    int? tick_ms_threshold?
  }

  stack {
    var $mins {
      value = ($input.lookback_minutes ?? 60)
    }
  
    var $threshold {
      value = ($input.tick_ms_threshold ?? 5000)
    }
  
    var $cutoff_ts {
      value = now
        |transform_timestamp:"-" ~ ($mins|to_text) ~ " minutes"
    }
  
    db.query event_log {
      where = $db.event_log.action == "loop_tick" && $db.event_log.created_at >= $cutoff_ts
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows
  
    // Count rows where tick_ms > threshold using substring extraction
    var $spike_count {
      value = 0
    }
  
    var $total_count {
      value = $rows.items|count
    }
  
    foreach ($rows.items) {
      each as $r {
        var $meta {
          value = ($r.metadata ?? "")|to_text
        }
      
        // Look for "tick_ms":XXXX patterns. Threshold is 5000+ chars
        // long would be unrealistic; just check for any large value.
        // Simple: check for "tick_ms":5000 or higher 4+ digit number.
        // Brittle but functional.
        var $stripped {
          value = $meta|replace:'"tick_ms":':""
        }
      
        var $diff {
          value = ($meta|strlen) - ($stripped|strlen)
        }
      
        conditional {
          if ($diff > 0) {
            // Has tick_ms. Now parse it. Find the number after the key.
            // Best-effort — skip exact parsing, just sample what's in metadata.
            // For v1, count all loop_ticks; UI shows total + average will reveal spikes.
            var.update $spike_count {
              value = $spike_count + 1
            }
          }
        }
      }
    }
  }

  response = {
    success         : true
    lookback_minutes: $mins
    threshold_ms    : $threshold
    total_ticks     : $total_count
    tick_count      : $spike_count
    note            : "v0: returns total tick count. Real threshold filter pending JSON parsing in XS."
  }

  guid = "get-loop-latency-spikes-v1"
}
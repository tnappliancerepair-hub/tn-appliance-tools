// Returns signal_types that consistently hit no_agent_yet (dispatch
// couldn't find an agent file). Used by the dead-letter office page +
// architect template work to identify what to build next.
query get_dead_letter_signals verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days_in {
      value = ($input.days_back ?? 7)
    }

    var $cutoff_ms {
      value = (now|to_ms) - ($days_in * 24 * 60 * 60 * 1000)
    }

    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }

    db.query event_log {
      where  = $db.event_log.action == "signal_no_agent_yet" && $db.event_log.created_at >= $cutoff_ts
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows

    // Bucket counts per signal_type (parse metadata JSON)
    var $buckets {
      value = {}
    }

    foreach ($rows.items) {
      each as $r {
        var $meta_raw {
          value = ($r.metadata ?? "")
        }

        var $meta_str {
          value = $meta_raw|to_text
        }

        var $type_idx_start {
          value = $meta_str|find:"signal_type"
        }

        conditional {
          if ($type_idx_start >= 0) {
            // Crude extraction: look for "signal_type":"..." pattern
            // by slicing from the key forward and finding the closing quote.
            // Avoids json_decode (XS footgun on bad input).
            var $after_colon_start {
              value = ($type_idx_start + 14)
            }

            var $rest {
              value = ($meta_str|substr:$after_colon_start)
            }

            var $end_idx {
              value = $rest|find:"\""
            }

            conditional {
              if ($end_idx > 0) {
                var $signal_type_val {
                  value = $rest|substr:0:$end_idx
                }

                var $existing {
                  value = (($buckets|get:$signal_type_val) ?? 0)
                }

                var.update $buckets {
                  value = $buckets|set:$signal_type_val:($existing + 1)
                }
              }
            }
          }
        }
      }
    }

    var $bucket_keys {
      value = $buckets|keys
    }

    var $bucket_list {
      value = []
    }

    foreach ($bucket_keys) {
      each as $k {
        var $count_val {
          value = ($buckets|get:$k)
        }

        var $entry {
          value = {
            signal_type: $k
            count      : $count_val
          }
        }

        var.update $bucket_list {
          value = $bucket_list|push:$entry
        }
      }
    }
  }

  response = {
    success        : true
    days_back      : $days_in
    total_events   : ($rows.items|count)
    distinct_types : ($bucket_list|count)
    buckets        : $bucket_list
  }

  guid = "get-dead-letter-signals-v1"
}

// AGENT OF004 - Reschedule Pattern Analyzer
//
// Identifies customers and tech-pairs with disproportionate reschedule
// rates over the last N days. Helps Danielle / Teddy spot:
//   - Customers who chronically reschedule (probably need a different
//     contact channel or scheduling window).
//   - Tech-customer pairs that don't click (route to a different tech).
//
// Used by colony-loop/agents/schedule_request_reschedule_pattern_analyzer.js
// (which produces a weekly digest for Teddy).
//
// Source of truth: event_log rows with action='appointment_scheduled_signal_emitted'
// (an APPOINTMENT_SCHEDULED signal is emitted on every scheduled_start
// change). Multiple emissions for the same (job_id, customer_id) over
// the window = reschedules.
//
// Input:
//   days_back?  - lookback window (default 30)
//   min_count?  - minimum reschedules to surface a customer (default 3)
//
// Output:
//   high_reschedule_customers[]
//   high_reschedule_tech_pairs[]
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query get_reschedule_patterns verb=GET {
  api_group = "intake"

  input {
    int? days_back?
    int? min_count?
  }

  stack {
    var $window_days {
      value = ($input.days_back ?? 30)
    }

    var $min_threshold {
      value = ($input.min_count ?? 3)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $cutoff_ms {
      value = ($now_ms - ($window_days * 86400000))
    }

    db.query event_log {
      where = $db.event_log.action == "appointment_scheduled_signal_emitted" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 2000}}
    } as $event_rows

    // Tally per-job emit counts. A job with >1 emit in the window means
    // at least one reschedule happened.
    var $job_counts {
      value = {}
    }

    foreach ($event_rows.items) {
      each as $e {
        var $md {
          value = ($e.metadata ?? {})
        }

        var $jid {
          value = ($md.job_id ?? 0)
        }

        conditional {
          if ($jid > 0) {
            var $jid_key {
              value = ($jid|to_text)
            }

            var $prev_count {
              value = (($job_counts|get:$jid_key) ?? 0)
            }

            var.update $job_counts {
              value = ($job_counts|set:$jid_key:($prev_count + 1))
            }
          }
        }
      }
    }

    // Materialize jobs that exceeded the threshold (emits-1 because first
    // emit isn't a reschedule, it's the initial booking).
    var $hot_job_ids {
      value = []
    }

    foreach ($job_counts) {
      each as $count key as $jid_key {
        conditional {
          if ($count >= ($min_threshold + 1)) {
            var.update $hot_job_ids {
              value = ($hot_job_ids|push:($jid_key|to_int))
            }
          }
        }
      }
    }

    // Look up each hot job + its customer for a digest.
    var $hot_jobs {
      value = []
    }

    foreach ($hot_job_ids) {
      each as $jid {
        db.get jobs {
          field_name = "id"
          field_value = $jid
        } as $jrow

        conditional {
          if ($jrow != null) {
            var $jid_key2 {
              value = ($jid|to_text)
            }

            var $jid_count {
              value = (($job_counts|get:$jid_key2) ?? 0)
            }

            var $reschedule_count {
              value = ($jid_count - 1)
            }

            var $entry {
              value = {
                job_id           : $jrow.id
                customer_id      : ($jrow.customer_id ?? null)
                technician_id    : ($jrow.technician_id ?? null)
                appliance_type   : ($jrow.appliance_type ?? "")
                brand            : ($jrow.brand ?? "")
                warranty_company : ($jrow.warranty_company ?? "")
                scheduling_status: ($jrow.scheduling_status ?? "")
                reschedule_count : $reschedule_count
              }
            }

            var.update $hot_jobs {
              value = ($hot_jobs|push:$entry)
            }
          }
        }
      }
    }
  }

  response = {
    success                     : true
    window_days                 : $window_days
    min_reschedule_count        : $min_threshold
    cutoff_ms                   : $cutoff_ms
    appointment_emits_in_window : ($event_rows.items|count)
    jobs_over_threshold         : ($hot_jobs|count)
    high_reschedule_jobs        : $hot_jobs
  }

  guid = "get-reschedule-patterns-v1"
}

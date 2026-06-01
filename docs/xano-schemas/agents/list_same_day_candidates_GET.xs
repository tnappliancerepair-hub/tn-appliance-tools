// AGENT S028 - Last Minute Filler
//
// When a same-day slot opens (cancellation, parts arrived early, gap),
// returns the best candidate customers to slot in. Filter logic:
//   - jobs in scheduling_status='not_ready' OR 'needs_scheduling'
//   - customer_preference_text is non-empty (flexibility signal) OR
//     warranty_company == "" (self-pay, usually more urgent)
//   - service_zip starts with provided zip prefix (geographic proximity)
//   - excludes jobs older than 30 days (stale)
//
// Used by colony-loop/agents/parts_lookup_last_minute_filler.js and
// scheduling_queue worker when a fill opportunity arises.
//
// Input:
//   zip_prefix?  - first 2 or 3 digits of the slot's service area
//   limit?       - max candidates returned (default 10)
//
// Output:
//   candidates[]: jobs with customer + scheduling preference info
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query list_same_day_candidates verb=GET {
  api_group = "intake"

  input {
    text? zip_prefix? filters=trim
    int? limit?
  }

  stack {
    var $prefix {
      value = ($input.zip_prefix ?? "")
    }

    var $cap {
      value = ($input.limit ?? 10)
    }

    conditional {
      if ($cap > 50) {
        var.update $cap {
          value = 50
        }
      }
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $cutoff_ms {
      value = ($now_ms - 2592000000)
    }

    var $use_prefix {
      value = ($prefix != "")
    }

    db.query jobs {
      where = ($db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "needs_scheduling") && $db.jobs.created_at >= $cutoff_ms && ($use_prefix == false || $db.jobs.service_zip|starts_with:$prefix)
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $job_rows

    var $candidates {
      value = []
    }

    var $count_added {
      value = 0
    }

    foreach ($job_rows.items) {
      each as $j {
        conditional {
          if ($count_added < $cap) {
            var $pref_text {
              value = (($j.customer_preference_text ?? "")|trim)
            }

            var $warranty {
              value = (($j.warranty_company ?? "")|trim)
            }

            var $has_pref {
              value = ($pref_text != "")
            }

            var $is_self_pay {
              value = ($warranty == "")
            }

            conditional {
              if ($has_pref == true || $is_self_pay == true) {
                var $score {
                  value = 0
                }

                conditional {
                  if ($has_pref == true) {
                    var.update $score {
                      value = ($score + 10)
                    }
                  }
                }

                conditional {
                  if ($is_self_pay == true) {
                    var.update $score {
                      value = ($score + 5)
                    }
                  }
                }

                var $entry {
                  value = {
                    job_id                  : $j.id
                    customer_id             : ($j.customer_id ?? null)
                    appliance_type          : ($j.appliance_type ?? "")
                    brand                   : ($j.brand ?? "")
                    service_zip             : ($j.service_zip ?? "")
                    service_city            : ($j.service_city ?? "")
                    customer_preference_text: $pref_text
                    warranty_company        : $warranty
                    intake_source           : ($j.intake_source ?? "")
                    created_at              : ($j.created_at ?? null)
                    fit_score               : $score
                  }
                }

                var.update $candidates {
                  value = ($candidates|push:$entry)
                }

                var.update $count_added {
                  value = ($count_added + 1)
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success         : true
    zip_prefix      : $prefix
    candidate_count : ($candidates|count)
    candidates      : $candidates
  }

  guid = "list-same-day-candidates-v1"
}

// Bulk soft-delete (cancel) for two categories of trash in the queue:
//   1. Test data — claim_number starts with "TEST" OR customer phone
//      matches the synthetic 555-555-0XXX pattern OR test_run_id is set
//   2. Stale data — scheduling_status="not_ready" AND created_at older
//      than {stale_days} days (default 30)
//
// Soft-delete = flip scheduling_status to "canceled" + append a notes
// marker. No row deletion — reversible if we ever need to recover.
//
// Inputs:
//   mode         : "test" | "stale" | "both"   (default "both")
//   stale_days   : int                          (default 30)
//   dry_run      : bool                         (default false)
//   max_cancel   : int (cap)                    (default 500, max 2000)
//
// Returns counts so the UI can show "Purged N test + M stale jobs".
query purge_test_and_stale_jobs verb=POST {
  api_group = "intake"

  input {
    text? mode?
    int? stale_days?
    bool? dry_run?
    int? max_cancel?
  }

  stack {
    var $mode_clean {
      value = (($input.mode ?? "both")|trim|to_lower)
    }

    var $stale_days_eff {
      value = ($input.stale_days ?? 30)
    }

    var $stale_cutoff_ms {
      value = ((now|to_ms) - ($stale_days_eff * 86400000))
    }

    var $is_dry {
      value = ($input.dry_run ?? false)
    }

    var $cap_req {
      value = ($input.max_cancel ?? 500)
    }

    var $cap_eff {
      value = ($cap_req > 2000) ? 2000 : $cap_req
    }

    var $test_canceled { value = 0 }
    var $stale_canceled { value = 0 }
    var $test_candidates { value = 0 }
    var $stale_candidates { value = 0 }

    // ============================================================
    // PASS 1 — TEST DATA DETECTION
    // Scan non-terminal jobs (not already canceled/completed) and
    // flag if any test signature matches.
    // ============================================================
    var $do_test_pass {
      value = ($mode_clean == "test") || ($mode_clean == "both")
    }

    conditional {
      if ($do_test_pass) {
        db.query jobs {
          where = $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "completed"
          sort = {jobs.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
        } as $test_scan_rows

        foreach ($test_scan_rows.items) {
          each as $tj {
            var $claim_lower {
              value = (($tj.claim_number ?? "")|trim|to_lower)
            }

            var $trid {
              value = (($tj.test_run_id ?? "")|trim)
            }

            var $is_test_claim {
              value = ($claim_lower|substr:0:5 == "test-") || ($claim_lower|substr:0:5 == "test_")
            }

            var $is_test_runid {
              value = ($trid != "")
            }

            // Customer phone check
            var $cust_id_t {
              value = ($tj.customer_id ?? 0)
            }

            var $phone_match {
              value = false
            }

            var $first_name_match {
              value = false
            }

            conditional {
              if ($cust_id_t > 0) {
                db.get customer {
                  field_name = "id"
                  field_value = $cust_id_t
                } as $tcust

                var $tphone {
                  value = (($tcust.first_name ?? "")|trim|to_lower)
                }

                var $tphone_digits {
                  value = (($tcust.phone ?? "")|replace:"+":""|replace:" ":""|replace:"-":""|replace:"(":""|replace:")":"")
                }

                var.update $phone_match {
                  value = ($tphone_digits|substr:0:9 == "155555500") || ($tphone_digits|substr:0:7 == "5555550")
                }

                var $tfirst_lower {
                  value = (($tcust.first_name ?? "")|trim|to_lower)
                }

                var.update $first_name_match {
                  value = ($tfirst_lower == "servicepower") || ($tfirst_lower == "voicemail caller")
                }
              }
            }

            var $is_test_row {
              value = $is_test_claim || $is_test_runid || $phone_match || $first_name_match
            }

            conditional {
              if ($is_test_row) {
                var.update $test_candidates {
                  value = ($test_candidates + 1)
                }

                conditional {
                  if (!$is_dry) {
                    db.edit jobs {
                      field_name = "id"
                      field_value = $tj.id
                      data = {
                        scheduling_status: "canceled"
                        notes            : (($tj.notes ?? "") ~ "\n[ant purged test data " ~ ((now|to_ms)|to_text) ~ "]")
                      }
                    } as $tcancel

                    var.update $test_canceled {
                      value = ($test_canceled + 1)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // ============================================================
    // PASS 2 — STALE DATA DETECTION
    // not_ready jobs older than stale_days that haven't already been
    // canceled by the test pass.
    // ============================================================
    var $do_stale_pass {
      value = ($mode_clean == "stale") || ($mode_clean == "both")
    }

    conditional {
      if ($do_stale_pass) {
        db.query jobs {
          where = $db.jobs.scheduling_status == "not_ready" && $db.jobs.created_at < $stale_cutoff_ms
          sort = {jobs.created_at: "asc"}
          return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
        } as $stale_rows

        foreach ($stale_rows.items) {
          each as $sj {
            var.update $stale_candidates {
              value = ($stale_candidates + 1)
            }

            conditional {
              if (!$is_dry) {
                db.edit jobs {
                  field_name = "id"
                  field_value = $sj.id
                  data = {
                    scheduling_status: "canceled"
                    notes            : (($sj.notes ?? "") ~ "\n[ant purged stale " ~ ($stale_days_eff|to_text) ~ "d+ " ~ ((now|to_ms)|to_text) ~ "]")
                  }
                } as $scancel

                var.update $stale_canceled {
                  value = ($stale_canceled + 1)
                }
              }
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "purge_test_and_stale_jobs"
        metadata: {
          mode              : $mode_clean
          dry_run           : $is_dry
          stale_days        : $stale_days_eff
          test_candidates   : $test_candidates
          test_canceled     : $test_canceled
          stale_candidates  : $stale_candidates
          stale_canceled    : $stale_canceled
        }
      }
    } as $audit
  }

  response = {
    success         : true
    mode            : $mode_clean
    dry_run         : $is_dry
    test_candidates : $test_candidates
    test_canceled   : $test_canceled
    stale_candidates: $stale_candidates
    stale_canceled  : $stale_canceled
    total_canceled  : ($test_canceled + $stale_canceled)
  }

  guid = "purge-test-and-stale-jobs-v1"
}

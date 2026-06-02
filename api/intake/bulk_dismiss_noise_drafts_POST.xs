// One-shot office-side cleanup. Dismisses email_generic_warranty jobs
// that are obvious noise — Pending-review placeholder customers OR
// jobs whose problem_summary is a known non-dispatch subject pattern
// (Allstate "request for updated call status", "Update Request",
// status-update follow-ups, etc).
//
// Idempotent — re-running just finds nothing left to dismiss.
//
// Office-password gated.
query bulk_dismiss_noise_drafts verb=POST {
  api_group = "intake"

  input {
    text office_password
    bool? dry_run?
  }

  stack {
    var $env_pw {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    var $supplied_pw {
      value = (($input.office_password ?? "")|trim)
    }

    conditional {
      if ($env_pw == "" || $env_pw != $supplied_pw) {
        return {
          value = { success: false, error: "unauthorized" }
        }
      }
    }

    db.query jobs {
      where = $db.jobs.intake_source == "email_generic_warranty" && $db.jobs.scheduling_status == "needs_more_info"
      sort = {jobs.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows

    var $dismissed_count {
      value = 0
    }

    var $reviewed_count {
      value = 0
    }

    var $sample_dismissed {
      value = []
    }

    foreach ($rows.items) {
      each as $j {
        var.update $reviewed_count {
          value = $reviewed_count + 1
        }

        db.get customer {
          field_name = "id"
          field_value = ($j.customer_id ?? 0)
        } as $c

        var $first_name {
          value = (($c.first_name|to_text) ?? "")|trim
        }

        var $sub {
          value = (($j.problem_summary|to_text) ?? "")|lower
        }

        var $is_placeholder {
          value = $first_name == "(Pending review)" || $first_name == ""
        }

        var $is_status_update {
          value = ($sub|contains:"request for updated") || ($sub|contains:"update request") || ($sub|contains:"failed repair notice") || ($sub|contains:"call status") || ($sub|contains:"reply requested") || ($sub|contains:"closed dispatch")
        }

        var $should_dismiss {
          value = $is_placeholder || $is_status_update
        }

        conditional {
          if ($should_dismiss && $input.dry_run != true) {
            db.edit jobs {
              field_name = "id"
              field_value = $j.id
              data = {
                scheduling_status: "canceled"
                friendly_status  : $is_status_update ? "Dismissed (status update, not a new dispatch)" : "Dismissed (unparsed placeholder)"
              }
            }

            var.update $dismissed_count {
              value = $dismissed_count + 1
            }

            conditional {
              if (($sample_dismissed|count) < 5) {
                var.update $sample_dismissed {
                  value = $sample_dismissed|push:{job_id: $j.id, reason: ($is_status_update ? "status_update" : "placeholder"), sub: (($j.problem_summary|to_text) ?? "")|substring:0:80}
                }
              }
            }
          }
          elseif ($should_dismiss && $input.dry_run == true) {
            var.update $dismissed_count {
              value = $dismissed_count + 1
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "bulk_dismiss_noise_drafts_run"
        metadata: ```
          {
            reviewed       : $reviewed_count
            dismissed      : $dismissed_count
            dry_run        : ($input.dry_run == true)
          }|json_encode
          ```
      }
    }
  }

  response = {
    success         : true
    reviewed_count  : $reviewed_count
    dismissed_count : $dismissed_count
    sample_dismissed: $sample_dismissed
    dry_run         : ($input.dry_run == true)
  }

  guid = "bulk-dismiss-noise-drafts-v1"
}

// Office Today — single-pane priority queue for office workflow.
// Returns 4 sections in one round-trip:
//   - escalations: urgent items needing immediate human attention
//   - warranty_submissions_due: JOB_COMPLETED warranty jobs awaiting portal entry
//   - stuck_intake: not_ready jobs > 24h that haven't been scheduled
//   - unpaid_self_pay: self_pay jobs completed > 7d ago with no payment recorded
//
// Each item carries enough context for Danielle to copy/paste into vendor
// portals OR for Teddy to action from his phone.
query get_office_today verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    var $now_ms {
      value = now|to_ms
    }

    var $day_ms {
      value = 86400000
    }

    var $week_ms {
      value = 604800000
    }

    // ============================================================
    // SECTION 1 — ESCALATIONS
    // event_log actions in the last 24h that signal urgent human attention.
    // Includes: warranty escalations, low ratings (1-2 star), tech late check
    // alerts, parts delays.
    // ============================================================
    var $esc_cutoff {
      value = ($now_ms - $day_ms)
    }

    db.query event_log {
      where = $db.event_log.created_at > $esc_cutoff && ($db.event_log.action == "warranty_claim_action_persisted" || $db.event_log.action == "customer_feedback_low_rating_alert" || $db.event_log.action == "tech_late_alert" || $db.event_log.action == "customer_vent_submitted")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $esc_rows

    var $escalations {
      value = []
    }

    foreach ($esc_rows.items) {
      each as $row {
        var $item {
          value = {
            action       : $row.action
            created_at   : $row.created_at
            metadata     : $row.metadata
            event_id     : $row.id
            age_hours    : (($now_ms - $row.created_at) / 3600000)
          }
        }

        var.update $escalations {
          value = $escalations|push:$item
        }
      }
    }

    // ============================================================
    // SECTION 2 — WARRANTY SUBMISSIONS DUE
    // Jobs with scheduling_status=completed AND customer_type=warranty AND
    // no warranty submission audit row yet. Danielle's daily grind: she
    // pastes the claim package into the vendor portal manually.
    // ============================================================
    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.customer_type == "warranty" && $db.jobs.job_completed_at > ($now_ms - ($day_ms * 14))
      sort = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $war_rows

    var $warranty_submissions {
      value = []
    }

    foreach ($war_rows.items) {
      each as $job {
        // Skip if a warranty_submitted_<job_id> event_log row exists —
        // Danielle (or future autopilot) already submitted it. Action
        // string carries the job_id since metadata is JSON and not
        // queryable with simple filters.
        var $war_action_key {
          value = "warranty_submitted_" ~ ($job.id|to_text)
        }

        db.query event_log {
          where = $db.event_log.action == $war_action_key
          return = {type: "exists"}
        } as $already_submitted

        conditional {
          if (!$already_submitted) {
        // Look up the customer for paste-ready contact info.
        var $cust_id {
          value = ($job.customer_id ?? 0)
        }

        var $cust {
          value = null
        }

        conditional {
          if ($cust_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id
            } as $cust_lookup

            var.update $cust {
              value = $cust_lookup
            }
          }
        }

        // Look up the tech who completed the job.
        var $tech_id {
          value = ($job.technician_id ?? 0)
        }

        var $tech {
          value = null
        }

        conditional {
          if ($tech_id > 0) {
            db.get technicians {
              field_name = "id"
              field_value = $tech_id
            } as $tech_lookup

            var.update $tech {
              value = $tech_lookup
            }
          }
        }

        // Pull the latest TDR for paste-ready repair detail.
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $job.id
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_rows

        var $tdr {
          value = (($tdr_rows.items|first) ?? null)
        }

        var $war_item {
          value = {
            job_id           : $job.id
            claim_number     : ($job.ahs_claim_number ?? "")
            dispatch_id      : ($job.dispatch_source_id ?? "")
            warranty_company : ($job.warranty_company ?? "")
            customer         : $cust
            tech             : $tech
            appliance_type   : ($job.appliance_type ?? "")
            brand            : ($job.brand ?? "")
            model_number     : ($job.model_number ?? "")
            serial_number    : ($job.serial_number ?? "")
            problem_summary  : ($job.problem_summary ?? "")
            tdr              : $tdr
            job_completed_at : ($job.job_completed_at ?? 0)
            age_hours        : (($now_ms - ($job.job_completed_at ?? $now_ms)) / 3600000)
          }
        }

        var.update $warranty_submissions {
          value = $warranty_submissions|push:$war_item
        }
          }
        }
      }
    }

    // ============================================================
    // SECTION 3 — STUCK INTAKE
    // not_ready jobs older than 24h with no scheduled_start. These have
    // been sitting in the queue without action.
    // ============================================================
    var $stuck_cutoff {
      value = ($now_ms - $day_ms)
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" && $db.jobs.created_at < $stuck_cutoff && $db.jobs.scheduled_start == null
      sort = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $stuck_rows

    var $stuck_intake {
      value = []
    }

    foreach ($stuck_rows.items) {
      each as $job {
        var $sc_id {
          value = ($job.customer_id ?? 0)
        }

        var $sc_cust {
          value = null
        }

        conditional {
          if ($sc_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $sc_id
            } as $sc_cust_lookup

            var.update $sc_cust {
              value = $sc_cust_lookup
            }
          }
        }

        var $stuck_item {
          value = {
            job_id           : $job.id
            customer         : $sc_cust
            customer_type    : ($job.customer_type ?? "")
            appliance_type   : ($job.appliance_type ?? "")
            warranty_company : ($job.warranty_company ?? "")
            claim_number     : ($job.ahs_claim_number ?? "")
            intake_source    : ($job.intake_source ?? "")
            created_at       : $job.created_at
            age_days         : (($now_ms - $job.created_at) / $day_ms)
          }
        }

        var.update $stuck_intake {
          value = $stuck_intake|push:$stuck_item
        }
      }
    }

    // ============================================================
    // SECTION 4 — UNPAID SELF-PAY
    // self_pay jobs completed > 7d ago that don't have payment_collected.
    // ============================================================
    var $unpaid_cutoff {
      value = ($now_ms - $week_ms)
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.customer_type == "self_pay" && $db.jobs.job_completed_at < $unpaid_cutoff && $db.jobs.payment_collected != true
      sort = {jobs.job_completed_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $unpaid_rows

    var $unpaid_self_pay {
      value = []
    }

    foreach ($unpaid_rows.items) {
      each as $job {
        var $up_id {
          value = ($job.customer_id ?? 0)
        }

        var $up_cust {
          value = null
        }

        conditional {
          if ($up_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $up_id
            } as $up_cust_lookup

            var.update $up_cust {
              value = $up_cust_lookup
            }
          }
        }

        var $unpaid_item {
          value = {
            job_id          : $job.id
            customer        : $up_cust
            appliance_type  : ($job.appliance_type ?? "")
            problem_summary : ($job.problem_summary ?? "")
            job_completed_at: ($job.job_completed_at ?? 0)
            age_days        : (($now_ms - ($job.job_completed_at ?? $now_ms)) / $day_ms)
          }
        }

        var.update $unpaid_self_pay {
          value = $unpaid_self_pay|push:$unpaid_item
        }
      }
    }

    // ============================================================
    // SECTION 5 — VOICEMAIL QUEUE (Vapi fall-through)
    // Vapi voicemails captured in the last 72h that haven't been
    // cleared. Each row in event_log with action="vapi_voicemail_received"
    // is filtered if a corresponding "vapi_voicemail_cleared_<id>" row
    // exists.
    // ============================================================
    var $vm_cutoff {
      value = ($now_ms - ($day_ms * 3))
    }

    db.query event_log {
      where = $db.event_log.action == "vapi_voicemail_received" && $db.event_log.created_at > $vm_cutoff
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $vm_rows

    var $voicemail_queue {
      value = []
    }

    foreach ($vm_rows.items) {
      each as $vm {
        var $clear_key {
          value = "vapi_voicemail_cleared_" ~ ($vm.id|to_text)
        }

        db.query event_log {
          where = $db.event_log.action == $clear_key
          return = {type: "exists"}
        } as $vm_cleared

        conditional {
          if (!$vm_cleared) {
            var $vm_item {
              value = {
                event_id   : $vm.id
                created_at : $vm.created_at
                metadata   : $vm.metadata
                age_hours  : (($now_ms - $vm.created_at) / 3600000)
              }
            }

            var.update $voicemail_queue {
              value = $voicemail_queue|push:$vm_item
            }
          }
        }
      }
    }
  }

  response = {
    success                  : true
    as_of_ms                 : $now_ms
    escalations              : $escalations
    warranty_submissions_due : $warranty_submissions
    stuck_intake             : $stuck_intake
    unpaid_self_pay          : $unpaid_self_pay
    voicemail_queue          : $voicemail_queue
    counts                   : {
      escalations              : ($escalations|count)
      warranty_submissions_due : ($warranty_submissions|count)
      stuck_intake             : ($stuck_intake|count)
      unpaid_self_pay          : ($unpaid_self_pay|count)
      voicemail_queue          : ($voicemail_queue|count)
    }
  }

  guid = "get-office-today-v1"
}

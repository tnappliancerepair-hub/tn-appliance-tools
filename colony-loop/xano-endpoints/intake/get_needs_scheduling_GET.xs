// Returns jobs awaiting scheduling, grouped into a 5-stage funnel for
// Danielle's needs-scheduling.html view.
//
// Stages (computed per job from existing columns + a 1-query TDR check):
//   1. needs_scheduled        — recently created, intake SMS not assumed sent yet
//                              (age < 30 min). Transient stage.
//   2. awaiting_customer_info — intake SMS sent (age >= 30 min) but no
//                              customer_preference_text AND no access_notes.
//   3. awaiting_prediagnosis  — customer responded but no TDR from
//                              technician_id=1 (Teddy's pre-diag).
//   4. awaiting_parts_eta     — pre-diag complete, parts_status indicates
//                              parts needed but no parts_eta_date set.
//   5. ready_to_schedule      — all gates passed; auto-scheduler should
//                              pick this up but hasn't yet.
//
// Excludes terminal statuses (scheduled / in_progress / completed /
// canceled / no_fix_possible). Returns top 100 jobs by created_at desc.
query get_needs_scheduling verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $lim_raw {
      value = ($input.limit ?? 100)
    }

    var $lim {
      value = ($lim_raw > 200) ? 200 : $lim_raw
    }

    var $now_ms {
      value = now|to_ms
    }

    var $thirty_min_ms {
      value = 30 * 60 * 1000
    }

    db.query jobs {
      where  = $db.jobs.scheduling_status != "scheduled" && $db.jobs.scheduling_status != "in_progress" && $db.jobs.scheduling_status != "completed" && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible" && $db.jobs.scheduling_status != "held" && $db.jobs.scheduling_status != "awaiting_parts" && $db.jobs.scheduled_start == null
      sort   = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $job_rows

    // Stage buckets — each gets an array of job summaries.
    var $stage_1 { value = [] }
    var $stage_2 { value = [] }
    var $stage_3 { value = [] }
    var $stage_4 { value = [] }
    var $stage_5 { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        // Customer lookup (skip if no customer_id).
        var $cust { value = null }

        conditional {
          if (($j.customer_id ?? 0) > 0) {
            db.get customer {
              field_name  = "id"
              field_value = $j.customer_id
            } as $cust
          }
        }

        // Pre-diagnosis check.
        db.query technician_decision_report {
          where  = $db.technician_decision_report.job_id == $j.id && $db.technician_decision_report.technician_id == 1
          sort   = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_rows

        var $has_prediag {
          value = (($tdr_rows.items|first) ?? null) != null
        }

        // Field state.
        var $pref_text {
          value = (($j.customer_preference_text ?? "")|trim)
        }

        var $access {
          value = (($j.access_notes ?? "")|trim)
        }

        var $has_customer_response {
          value = ($pref_text != "") || ($access != "")
        }

        var $parts_status {
          value = (($j.parts_status ?? "")|lower)
        }

        var $parts_needed {
          value = ($parts_status == "parts_needed") || ($parts_status == "ordered") || ($parts_status == "on_order") || ($parts_status == "pending") || ($parts_status == "awaiting_parts")
        }

        var $parts_eta {
          value = ($j.parts_eta_date ?? null)
        }

        var $job_age_ms {
          value = $now_ms - (($j.created_at ?? $now_ms)|to_ms)
        }

        var $intake_sms_assumed_sent {
          value = $job_age_ms >= $thirty_min_ms
        }

        // Bucket assignment — first match wins, working outward from green.
        var $stage {
          value = ""
        }

        conditional {
          if (!$has_customer_response && !$intake_sms_assumed_sent) {
            var.update $stage { value = "needs_scheduled" }
          }
          elseif (!$has_customer_response) {
            var.update $stage { value = "awaiting_customer_info" }
          }
          elseif (!$has_prediag) {
            var.update $stage { value = "awaiting_prediagnosis" }
          }
          elseif ($parts_needed && ($parts_eta == null)) {
            var.update $stage { value = "awaiting_parts_eta" }
          }
          else {
            var.update $stage { value = "ready_to_schedule" }
          }
        }

        // Summary object — keep small; row payload bloat hurts list views.
        var $cust_first {
          value = (($cust.first_name ?? "")|trim)
        }

        var $cust_last {
          value = (($cust.last_name ?? "")|trim)
        }

        var $cust_name {
          value = ($cust_first ~ " " ~ $cust_last)|trim
        }

        var $summary {
          value = {
            id                  : $j.id
            customer_name       : (($cust_name == "") ? "—" : $cust_name)
            phone               : ($cust.phone ?? "")
            appliance           : ($j.appliance_type ?? "")
            brand               : ($j.brand ?? "")
            zip                 : ($j.service_zip ?? ($cust.zip ?? ""))
            city                : ($j.service_city ?? ($cust.city ?? ""))
            source              : ($j.intake_source ?? "")
            warranty_company    : ($j.warranty_company ?? "")
            customer_type       : ($j.customer_type ?? "")
            scheduling_status   : ($j.scheduling_status ?? "")
            parts_status        : ($j.parts_status ?? "")
            parts_eta_date      : ($j.parts_eta_date ?? null)
            created_at          : ($j.created_at ?? null)
            age_hours           : ($job_age_ms / 3600000)|round:1
            has_customer_response: $has_customer_response
            has_prediag         : $has_prediag
          }
        }

        conditional {
          if ($stage == "needs_scheduled") {
            var.update $stage_1 { value = $stage_1|push:$summary }
          }
          elseif ($stage == "awaiting_customer_info") {
            var.update $stage_2 { value = $stage_2|push:$summary }
          }
          elseif ($stage == "awaiting_prediagnosis") {
            var.update $stage_3 { value = $stage_3|push:$summary }
          }
          elseif ($stage == "awaiting_parts_eta") {
            var.update $stage_4 { value = $stage_4|push:$summary }
          }
          else {
            var.update $stage_5 { value = $stage_5|push:$summary }
          }
        }
      }
    }
  }

  response = {
    success          : true
    total_in_funnel  : ($job_rows.items|count)
    stages           : [
      {key: "needs_scheduled",        label: "Needs Scheduled",          count: ($stage_1|count), jobs: $stage_1}
      {key: "awaiting_customer_info", label: "Awaiting Customer Info",   count: ($stage_2|count), jobs: $stage_2}
      {key: "awaiting_prediagnosis",  label: "Awaiting Pre-Diagnosis",   count: ($stage_3|count), jobs: $stage_3}
      {key: "awaiting_parts_eta",     label: "Awaiting Parts ETA",       count: ($stage_4|count), jobs: $stage_4}
      {key: "ready_to_schedule",      label: "Ready to Auto-Schedule",   count: ($stage_5|count), jobs: $stage_5}
    ]
  }

  guid = "get-needs-scheduling-v1"
}

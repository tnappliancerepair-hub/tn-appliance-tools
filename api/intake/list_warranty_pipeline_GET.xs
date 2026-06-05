// Warranty work-queue pipeline view. Returns every ACTIVE warranty job
// in the last N days regardless of TDR completeness, so Danielle sees
// the full pipeline (scheduled, in-flight, completed-awaiting-submission)
// not just the narrow set of finalized claim packages.
//
// Excludes canceled + not_ready (no point surfacing dead work).
//
// Used by warranty-review.html (below the existing claim-package list).
//
// Contract:
//   GET ?days_back=N (optional, default 30, max 90)
//   Response: {
//     success: true, count: N,
//     jobs: [
//       {
//         id, customer_first, customer_last, customer_phone,
//         address, city, appliance_type, appliance_brand,
//         model_number, problem_summary, claim_number,
//         warranty_company, scheduling_status, technician_id,
//         created_at, scheduled_start, job_completed_at,
//         warranty_submitted_at, has_tdr_capture (bool)
//       }, ...
//     ]
//   }
query list_warranty_pipeline verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $window_days_raw {
      value = ($input.days_back ?? 30)
    }
    var $window_days {
      value = ($window_days_raw > 90) ? 90 : $window_days_raw
    }
    var $now_ms { value = now|to_ms }
    var $cutoff_ms { value = ($now_ms - ($window_days * 86400000)) }

    db.query jobs {
      where = $db.jobs.customer_type == "warranty" && $db.jobs.created_at >= $cutoff_ms && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "not_ready"
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows

    var $items { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        db.get customer {
          field_name = "id"
          field_value = ($j.customer_id ?? 0)
        } as $cust

        var $cust_first { value = (($cust ?? {first_name: ""}).first_name ?? "") }
        var $cust_last  { value = (($cust ?? {last_name: ""}).last_name ?? "") }
        var $cust_phone { value = (($cust ?? {phone: ""}).phone ?? "") }
        var $cust_addr  { value = (($cust ?? {address: ""}).address ?? "") }
        var $cust_city  { value = (($cust ?? {city: ""}).city ?? "") }

        var $svc_addr   { value = (($j.service_address ?? "")|trim) }
        var $address_final {
          value = ($svc_addr != "") ? $svc_addr : $cust_addr
        }

        // Most-recent TDR for this job so the UI can show captured
        // parts (Phase 3 — return-part visibility for SquareTrade).
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $j.id
          sort  = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_rows
        var $tdr_first { value = (($tdr_rows.items|first) ?? null) }
        var $has_tdr { value = ($tdr_first != null) }
        var $tdr_parts {
          value = ($tdr_first == null) ? "" : (($tdr_first.parts_needed ?? "")|to_text)
        }
        var $tdr_diagnosis {
          value = ($tdr_first == null) ? "" : (($tdr_first.diagnosis ?? "")|to_text)
        }

        var $row {
          value = {
            id                  : $j.id
            customer_first      : (($cust_first ?? "")|trim)
            customer_last       : (($cust_last ?? "")|trim)
            customer_phone      : (($cust_phone ?? "")|trim)
            address             : (($address_final ?? "")|trim)
            city                : (($cust_city ?? "")|trim)
            appliance_type      : (($j.appliance_type ?? "")|trim)
            appliance_brand     : (($j.appliance_brand ?? "")|trim)
            model_number        : (($j.model_number ?? "")|trim)
            problem_summary     : (($j.problem_summary ?? "")|trim)
            claim_number        : (($j.claim_number ?? "")|trim)
            warranty_company    : (($j.warranty_company ?? "")|trim)
            scheduling_status   : (($j.scheduling_status ?? "")|trim)
            technician_id       : ($j.technician_id ?? null)
            created_at          : ($j.created_at ?? null)
            scheduled_start     : ($j.scheduled_start ?? null)
            job_completed_at    : ($j.job_completed_at ?? null)
            warranty_submitted_at: ($j.warranty_submitted_at ?? null)
            has_tdr_capture     : $has_tdr
            tdr_parts_needed    : $tdr_parts
            tdr_diagnosis       : $tdr_diagnosis
          }
        }

        var.update $items {
          value = $items|push:$row
        }
      }
    }
  }

  response = {success: true, count: $items|count, jobs: $items}
  guid = "list-warranty-pipeline-v1"
}

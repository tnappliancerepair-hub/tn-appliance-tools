// Powers warranty-submission-dashboard.html.
//
// Returns completed warranty jobs in a recent window, INCLUDING
// already-submitted ones. The page's "show submitted" toggle and the
// undo button both need those rows present, so this endpoint deliberately
// does NOT filter on warranty_submitted_at.
//
// Filter:
//   scheduling_status == "completed"
//   AND warranty_company != ""
//   AND (job_completed_at >= cutoff  OR  warranty_submitted_at >= cutoff)
//   where cutoff = now - days_back * 86400000 ms (default 14 days)
//
// Hydrates customer info per row from the customer table.
//
// Contract:
//   Request: GET ?days_back=N (optional, default 14, max 60)
//   Response: {
//     success: true,
//     count: N,
//     items: [
//       {
//         id, customer_name, customer_phone, address, city,
//         appliance, brand, model_number, problem_summary,
//         claim_number, warranty_company, technician_id,
//         scheduling_status, job_completed_at,
//         warranty_submitted_at, warranty_submitted: bool
//       }, ...
//     ]
//   }
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if, every
// filter paren-wrapped, ?? only in value = (...).

query list_warranty_jobs verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $window_days_raw {
      value = ($input.days_back ?? 14)
    }

    var $window_days {
      value = ($window_days_raw > 60) ? 60 : $window_days_raw
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $cutoff_ms {
      value = ($now_ms - ($window_days * 86400000))
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.warranty_company != "" && ($db.jobs.job_completed_at >= $cutoff_ms || $db.jobs.warranty_submitted_at >= $cutoff_ms)
      sort = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows

    var $items {
      value = []
    }

    foreach ($job_rows.items) {
      each as $j {
        db.get customer {
          field_name = "id"
          field_value = ($j.customer_id ?? 0)
        } as $cust

        var $cust_first {
          value = (($cust ?? {first_name: ""}).first_name ?? "")
        }

        var $cust_last {
          value = (($cust ?? {last_name: ""}).last_name ?? "")
        }

        var $cust_phone {
          value = (($cust ?? {phone: ""}).phone ?? "")
        }

        var $cust_address {
          value = (($cust ?? {address: ""}).address ?? "")
        }

        var $cust_city {
          value = (($cust ?? {city: ""}).city ?? "")
        }

        var $name_trimmed {
          value = (($cust_first ~ " " ~ $cust_last)|trim)
        }

        var $svc_address {
          value = (($j.service_address ?? "")|trim)
        }

        var $svc_city {
          value = (($j.service_city ?? "")|trim)
        }

        var $address_final {
          value = ($svc_address != "") ? $svc_address : $cust_address
        }

        var $city_final {
          value = ($svc_city != "") ? $svc_city : $cust_city
        }

        var $submitted_ts {
          value = ($j.warranty_submitted_at ?? null)
        }

        var $is_submitted {
          value = ($submitted_ts != null)
        }

        var $row {
          value = {
            id: $j.id
            customer_name: $name_trimmed
            customer_phone: (($cust_phone ?? "")|trim)
            address: (($address_final ?? "")|trim)
            city: (($city_final ?? "")|trim)
            appliance: (($j.appliance_type ?? "")|trim)
            brand: (($j.brand ?? "")|trim)
            model_number: (($j.model_number ?? "")|trim)
            problem_summary: (($j.problem_summary ?? "")|trim)
            claim_number: (($j.claim_number ?? "")|trim)
            warranty_company: (($j.warranty_company ?? "")|trim)
            technician_id: ($j.technician_id ?? null)
            scheduling_status: (($j.scheduling_status ?? "")|trim)
            job_completed_at: ($j.job_completed_at ?? null)
            warranty_submitted_at: $submitted_ts
            warranty_submitted: $is_submitted
          }
        }

        var.update $items {
          value = ($items|push:$row)
        }
      }
    }
  }

  response = {
    success: true
    count: ($items|count)
    jobs: $items
  }

  guid = "list-warranty-jobs-v1"
}

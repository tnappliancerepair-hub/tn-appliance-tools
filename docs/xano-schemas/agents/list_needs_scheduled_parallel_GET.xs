// Powers Danielle's needs-scheduled.html - REWRITE 2026-05-30.
//
// Original used an event_log scan + substring JSON parsing because the
// jobs.parallel_mode column did not exist. That column was added
// 2026-05-30, so this version queries the column directly.
//
// Also removes original footguns:
//   * line 63 backtick wrap on ($jid_split|get:0)|trim - parser-fatal
//   * line 101 use of (ternary) where coalesce was intended
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query list_needs_scheduled_parallel verb=GET {
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

    // Pull all parallel-mode jobs that are not yet scheduled.
    // scheduled_start null OR 0 = not scheduled.
    db.query jobs {
      where = $db.jobs.parallel_mode == true && ($db.jobs.scheduled_start == null || $db.jobs.scheduled_start == 0) && ($db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "needs_scheduled")
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
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

        var $cust_state {
          value = (($cust ?? {state: ""}).state ?? "")
        }

        var $cust_zip {
          value = (($cust ?? {zip: ""}).zip ?? "")
        }

        var $svc_addr {
          value = (($j.service_address ?? "")|trim)
        }

        var $svc_city {
          value = (($j.service_city ?? "")|trim)
        }

        var $svc_state {
          value = (($j.service_state ?? "")|trim)
        }

        var $svc_zip {
          value = (($j.service_zip ?? "")|trim)
        }

        var $row {
          value = {
            id: $j.id
            created_at: ($j.created_at ?? 0)
            customer_first: (($cust_first ?? "")|trim)
            customer_last: (($cust_last ?? "")|trim)
            customer_phone: (($cust_phone ?? "")|trim)
            service_address: ($svc_addr != "") ? $svc_addr : (($cust_address ?? "")|trim)
            service_city: ($svc_city != "") ? $svc_city : (($cust_city ?? "")|trim)
            service_state: ($svc_state != "") ? $svc_state : (($cust_state ?? "")|trim)
            service_zip: ($svc_zip != "") ? $svc_zip : (($cust_zip ?? "")|trim)
            appliance: (($j.appliance_type ?? "")|trim)
            brand: (($j.brand ?? "")|trim)
            model_number: (($j.model_number ?? "")|trim)
            problem_summary: (($j.problem_summary ?? "")|trim)
            warranty_company: (($j.warranty_company ?? "")|trim)
            claim_number: (($j.claim_number ?? "")|trim)
            intake_source: (($j.intake_source ?? "")|trim)
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
    items: $items
  }

  guid = "list-needs-scheduled-parallel-v2"
}

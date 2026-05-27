// Returns address-rich job rows for the office map view. Filters to
// jobs with at least one address field set, sorted by scheduled_start
// asc (so today's stops come first). Caps at 200 rows so the geocoder
// doesn't melt. Used by office-map.js to plot pins on the office portal.
query list_jobs_for_office_map verb=GET {
  api_group = "intake"

  input {
    text? region?
    int? limit?
  }

  stack {
    var $lim_raw { value = ($input.limit ?? 200) }
    var $lim { value = ($lim_raw > 300) ? 300 : $lim_raw }

    // Pull jobs with non-canceled status that have any address field.
    // Region filter is client-side via state field (TN vs LA).
    db.query jobs {
      where  = $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort   = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $job_rows

    var $region_clean { value = (($input.region ?? "")|trim|lower) }

    var $items { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        var $svc_addr { value = (($j.service_address ?? "")|trim) }
        var $svc_city { value = (($j.service_city ?? "")|trim) }
        var $svc_state_raw { value = (($j.service_state ?? "")|trim|upper) }
        var $svc_zip { value = (($j.service_zip ?? "")|trim) }

        // Skip jobs with no address whatsoever
        conditional {
          if ($svc_addr != "" || $svc_city != "" || $svc_zip != "") {
            // Region filter — client-side. TN = state contains TN/Tennessee;
            // LA = state contains LA/Louisiana. Default = both.
            var $is_la_state { value = ($svc_state_raw == "LA") || ($svc_state_raw == "LOUISIANA") }
            var $is_tn_state { value = ($svc_state_raw == "TN") || ($svc_state_raw == "TENNESSEE") }

            var $include_row { value = true }

            conditional {
              if ($region_clean == "tn") {
                var.update $include_row { value = $is_tn_state || ($svc_state_raw == "") }
              }
              elseif ($region_clean == "la") {
                var.update $include_row { value = $is_la_state }
              }
            }

            conditional {
              if ($include_row) {
                db.get customer {
                  field_name  = "id"
                  field_value = ($j.customer_id ?? 0)
                } as $cust

                var $row {
                  value = {
                    job_id           : $j.id
                    customer_first   : (($cust.first_name ?? "")|trim)
                    customer_last    : (($cust.last_name ?? "")|trim)
                    address          : $svc_addr
                    city             : $svc_city
                    state            : $svc_state_raw
                    zip              : $svc_zip
                    appliance        : (($j.appliance_type ?? "")|trim)
                    warranty_company : (($j.warranty_company ?? "")|trim)
                    scheduling_status: (($j.scheduling_status ?? "")|trim)
                    scheduled_start  : ($j.scheduled_start ?? null)
                    technician_id    : ($j.technician_id ?? null)
                  }
                }

                var.update $items { value = $items|push:$row }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success: true
    count  : ($items|count)
    items  : $items
  }

  guid = "list-jobs-for-office-map-v1"
}

// Returns the open awaiting_parts queue as a flat list of jobs +
// joined customer fields the parts-delivery matcher needs.
//
// Consumed by parts_delivery_observation_handler.js when a Gmail
// delivery-notification or Marcone API webhook calls
// /record_parts_delivery_observation. The matcher needs lightweight
// candidate rows it can scan against: id, customer_name, zip, city,
// part_number, model_number, order_number.
//
// Filtered to:
//   - scheduling_status == "awaiting_parts" (the canonical signal that
//     a job is waiting on parts)
//   - parts_status != "arrived" (don't return already-arrived rows;
//     they shouldn't get a second match)
//   - parallel_mode == true (Phase 1 hard rule — Ant only acts on
//     parallel jobs; legacy HCP jobs are off-limits)
query list_awaiting_parts_jobs verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $lim {
      value = ($input.limit ?? 100)
    }

    db.query jobs {
      filter {
        $this.scheduling_status == "awaiting_parts"
        && (($this.parts_status ?? "") != "arrived")
        && $this.parallel_mode == true
      }
      sort = {created_at: "desc"}
      per_page = $lim
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }

    foreach ($job in $rows.items) {
      db.get customer {
        field_name  = "id"
        field_value = ($job.customer_id ?? 0)
      } as $cust

      var $cust_first { value = ($cust != null) ? ($cust.first_name ?? "") : "" }
      var $cust_last  { value = ($cust != null) ? ($cust.last_name ?? "")  : "" }
      var $cust_name  { value = ($cust_first ~ " " ~ $cust_last)|trim }
      var $cust_zip   { value = ($cust != null) ? ($cust.zip_code ?? "") : "" }
      var $cust_city  { value = ($cust != null) ? ($cust.city ?? "") : "" }
      var $part_num   { value = ($job.parts_ordered_part_number ?? "") }
      var $model_num  { value = ($job.model_number ?? "") }
      var $order_num  { value = ($job.parts_order_number ?? "") }

      var $entry {
        value = {
          id            : $job.id
          customer_name : $cust_name
          service_zip   : $cust_zip
          service_city  : $cust_city
          part_number   : $part_num
          model_number  : $model_num
          order_number  : $order_num
          parts_status  : ($job.parts_status ?? "")
          parts_eta_date: ($job.parts_eta_date ?? null)
        }
      }

      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    items: $items
    count: $count
  }

  guid = "list-awaiting-parts-jobs-v1"
}

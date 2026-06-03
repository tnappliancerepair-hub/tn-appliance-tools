// CSC tool — answer "when are parts arriving / are parts in / what's
// on order?" for a given job. Pulls parts_orders rows + the job's
// summary parts_status enum + eta date.
query get_parts_status verb=POST {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    db.query parts_orders {
      where = $db.parts_orders.job_id == $input.job_id
      sort = {parts_orders.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $orders_rows

    var $orders {
      value = []
    }
    var $any_pending {
      value = false
    }
    var $earliest_eta_ms {
      value = 0
    }

    foreach ($orders_rows.items) {
      each as $o {
        var $status {
          value = ($o.status ?? "")
        }
        var $expected_ms {
          value = ($o.expected_arrival_ms ?? 0)
        }

        conditional {
          if ($status == "ordered" || $status == "pending" || $status == "in_transit" || $status == "backordered") {
            var.update $any_pending {
              value = true
            }
            conditional {
              if ($expected_ms > 0 && ($earliest_eta_ms == 0 || $expected_ms < $earliest_eta_ms)) {
                var.update $earliest_eta_ms {
                  value = $expected_ms
                }
              }
            }
          }
        }

        var $row {
          value = {
            id                : ($o.id ?? 0)
            supplier          : ($o.supplier ?? "")
            part_number       : ($o.part_number ?? "")
            part_description  : ($o.part_description ?? "")
            quantity          : ($o.quantity ?? 1)
            status            : $status
            cost_cents        : ($o.cost_cents ?? 0)
            sold_to_customer_cents: ($o.sold_to_customer_cents ?? 0)
            ordered_at_ms     : ($o.ordered_at_ms ?? 0)
            expected_arrival_ms: $expected_ms
            received_at_ms    : ($o.received_at_ms ?? 0)
            tracking_number   : ($o.tracking_number ?? "")
            notes             : ($o.notes ?? "")
          }
        }
        var.update $orders {
          value = $orders|push:$row
        }
      }
    }

    db.add event_log {
      data = {
        action  : "csc_tool_get_parts_status"
        metadata: ({job_id: $input.job_id, count: ($orders|count)}|json_encode)
      }
    }
  }

  response = {
    success         : true
    job_id          : $input.job_id
    parts_status    : ($job.parts_status ?? "")
    parts_eta_date  : ($job.parts_eta_date ?? "")
    has_any_pending : $any_pending
    earliest_eta_ms : $earliest_eta_ms
    order_count     : ($orders|count)
    orders          : $orders
  }

  guid = "get-parts-status-v1"
}

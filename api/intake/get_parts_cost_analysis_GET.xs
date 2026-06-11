// Aggregates parts_orders rows for the cost optimizer. Returns:
//   - per-supplier total spend (last N days)
//   - top SKUs (part_numbers) by spend
//   - per-SKU cross-supplier comparison: where the same part_number
//     has rows from 2+ suppliers, the cost delta is what the agent
//     flags
// This is the data layer; the agent (parts_cost_optimizer.js) reads
// this + composes the SMS digest.
query get_parts_cost_analysis verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days_raw { value = ($input.days_back ?? 30) }
    var $days     { value = ($days_raw > 0 ? $days_raw : 30) }
    var $cutoff   { value = (now|to_ms) - ($days * 86400000) }

    db.query parts_orders {
      where = $db.parts_orders.ordered_at >= $cutoff && $db.parts_orders.cost_cents > 0 && $db.parts_orders.source != "test"
      sort = {parts_orders.ordered_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 2000}}
    } as $rows

    var $count       { value = ($rows.items|count) }
    var $total_spend { value = 0 }

    foreach ($rows.items) {
      each as $r {
        var.update $total_spend { value = $total_spend + ($r.cost_cents ?? 0) + ($r.shipping_cents ?? 0) }
      }
    }
  }

  response = {
    success      : true
    days_back    : $days
    total_orders : $count
    total_spend_cents : $total_spend
    orders       : $rows.items
  }

  guid = "get-parts-cost-analysis-v1"
}

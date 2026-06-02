// Records one part order. Callers:
//   - tech-ant-chat parts-order quick-action (when wired)
//   - manual entry from office-today (when wired)
//   - parts-vendor-gmail-poller (delivery confirmations)
//   - warranty_claim_action (when claim package includes parts list)
//
// Each row = one SKU bought. Aggregates feed parts_cost_optimizer +
// truck_inventory_reconciler + per-job profitability math.
query record_parts_order verb=POST {
  api_group = "intake"

  input {
    text part_number
    int? job_id?
    int? tech_id?
    text? part_name?
    text? supplier?
    int? cost_cents?
    int? shipping_cents?
    int? sold_to_customer_cents?
    text? appliance_type?
    text? brand?
    text? model_number?
    text? order_status?
    text? order_reference?
    text? source?
    text? notes?
  }

  stack {
    var $pn { value = ($input.part_number ?? "")|trim }
    precondition ($pn != "") {
      error_type = "inputerror"
      error = "part_number required"
    }

    db.add parts_orders {
      data = {
        job_id                 : ($input.job_id ?? 0)
        tech_id                : ($input.tech_id ?? 0)
        part_number            : $pn
        part_name              : (($input.part_name ?? "")|trim)
        supplier               : (($input.supplier ?? "other")|trim|lower)
        cost_cents             : ($input.cost_cents ?? 0)
        shipping_cents         : ($input.shipping_cents ?? 0)
        sold_to_customer_cents : ($input.sold_to_customer_cents ?? 0)
        appliance_type         : (($input.appliance_type ?? "")|trim)
        brand                  : (($input.brand ?? "")|trim)
        model_number           : (($input.model_number ?? "")|trim)
        ordered_at             : now
        order_status           : (($input.order_status ?? "ordered")|trim|lower)
        order_reference        : (($input.order_reference ?? "")|trim)
        source                 : (($input.source ?? "manual")|trim|lower)
        notes                  : (($input.notes ?? "")|trim)
      }
    } as $row

    db.add event_log {
      data = {
        action    : "parts_order_recorded"
        metadata  : {
          parts_order_id: $row.id
          job_id        : ($input.job_id ?? 0)
          part_number   : $pn
          supplier      : (($input.supplier ?? "other")|trim|lower)
          cost_cents    : ($input.cost_cents ?? 0)
          source        : (($input.source ?? "manual")|trim|lower)
        }
      }
    } as $audit
  }

  response = {
    success         : true
    parts_order_id  : $row.id
    part_number     : $pn
  }

  guid = "record-parts-order-v1"
}

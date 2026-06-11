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
    text? parts_eta_date?
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

    // Flag the JOB so the office cockpit reflects it: parts_status ->
    // awaiting_parts (badge + can't-schedule-before-parts guard) and the ETA.
    // Two mutually-exclusive conditionals because XS has no else.
    var $eta_clean { value = ($input.parts_eta_date ?? "")|trim }
    var $has_job { value = (($input.job_id ?? 0) > 0) }
    conditional {
      if ($has_job) {
        db.get jobs {
          field_name = "id"
          field_value = $input.job_id
        } as $pjob
        // parts_status -> awaiting_parts (+ ETA) so the cockpit badge + the
        // can't-schedule-before-parts guard react.
        conditional {
          if ($eta_clean != "") {
            db.edit jobs {
              field_name = "id"
              field_value = $input.job_id
              data = { parts_status: "awaiting_parts", parts_eta_date: $eta_clean }
            }
          }
        }
        conditional {
          if ($eta_clean == "") {
            db.edit jobs {
              field_name = "id"
              field_value = $input.job_id
              data = { parts_status: "awaiting_parts" }
            }
          }
        }
        // scheduling_status -> awaiting_parts (so it lands in the Needs Parts
        // tab + the customer portal shows the "parts arrived" button), unless
        // the job is already scheduled / in progress / done.
        var $cur_sched { value = (($pjob.scheduling_status ?? "")|to_lower) }
        var $sched_set {
          value = ($cur_sched == "not_ready" || $cur_sched == "needs_scheduled" || $cur_sched == "held" || $cur_sched == "prediagnosis_pending" || $cur_sched == "needs_more_info" || $cur_sched == "")
        }
        conditional {
          if ($sched_set) {
            db.edit jobs {
              field_name = "id"
              field_value = $input.job_id
              data = { scheduling_status: "awaiting_parts" }
            }
          }
        }
      }
    }

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

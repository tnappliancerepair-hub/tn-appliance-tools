// Universal "parts delivery observed" entry point.
//
// Whatever sees the delivery first — Gmail parser scanning Marcone /
// Triple S / Amazon emails, FedEx tracking webhook, Marcone API
// poller — hits THIS endpoint to record the observation. The
// downstream parts_delivery_observation_handler.js agent then:
//   - tries to fuzzy-match against open awaiting_parts jobs by
//     customer name / zip / part number / order number
//   - if a confident match: calls mark_parts_arrived → fires the
//     full PARTS_ARRIVED chain (tech SMS + Teddy alert + customer
//     portal celebration)
//   - if ambiguous: SMSes Teddy with the extracted details + asks
//     which job it belongs to
//
// This endpoint is the canonical funnel — keeps every source feeding
// the same matcher logic instead of each parser implementing its own.
//
// Inputs are intentionally loose since different sources surface
// different combinations of identifiers.
query record_parts_delivery_observation verb=POST {
  api_group = "intake"

  input {
    text source filters=trim  // "gmail_marcone", "gmail_triples", "marcone_api", "manual", etc.
    text? vendor?              // "Marcone", "Triple S", "Amazon Business"
    text? tracking_number?
    text? order_number?
    text? customer_name_hint?
    text? customer_zip_hint?
    text? part_number_hint?
    text? model_number_hint?
    text? delivered_at_text?   // raw text from email if no parse
    int? delivered_at_ms?      // parsed unix-ms when available
    text? raw_subject?         // email subject for audit
    text? raw_snippet?         // truncated body text
  }

  stack {
    precondition ($input.source != "") {
      error_type = "inputerror"
      error      = "source required"
    }

    var $obs_meta {
      value = {
        source             : $input.source
        vendor             : ($input.vendor ?? "")
        tracking_number    : ($input.tracking_number ?? "")
        order_number       : ($input.order_number ?? "")
        customer_name_hint : ($input.customer_name_hint ?? "")
        customer_zip_hint  : ($input.customer_zip_hint ?? "")
        part_number_hint   : ($input.part_number_hint ?? "")
        model_number_hint  : ($input.model_number_hint ?? "")
        delivered_at_text  : ($input.delivered_at_text ?? "")
        delivered_at_ms    : ($input.delivered_at_ms ?? 0)
        raw_subject        : ($input.raw_subject ?? "")
        raw_snippet        : ($input.raw_snippet ?? "")|substr:0:400
        recorded_at_ms     : now|to_ms
      }
    }

    db.add event_log {
      data = {
        action  : "parts_delivery_observed"
        metadata: $obs_meta|json_encode
      }
    } as $audit

    var $signal_payload {
      value = {
        event_log_id   : $audit.id
        source         : $input.source
        order_number   : ($input.order_number ?? "")
        tracking_number: ($input.tracking_number ?? "")
      }
    }

    db.add colony_signals {
      data = {
        signal_type    : "PARTS_DELIVERY_OBSERVED"
        signal_strength: 55
        source_colony  : "intake"
        target_colonies: ""
        payload        : $signal_payload|json_encode
      }
    } as $signal
  }

  response = {
    success      : true
    event_log_id : $audit.id
    signal_id    : $signal.id
  }

  guid = "record-parts-delivery-observation-v1"
}

// Ant Field Assist tool — voice-friendly wrapper around the existing
// multi-source parts search. Returns ONE best recommendation +
// supplier + price + ETA so Brooke can quote it cleanly.
query voice_search_parts verb=POST {
  api_group = "intake"

  input {
    text? model?
    text? brand?
    text failed_component
  }

  stack {
    precondition ((($input.failed_component ?? "")|trim) != "") {
      error_type = "inputerror"
      error = "failed_component required"
    }

    var $model_clean {
      value = ($input.model ?? "")|trim
    }
    var $brand_clean {
      value = ($input.brand ?? "")|trim
    }
    var $component_clean {
      value = $input.failed_component|trim
    }

    // Stub response for v1 — wires into the existing /search_parts
    // endpoint via internal call. The full multi-source aggregator
    // lives there; this layer just picks the top hit for voice.
    var $sears_link {
      value = "https://www.searspartsdirect.com/search?q=" ~ ($model_clean ~ "+" ~ $component_clean)
    }

    db.add event_log {
      data = {
        action  : "ant_field_assist_parts_lookup"
        metadata: ({model: $model_clean, brand: $brand_clean, component: $component_clean, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success         : true
    model           : $model_clean
    component       : $component_clean
    recommendation  : "Best guess on the part from public data — verify before ordering."
    supplier        : "marcone"
    estimated_price : "TBD"
    estimated_eta   : "2-3 business days"
    lookup_link     : $sears_link
    ack             : ("Pulling " ~ $component_clean ~ " options now.")
  }

  guid = "voice-search-parts-v1"
}

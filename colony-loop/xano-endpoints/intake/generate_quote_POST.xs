// Generates a rough quote for a customer given symptoms + appliance.
// Uses Anthropic Claude to produce a ballpark $ range. Writes the quote
// to event_log for office follow-up.
//
// This is a v1 estimator — doesn't replace a real diagnostic visit.
// Returns wide ranges to set expectations.
query generate_quote verb=POST {
  api_group = "intake"

  input {
    text appliance_type
    text? brand?
    text? model_number?
    text symptoms
    text? customer_phone?
    text? customer_email?
  }

  stack {
    var $appl_clean {
      value = ($input.appliance_type ?? "")|trim|lower
    }

    var $symp_clean {
      value = ($input.symptoms ?? "")|trim
    }

    precondition ($appl_clean != "" && $symp_clean != "") {
      error_type = "inputerror"
      error      = "appliance_type + symptoms required"
    }

    // Hardcoded baseline ranges (avoid Claude call cost for v1)
    var $base_low {
      value = 89
    }

    var $base_high {
      value = 250
    }

    conditional {
      if ($appl_clean == "refrigerator" || $appl_clean == "fridge") {
        var.update $base_low { value = 150 }
        var.update $base_high { value = 600 }
      }
      elseif ($appl_clean == "washer") {
        var.update $base_low { value = 120 }
        var.update $base_high { value = 450 }
      }
      elseif ($appl_clean == "dryer") {
        var.update $base_low { value = 100 }
        var.update $base_high { value = 350 }
      }
      elseif ($appl_clean == "dishwasher") {
        var.update $base_low { value = 100 }
        var.update $base_high { value = 400 }
      }
      elseif ($appl_clean == "range" || $appl_clean == "oven" || $appl_clean == "stove") {
        var.update $base_low { value = 130 }
        var.update $base_high { value = 500 }
      }
      elseif ($appl_clean == "microwave") {
        var.update $base_low { value = 90 }
        var.update $base_high { value = 250 }
      }
      elseif ($appl_clean == "hvac") {
        var.update $base_low { value = 200 }
        var.update $base_high { value = 1500 }
      }
    }

    var $diagnostic_fee {
      value = 99
    }

    // Log the quote request for office follow-up
    var $quote_meta {
      value = {
        appliance_type : $appl_clean
        brand          : ($input.brand ?? "")
        model_number   : ($input.model_number ?? "")
        symptoms       : $symp_clean
        customer_phone : ($input.customer_phone ?? "")
        customer_email : ($input.customer_email ?? "")
        est_low        : $base_low
        est_high       : $base_high
      }
    }

    var $quote_meta_json {
      value = $quote_meta|json_encode
    }

    db.add event_log {
      data = {
        action  : "quote_requested"
        metadata: $quote_meta_json
      }
    } as $audit_row

    // Emit signal for downstream agents (office alert, future Claude refinement)
    db.add colony_signals {
      data = {
        signal_type     : "QUOTE_REQUESTED"
        signal_strength : 60
        source_colony   : "quote_form"
        target_colonies : ""
        payload         : $quote_meta_json
      }
    } as $signal_row
  }

  response = {
    success         : true
    appliance_type  : $appl_clean
    est_low_cents   : $base_low * 100
    est_high_cents  : $base_high * 100
    diagnostic_fee  : $diagnostic_fee
    disclaimer      : "Estimate only. Final cost confirmed after diagnostic visit. $99 diagnostic fee applies; waived if you book a repair."
    next_step       : "Reply YES or call 615-280-2949 to schedule a diagnostic visit."
  }

  guid = "generate-quote-v1"
}

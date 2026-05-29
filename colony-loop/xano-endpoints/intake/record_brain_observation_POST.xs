// Writes a cross-brain observation that other brains can read about the
// same entity (customer / job / tech / warranty_company). The shared
// context bus that lets Tech Assist's discovery inform Scheduler's
// reschedule, Customer Ant's tone inform Office Ant's escalation, etc.
//
// Examples:
//   - Tech Assist sees customer is angry → writes observation
//     {entity_type:"customer", entity_id:42, observation:"customer
//     hostile about reschedule from yesterday", weight:high}
//   - Scheduler sees tech is running 90min behind → writes observation
//     {entity_type:"tech", entity_id:2, observation:"running 90min late
//     today, schedule needs lookahead", weight:medium}
//   - Office sees warranty company changed approval format →
//     {entity_type:"warranty_company", entity_id:"AHS", observation:
//     "rejection rate spiked this week — they want serial number now"}
//
// Stored as event_log action="brain_observation". Cheap retrieval via
// substring match on metadata.
query record_brain_observation verb=POST {
  api_group = "intake"

  input {
    text source_brain filters=trim       // "tech_assist" | "office" | "customer" | "scheduler" | "website"
    text entity_type filters=trim        // "customer" | "job" | "tech" | "warranty_company"
    text entity_id filters=trim          // stringified id (so AHS / Frontdoor work too)
    text observation filters=trim        // plain-text observation
    text? weight?                        // "low" | "medium" | "high" — default "medium"
    text? topic?                         // freeform tag e.g. "tone" | "schedule_pressure" | "vendor_quirk"
    int? expires_at_ms?                  // optional auto-stale time; 0 = never
  }

  stack {
    precondition ($input.source_brain != "" && $input.entity_type != "" && $input.entity_id != "" && $input.observation != "") {
      error_type = "inputerror"
      error      = "source_brain + entity_type + entity_id + observation required"
    }

    var $weight {
      value = ($input.weight ?? "medium")
    }
    var $allowed_weights {
      value = ["low", "medium", "high"]
    }
    precondition ($weight in $allowed_weights) {
      error_type = "inputerror"
      error      = "weight must be low / medium / high"
    }

    var $meta {
      value = {
        source_brain   : $input.source_brain
        entity_type    : $input.entity_type
        entity_id      : $input.entity_id
        observation    : ($input.observation|substr:0:500)
        weight         : $weight
        topic          : ($input.topic ?? "")
        expires_at_ms  : ($input.expires_at_ms ?? 0)
        recorded_at_ms : now|to_ms
      }
    }

    db.add event_log {
      data = {
        action  : "brain_observation"
        metadata: $meta|json_encode
      }
    } as $row
  }

  response = {
    success      : true
    event_log_id : $row.id
  }

  guid = "record-brain-observation-v1"
}

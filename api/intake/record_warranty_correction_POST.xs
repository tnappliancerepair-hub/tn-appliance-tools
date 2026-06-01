//  Danielle (or any reviewer) flags a gap in the warranty checklist after
//  trying to submit a claim. Each correction becomes a data point feeding
//  the nightly warranty_learning_aggregator which detects patterns
//  (3+ corrections about the same gap = propose adding it to the
//  required list for that vendor).
// 
//  Persists as an event_log row. No new table needed.
// 
//  Inputs:
//    warranty_company  — e.g. "ahs", "frontdoor"
//    correction_type   — "missing_field", "missing_photo", "wrong_value",
//                        "rejected_by_portal", "extra_required"
//    item_key          — internal key, e.g. "failed_component", "model_tag"
//    item_type         — "field", "photo", "video" (optional)
//    field_or_subject  — TDR column name (for fields) OR subject tag (for photos)
//    notes             — free-text context from reviewer
//    job_id            — optional, when correction is tied to a specific job
//    reviewed_by_user_id — optional, who flagged it
query record_warranty_correction verb=POST {
  api_group = "intake"

  input {
    text warranty_company filters=trim
    text correction_type filters=trim
    text item_key filters=trim
    text? item_type?
    text? field_or_subject?
    text? notes?
    int? job_id?
    int? reviewed_by_user_id?
  }

  stack {
    precondition ($input.warranty_company != "" && $input.correction_type != "" && $input.item_key != "") {
      error_type = "inputerror"
      error = "warranty_company, correction_type, and item_key are required"
    }
  
    var $vendor_norm {
      value = ($input.warranty_company|to_lower)|replace:" ":""
    }
  
    var $meta {
      value = {
        warranty_company   : $vendor_norm
        correction_type    : $input.correction_type
        item_key           : $input.item_key
        item_type          : ($input.item_type ?? "")
        field_or_subject   : ($input.field_or_subject ?? "")
        notes              : ($input.notes ?? "")
        job_id             : ($input.job_id ?? 0)
        reviewed_by_user_id: ($input.reviewed_by_user_id ?? 0)
        recorded_at_ms     : now|to_ms
      }
    }
  
    db.add event_log {
      data = {
        action  : "warranty_correction"
        metadata: $meta|json_encode
      }
    } as $row
  }

  response = {
    success         : true
    event_log_id    : $row.id
    warranty_company: $vendor_norm
    correction_type : $input.correction_type
    item_key        : $input.item_key
    recorded_at_ms  : now|to_ms
  }

  guid = "record-warranty-correction-v1"
}
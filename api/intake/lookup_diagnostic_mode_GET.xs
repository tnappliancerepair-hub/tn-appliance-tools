// Brooke (or any agent) queries the model_intelligence corpus for
// diagnostic mode entry + test cycles + error code refs filtered by
// brand and appliance type. Returns the best matches so she can read
// the button sequence aloud to the tech.
query lookup_diagnostic_mode verb=GET {
  api_group = "intake"

  input {
    text? brand?
    text? appliance_category?
    text? model_pattern?
    int? limit?
  }

  stack {
    var $brand_clean { value = (($input.brand ?? "")|lower)|trim }
    var $cat_clean { value = (($input.appliance_category ?? "")|lower)|trim }
    var $model_clean { value = (($input.model_pattern ?? "")|lower)|trim }
    var $limit_clean { value = ($input.limit ?? 10) }

    db.query model_intelligence {
      where = ($db.model_intelligence.finding_type == "diagnostic_mode_entry" || $db.model_intelligence.finding_type == "diagnostic_mode_exit" || $db.model_intelligence.finding_type == "test_cycle" || $db.model_intelligence.finding_type == "error_code_reference") && ($db.model_intelligence.appliance_brand == $brand_clean || $db.model_intelligence.appliance_category == $cat_clean)
      sort = {model_intelligence.relevance_score: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $rows

    var $findings { value = ($rows.items ?? []) }
    var $count { value = ($findings|length) }
  }

  response = {
    success            : true
    brand              : $brand_clean
    appliance_category : $cat_clean
    findings           : $findings
    count              : $count
  }

  guid = "lookup-diagnostic-mode-v1"
}

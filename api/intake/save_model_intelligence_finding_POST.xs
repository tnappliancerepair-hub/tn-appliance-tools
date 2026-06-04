// Scout agent writes a single finding to the model_intelligence
// corpus. Each finding is an actionable piece of intel a tech can use
// in the field — service bulletin, common failure, repair tip, etc.
query save_model_intelligence_finding verb=POST {
  api_group = "intake"

  input {
    text? appliance_model?
    text? appliance_brand?
    text? appliance_category?
    text finding_type
    text? source_url?
    text? source_name?
    text? title?
    text summary
    int? relevance_score?
    int? scraped_at_ms?
    text? scout_agent?
  }

  stack {
    precondition (($input.summary ?? "")|trim != "") {
      error_type = "inputerror"
      error = "summary required"
    }
    precondition (($input.finding_type ?? "")|trim != "") {
      error_type = "inputerror"
      error = "finding_type required"
    }

    db.add model_intelligence {
      data = {
        appliance_model    : ($input.appliance_model ?? "")
        appliance_brand    : ($input.appliance_brand ?? "")
        appliance_category : ($input.appliance_category ?? "")
        finding_type       : $input.finding_type
        source_url         : ($input.source_url ?? "")
        source_name        : ($input.source_name ?? "")
        title              : ($input.title ?? "")
        summary            : $input.summary
        relevance_score    : ($input.relevance_score ?? 50)
        scraped_at_ms      : ($input.scraped_at_ms ?? (now|to_ms))
        scout_agent        : ($input.scout_agent ?? "")
      }
    } as $row
  }

  response = {
    success: true
    id     : $row.id
  }

  guid = "save-model-intelligence-finding-v1"
}

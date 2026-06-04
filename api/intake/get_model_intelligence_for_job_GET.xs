// Surface model_intelligence findings for a specific job's appliance.
// Called by Ant Field Assist + diagnose_* agents to inject scout army
// findings into the tech's brief. Returns top-N by relevance, filtered
// by brand + category match.
query get_model_intelligence_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
    int? limit?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $brand_clean {
      value = (($job.appliance_brand ?? "")|to_lowercase)|trim
    }
    var $type_clean {
      value = (($job.appliance_type ?? "")|to_lowercase)|trim
    }
    var $limit_clean {
      value = ($input.limit ?? 10)
    }

    db.query model_intelligence {
      where = $db.model_intelligence.appliance_category == $type_clean || $db.model_intelligence.appliance_brand == $brand_clean
      sort  = {model_intelligence.relevance_score: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $rows

    var $findings { value = ($rows.items ?? []) }
  }

  response = {
    success         : true
    job_id          : $input.job_id
    appliance_brand : $brand_clean
    appliance_type  : $type_clean
    findings        : $findings
    findings_count  : ($findings|length)
  }

  guid = "get-model-intelligence-for-job-v1"
}

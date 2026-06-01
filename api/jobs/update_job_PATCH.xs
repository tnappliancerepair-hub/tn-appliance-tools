// update job details
query update_job verb=PATCH {
  api_group = "jobs"
  auth = "user"

  input {
    int id
    text appliance_type? filters=trim
    text brand? filters=trim
    text model_number? filters=trim
    text serial_number? filters=trim
    text problem_summary? filters=trim
    text notes_internal? filters=trim
    text recommended_service? filters=trim
    text job_type? filters=trim
    text service_eta_window? filters=trim
  }

  stack {
    db.edit jobs {
      field_name = "id"
      field_value = $input.id
      data = {
        problem_summary   : $input.problem_summary
        appliance_type    : $input.appliance_type
        brand             : $input.brand
        model_number      : $input.model_number
        service_eta_window: $input.service_eta_window
        warranty_company  : "warranty_company"
        claim_number      : "claim_number"
        serial_number     : $input.serial_number
        notes_internal    : $input.notes_internal
        job_type          : $input.job_type
      }
    } as $jobs1
  }

  response = $jobs1
  guid = "Ms-UKZ2VKJSmr3Xcpm4ALGRX6bY"
}
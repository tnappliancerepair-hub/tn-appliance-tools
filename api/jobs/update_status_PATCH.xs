query update_status verb=PATCH {
  api_group = "jobs"
  auth = "user"

  input {
    // Job ID from path parameter
    int id
  
    // Overall status of the job
    text job_status filters=trim
  
    // Status of the job triage process
    text triage_status? filters=trim
  
    // Status of parts required for the job
    text parts_status? filters=trim
  
    // Status of the job's scheduling
    text scheduling_status? filters=trim
  }

  stack {
    // Retrieve the existing job to preserve optional fields if they are not provided in the input
    db.get jobs {
      field_name = "id"
      field_value = $input.id
    } as $job
  
    // Update the job record with the provided statuses
    db.edit jobs {
      field_name = "id"
      field_value = $input.id
      data = {
        job_status       : $input.job_status
        triage_status    : $input.triage_status || $job.triage_status
        parts_status     : $input.parts_status || $job.parts_status
        scheduling_status: $input.scheduling_status || $job.scheduling_status
      }
    } as $updated_job
  }

  response = $updated_job
  guid = "TKVaDNivVqEFSbiRFEfmFeWM8CU"
}
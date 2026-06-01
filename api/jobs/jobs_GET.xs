// Retrieve a list of jobs with optional filtering
query jobs verb=GET {
  api_group = "jobs"

  input {
    // Filter by job status
    text job_status? filters=trim
  
    // Filter by technician ID
    int technician_id?
  
    // Filter by customer ID
    int customer_id?
  
    // Filter by triage status
    text triage_status? filters=trim
  
    // Filter by scheduling status
    text scheduling_status? filters=trim
  }

  stack {
    // Query jobs table with optional filters, ignoring null inputs
    // Query jobs with optional filters
    db.query jobs {
      where = $db.jobs.job_status ==? $input.job_status && $db.jobs.technician_id ==? $input.technician_id && $db.jobs.customer_id ==? $input.customer_id && $db.jobs.triage_status ==? $input.triage_status && $db.jobs.scheduling_status ==? $input.scheduling_status
      sort = {jobs.created_at: "desc"}
      return = {type: "list"}
    } as $jobs
  }

  response = $jobs
  guid = "J-TRFP7j4mq9og7WVG1a8FTPJ40"
}
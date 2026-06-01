// Retrieve financial records for a specific job
query job_financials verb=GET {
  api_group = "jobs"

  input {
    // The job ID from the path
    int id
  }

  stack {
    // Retrieve records from the job_financial table matching the job_id
    db.query job_financial {
      where = $db.job_financial.job_id == $input.id
      return = {type: "list"}
    } as $financial_records
  }

  response = $financial_records
  guid = "VLqMouXKXe5imUVxz0luJY4GZX0"
}
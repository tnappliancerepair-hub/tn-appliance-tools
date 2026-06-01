// Retrieve a single job by its ID
query get_job verb=GET {
  api_group = "intake"

  input {
    // The ID of the job to retrieve
    int job_id
  }

  stack {
    // Fetch a single record from the jobs table using the job_id input
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  }

  response = $job
  guid = "JcexhwUsawfpnlLB1DtiKoSHXfY"
}
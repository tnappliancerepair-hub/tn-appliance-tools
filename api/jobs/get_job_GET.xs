// Retrieves a single job record by its ID.
query get_job verb=GET {
  api_group = "jobs"

  input {
    // The ID of the job to retrieve
    int id
  }

  stack {
    // Retrieve the job record from the database
    db.get jobs {
      field_name = "id"
      field_value = $input.id
    } as $job
  }

  response = $job
  guid = "wjKNtwzL6tdGBGlgnVwrRvXaG3Q"
}
// Deletes a job record from the database.
query jobs verb=DELETE {
  api_group = "jobs"

  input {
    // The ID of the job to delete
    int id
  }

  stack {
    // Delete the record from the jobs table
    db.del jobs {
      field_name = "id"
      field_value = $input.id
    }
  
    // Create a success message object
    var $result {
      value = {success: true, message: "Job deleted successfully."}
    }
  }

  response = $result
  guid = "iWsk45jyrSZxHzOeFdaTtdJOl7U"
}
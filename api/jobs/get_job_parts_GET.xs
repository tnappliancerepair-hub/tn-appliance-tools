// Retrieves a list of part orders for a specific job ID
query get_job_parts verb=GET {
  api_group = "jobs"

  input {
    // The ID of the job to retrieve parts for
    // Job ID
    int id
  }

  stack {
    // Retrieve part orders associated with the provided job ID
    db.query part_order {
      where = $db.part_order.job_id == $input.id
      return = {type: "list"}
    } as $part_orders
  }

  response = $part_orders
  guid = "ut-34KSwQ94CwYJ-QD1dN7SqQBU"
}
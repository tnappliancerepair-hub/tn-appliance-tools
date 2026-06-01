// Triggers an outbound Vapi call for parts followup.
// Return the result from the function call.
query trigger_parts_followup verb=POST {
  api_group = "intake"

  input {
    // ID of the job to trigger followup for.
    int job_id
  }

  stack {
    // Call the shared function to trigger the parts followup.
    function.run trigger_parts_followup {
      input = {job_id: $input.job_id}
    } as $result
  }

  response = $result
  guid = "MIUqpMpQdWEezi6xW_6IEMuBqlE"
}
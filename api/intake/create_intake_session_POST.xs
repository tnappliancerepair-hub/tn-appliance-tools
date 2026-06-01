query create_intake_session verb=POST {
  api_group = "intake"

  input {
    text first_name
    text last_name
    text phone
    text email
    text appliance_type
    text problem_summary
  }

  stack {
    // Create a new intake session without the removed fields
    db.add intake_session {
      data = {
        first_name     : $input.first_name
        last_name      : $input.last_name
        phone          : $input.phone
        email          : $input.email
        appliance_type : $input.appliance_type
        problem_summary: $input.problem_summary
      }
    } as $new_session
  }

  response = $new_session
  guid = "ghWZYuBAzXIbvyPixQPYS5RIvgE"
}
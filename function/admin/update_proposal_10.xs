// Admin function to update agent proposal row 10
// Created at user request to update proposal details
// Updates agent proposal row 10
function "admin/update_proposal_10" {
  input {
  }

  stack {
    // Fetch the proposal to ensure it exists
    db.get agent_proposals {
      field_name = "id"
      field_value = 10
    } as $proposal
  
    // Ensure the record was found
    precondition ($proposal != null) {
      error_type = "notfound"
      error = "Proposal with ID 10 not found"
    }
  
    // Update the proposal record
    db.edit agent_proposals {
      field_name = "id"
      field_value = 10
      data = {
        description        : "Auto-notify tech via SMS when a scheduling gap opens and a flexible customer is available nearby"
        trigger            : "job.prediagnosis_pending AND scheduling_gap_detected"
        condition_detected : "jobs where scheduling_status = gap_open AND customer_flexibility_score >= 7"
        proposed_action    : "Daily cron: query flexible customers near open gap, broadcast SMS to top 3 candidates, first reply gets the slot"
        time_saved_estimate: "2 hours per week of manual gap-filling"
        status             : "approved"
      }
    } as $updated_proposal
  }

  response = $updated_proposal
  guid = "ohDtS8mc_Pabbel2b3Myfrn0KjU"
}
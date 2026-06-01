// Disposition handler for a single agent proposal. Called by
// agent-proposals.html when Teddy hits "Build It" or "Skip" on a card.
// Accepted statuses: pending, approved, skipped, shipped, rejected.
// Audit logs prior + new status to event_log for the workflow_watcher
// feedback loop (proposals that get approved teach the builder what
// patterns matter to Teddy).
query update_agent_proposal_status verb=POST {
  api_group = "intake"

  input {
    int proposal_id
    text new_status
  }

  stack {
    db.get agent_proposals {
      field_name = "id"
      field_value = $input.proposal_id
    } as $proposal
  
    conditional {
      if ($proposal == null) {
        return {
          value = {success: false, error: "proposal not found"}
        }
      }
    }
  
    var $trimmed_status {
      value = (($input.new_status ?? "")|trim)
    }
  
    var $valid_status {
      value = false
    }
  
    conditional {
      if ($trimmed_status == "pending" || $trimmed_status == "approved" || $trimmed_status == "skipped" || $trimmed_status == "shipped" || $trimmed_status == "rejected") {
        var.update $valid_status {
          value = true
        }
      }
    }
  
    conditional {
      if ($valid_status == false) {
        return {
          value = {success: false, error: "invalid status value"}
        }
      }
    }
  
    var $prior_status {
      value = ($proposal.status ?? "")
    }
  
    db.edit agent_proposals {
      field_name = "id"
      field_value = $input.proposal_id
      data = {status: $trimmed_status}
    } as $updated
  
    db.add event_log {
      data = {
        action  : "agent_proposal_status_changed"
        metadata: {
        proposal_id   : $input.proposal_id
        prior_status  : $prior_status
        new_status    : $trimmed_status
        description   : ($proposal.description ?? "")
        source_builder: ($proposal.source_builder ?? "")
      }
      }
    } as $log
  }

  response = {
    success    : true
    proposal_id: $input.proposal_id
    new_status : $trimmed_status
  }

  guid = "f4PGL8Z51sQE7t_xyRK7RlZy2ZY"
}
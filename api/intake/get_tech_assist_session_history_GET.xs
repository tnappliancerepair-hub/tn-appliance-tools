// Phase 1c. Returns the recent agent_message rows for a tech_assist_session,
// keyed by assist_session_id. Used by tech-ant-live.html to pre-load the
// conversation transcript after PIN unlock so the tech sees the SMS opening
// message + any prior chat turns when they open the web view.
query get_tech_assist_session_history verb=GET {
  api_group = "intake"

  input {
    int? session_id?
    int? job_id?
    int? technician_id?
    int? limit?
  }

  stack {
    // Resolve session. Prefer session_id; fall back to (job_id, technician_id)
    // active/awaiting_completion lookup so the SMS link (no session_id) works.
    var $session {
      value = null
    }
  
    conditional {
      if ($input.session_id != null && $input.session_id > 0) {
        db.get tech_assist_session {
          field_name = "id"
          field_value = $input.session_id
        } as $session
      }
    
      else {
        conditional {
          if ($input.job_id != null && $input.job_id > 0 && $input.technician_id != null && $input.technician_id > 0) {
            db.query tech_assist_session {
              where = $db.tech_assist_session.job_id == $input.job_id && $db.tech_assist_session.technician_id == $input.technician_id && ($db.tech_assist_session.status == "active" || $db.tech_assist_session.status == "awaiting_completion")
              sort = {tech_assist_session.created_at: "desc"}
              return = {type: "single"}
            } as $session
          }
        }
      }
    }
  
    conditional {
      if ($session == null) {
        return {
          value = {
            success: false
            error  : "session not found - provide session_id or (job_id, technician_id)"
          }
        }
      }
    }
  
    // Find conversation linked to this session.
    db.query agent_conversation {
      where = $db.agent_conversation.assist_session_id == $session.id
      return = {type: "single"}
    } as $conv
  
    conditional {
      if ($conv == null) {
        return {
          value = {
            success        : true
            session_id     : $session.id
            conversation_id: 0
            messages       : []
          }
        }
      }
    }
  
    // Cap the limit. Hoist input + clamp.
    var $limit_in {
      value = ($input.limit ?? 20)
    }
  
    var $limit_clamped {
      value = ($limit_in > 0 && $limit_in <= 100) ? $limit_in : 20
    }
  
    // Pull last N messages (sorted desc, then reversed for chronological output).
    db.query agent_message {
      where = $db.agent_message.conversation_id == $conv.id
      sort = {agent_message.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $limit_clamped}}
    } as $msgs_desc
  
    var $messages {
      value = $msgs_desc.items|reverse
    }
  }

  response = {
    success        : true
    session_id     : $session.id
    conversation_id: $conv.id
    messages       : $messages
  }

  guid = "PmKRzYMwQVmFNuOuJfl8kt0440Q"
}
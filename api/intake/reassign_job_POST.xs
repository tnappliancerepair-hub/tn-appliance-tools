// Reassigns a job to a different tech. Called by the office Reassign modal.
// Validates that the target tech exists. Does NOT auto-SMS the new tech (v1).
query reassign_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job not found"}
        }
      }
    }
  
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech
  
    conditional {
      if ($tech == null) {
        return {
          value = {success: false, error: "tech not found"}
        }
      }
    }
  
    var $prior_tech_id {
      value = ($job.technician_id ?? 0)
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {technician_id: $input.technician_id}
    } as $updated
  
    db.add event_log {
      data = {
        action  : "job_reassigned"
        metadata: {
        job_id       : $input.job_id
        prior_tech_id: $prior_tech_id
        new_tech_id  : $input.technician_id
      }
      }
    } as $log
  
    // Emit TECH_ASSIGNED so the existing colony loop tech_assigned.js agent
    // SMSes the new tech with customer + address + appliance + problem +
    // tech-ant-live link. Skip when the no-op edit (same tech) is performed;
    // agent dedup also guards but producer-side filter avoids the loop hop.
    conditional {
      if ($prior_tech_id != $input.technician_id) {
        var $ta_reassign_payload_obj {
          value = {
            job_id             : $input.job_id
            technician_id      : $input.technician_id
            prior_technician_id: $prior_tech_id
            source             : "office_reassign"
            scheduled_start_ms : ($job.scheduled_start ?? 0)
          }
        }
      
        var $ta_reassign_payload_str {
          value = $ta_reassign_payload_obj|json_encode
        }
      
        db.add colony_signals {
          data = {
            signal_type    : "TECH_ASSIGNED"
            signal_strength: 65
            source_colony  : ""
            target_colonies: ""
            payload        : $ta_reassign_payload_str
          }
        } as $ta_reassign_signal
      
        db.add event_log {
          data = {
            action  : "tech_assigned_signal_emitted"
            metadata: {
            job_id             : $input.job_id
            signal_id          : $ta_reassign_signal.id
            technician_id      : $input.technician_id
            prior_technician_id: $prior_tech_id
            source             : "office_reassign"
          }
          }
        } as $ta_reassign_log
      }
    }
  }

  response = {success: true, technician_id: $input.technician_id}
  guid = "2VZQi_wAFZmqWWlK7Ca4r9oIR2I"
}
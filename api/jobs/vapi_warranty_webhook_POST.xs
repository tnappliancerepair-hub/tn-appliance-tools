// Receives incoming webhook data from Vapi after a warranty fallback call ends.
query vapi_warranty_webhook verb=POST {
  api_group = "jobs"

  input {
    object call {
      schema {
        text id
        text endedReason?
        timestamp startedAt?
        timestamp endedAt?
        int duration?
        text recordingUrl?
        text transcript?
        object analysis? {
          schema {
            object structuredData? {
              schema {
                text appliance_brand?
                text appliance_model?
                text appliance_age?
                text problem_description?
                text scheduling_preference?
                bool address_confirmed?
                text callback_number?
                bool photos_agreed?
                text call_outcome?
                bool intake_completed?
                text call_summary?
              }
            }
          }
        }
      
        object assistantOverrides? {
          schema {
            object variableValues? {
              schema {
                int job_id?
              }
            }
          }
        }
      }
    }
  }

  stack {
    // 1. Find the job record in the jobs table where vapi_call_id matches call.id
    db.query jobs {
      where = $db.jobs.vapi_call_id == $input.call.id
      return = {type: "single"}
    } as $job
  
    // 2. Process only if a job was found
    conditional {
      if ($job != null) {
        // Prepare the updates for the job record
        var $structuredData {
          value = $input.call.analysis.structuredData ?? {}
        }
      
        var $jobUpdates {
          value = {
            vapi_call_status     : $input.call.endedReason
            vapi_call_ended_at   : $input.call.endedAt
            vapi_call_duration   : $input.call.duration
            vapi_call_recording  : $input.call.recordingUrl
            vapi_call_transcript : $input.call.transcript
            appliance_brand      : $structuredData.appliance_brand
            appliance_model      : $structuredData.appliance_model
            appliance_age        : $structuredData.appliance_age
            problem_description  : $structuredData.problem_description
            scheduling_preference: $structuredData.scheduling_preference
            address_confirmed    : $structuredData.address_confirmed
            callback_number      : $structuredData.callback_number
            photos_agreed        : $structuredData.photos_agreed
            call_outcome         : $structuredData.call_outcome
            intake_source        : "vapi"
          }
        }
      
        // 3. Conditional updates based on intake_completed
        conditional {
          if ($structuredData.intake_completed) {
            var.update $jobUpdates.current_status {
              value = "warranty_intake_complete"
            }
          
            var.update $jobUpdates.triage_status {
              value = "ready_for_triage"
            }
          
            // Create success event
            db.add job_event {
              data = {
                job_id      : $job.id
                event_type  : "vapi_intake_completed"
                event_source: "vapi"
                event_notes : $structuredData.call_summary
              }
            } as $new_event
          }
        
          else {
            var.update $jobUpdates.current_status {
              value = "needs_followup"
            }
          
            var.update $jobUpdates.triage_status {
              value = "needs_review"
            }
          
            // Create failure event
            db.add job_event {
              data = {
                job_id      : $job.id
                event_type  : "vapi_intake_failed"
                event_source: "vapi"
                event_notes : $input.call.endedReason
              }
            } as $new_event
          }
        }
      
        // 4. Update the job record
        db.patch jobs {
          field_name = "id"
          field_value = $job.id
          data = $jobUpdates
        } as $updated_job
      }
    }
  }

  response = {message: "webhook received"}
  guid = "imc6wMHtHFnLnjtSUzxdcki0Nik"
}
// One-shot hydrate endpoint for the Teddy diagnostic cockpit.
query qc_cockpit_load verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    var $bill_to_id {
      value = $job.bill_to_customer_id ?? $job.customer_id
    }
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($bill_to_id != null && $bill_to_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $bill_to_id
        } as $customer_record
      
        var.update $customer {
          value = $customer_record
        }
      }
    }
  
    var $cust_first {
      value = ($customer.first_name ?? "")
    }
  
    var $cust_last {
      value = ($customer.last_name ?? "")
    }
  
    var $cust_full {
      value = ($cust_first ~ " " ~ $cust_last)|trim
    }
  
    var $address_line1 {
      value = ((($job.service_address ?? "")|trim) != "") ? $job.service_address : ($customer.address ?? null)
    }
  
    var $address_city {
      value = ((($job.service_city ?? "")|trim) != "") ? $job.service_city : ($customer.city ?? null)
    }
  
    var $address_state {
      value = ((($job.service_state ?? "")|trim) != "") ? $job.service_state : ($customer.state ?? null)
    }
  
    var $address_zip {
      value = ((($job.service_zip ?? "")|trim) != "") ? $job.service_zip : ($customer.zip ?? null)
    }
  
    var $trs_already_fired {
      value = (($job.teddy_review_started_at ?? 0) > 0)
    }
  
    var $trs_cust_phone_trimmed {
      value = ($customer != null) ? (($customer.phone ?? "")|trim) : ""
    }
  
    var $trs_have_phone {
      value = ($trs_cust_phone_trimmed != "")
    }
  
    conditional {
      if ($trs_already_fired == false && $trs_have_phone) {
        var $trs_appliance_raw {
          value = ($job.appliance_type ?? "")|trim
        }
      
        var $trs_appliance_clause {
          value = ($trs_appliance_raw != "") ? ("your " ~ $trs_appliance_raw ~ " job") : "your appliance job"
        }
      
        var $trs_first_raw {
          value = ($customer.first_name ?? "")|trim
        }
      
        var $trs_first_name {
          value = ($trs_first_raw != "") ? $trs_first_raw : "there"
        }
      
        var $trs_sms_body {
          value = "Hey " ~ $trs_first_name ~ ", Teddy just opened " ~ $trs_appliance_clause ~ " and is reviewing the photos and video now. He'll have a diagnosis for you usually within a few hours."
        }
      
        db.edit jobs {
          field_name = "id"
          field_value = $job.id
          data = {teddy_review_started_at: now}
        } as $trs_marked
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $customer.phone, message: $trs_sms_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $trs_sms_resp
      
        db.add event_log {
          data = {
            action  : "teddy_review_started_sms_triggered"
            metadata: {
            job_id      : $job.id
            customer_id : ($customer.id ?? null)
            recipient   : $customer.phone
            appliance   : $trs_appliance_raw
            body_preview: $trs_sms_body|substr:0:200
            sms_response: ($trs_sms_resp.response.result ?? {})
            call_site   : "qc_cockpit_load_GET.xs:trs_trigger"
          }
          }
        } as $trs_event_log
      }
    }
  
    var $existing_tdr {
      value = null
    }
  
    conditional {
      if ($job.technician_decision_report_id != null && $job.technician_decision_report_id > 0) {
        db.get technician_decision_report {
          field_name = "id"
          field_value = $job.technician_decision_report_id
        } as $tdr_record
      
        conditional {
          if ($tdr_record != null) {
            var.update $existing_tdr {
              value = {
                id         : $tdr_record.id
                status     : ($tdr_record.status ?? "")
                created_at : ($tdr_record.created_at ?? null)
                report_date: ($tdr_record.report_date ?? null)
              }
            }
          }
        }
      }
    }
  
    // ALL TDRs for this job, oldest-first, with author first/last name +
    // parts_used JSON. Used by teddy-tdr-tool.html "Previous Attempts"
    // timeline so Teddy and every tech can see what's been tried before
    // diagnosing anything new — eliminates duplicate parts ordering.
    db.query technician_decision_report {
      where  = $db.technician_decision_report.job_id == $input.job_id
      sort   = {technician_decision_report.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $all_tdrs_query

    var $all_tdrs {
      value = []
    }

    foreach ($all_tdrs_query.items) {
      each as $t {
        var $author_first { value = "" }
        var $author_last { value = "" }
        conditional {
          if ($t.technician_id != null && $t.technician_id > 0) {
            db.get technicians {
              field_name  = "id"
              field_value = $t.technician_id
            } as $tdr_author
            var.update $author_first {
              value = (($tdr_author.first_name ?? "")|trim)
            }
            var.update $author_last {
              value = (($tdr_author.last_name ?? "")|trim)
            }
          }
        }
        array.push $all_tdrs {
          value = {
            id                       : $t.id
            technician_id            : ($t.technician_id ?? null)
            technician_first_name    : $author_first
            technician_last_name     : $author_last
            diagnosis                : ($t.diagnosis ?? null)
            failure_cause            : ($t.failure_cause ?? null)
            failed_component         : ($t.failed_component ?? null)
            verified_part_number     : ($t.verified_part_number ?? null)
            parts_used               : ($t.parts_used ?? null)
            labor_time_hours         : ($t.labor_time_hours ?? null)
            repair_completed         : ($t.repair_completed ?? null)
            technician_notes         : ($t.technician_notes ?? null)
            status                   : ($t.status ?? null)
            report_date              : ($t.report_date ?? null)
            created_at               : $t.created_at
          }
        }
      }
    }

    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id
      sort = {created_at: "desc"}
      return = {type: "list"}
    } as $attachment_rows
  
    var $s3_keys {
      value = []
    }
  
    foreach ($attachment_rows) {
      each as $a {
        var.update $s3_keys {
          value = $s3_keys|push:$a.s3_key
        }
      }
    }
  
    var $signed_arr {
      value = []
    }
  
    conditional {
      if (($s3_keys|count) > 0) {
        api.request {
          url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/s3-view-url"
          method = "POST"
          params = {s3_keys: $s3_keys}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sign_resp
      
        var.update $signed_arr {
          value = ($sign_resp.response.result.signed_urls ?? [])
        }
      }
    }
  
    var $attachments_out {
      value = []
    }
  
    foreach ($attachment_rows) {
      each as $a {
        var $url {
          value = ""
        }
      
        foreach ($signed_arr) {
          each as $sg {
            conditional {
              if ($sg.s3_key == $a.s3_key) {
                var.update $url {
                  value = ($sg.view_url ?? "")
                }
              }
            }
          }
        }
      
        var $att_obj {
          value = {
            id               : $a.id
            file_type        : $a.file_type
            attachment_type  : $a.attachment_type
            s3_key           : $a.s3_key
            signed_view_url  : $url
            original_filename: ($a.original_filename ?? "")
            caption          : ($a.caption ?? "")
            created_at       : $a.created_at
          }
        }
      
        var.update $attachments_out {
          value = $attachments_out|push:$att_obj
        }
      }
    }
  
    // Wire 3: load Ant conversation history for this customer.
    var $ant_messages {
      value = []
    }
  
    conditional {
      if ($job.customer_id != null) {
        db.query agent_conversation {
          where = $db.agent_conversation.customer_id == $job.customer_id
          sort = {agent_conversation.created_at: "desc"}
          return = {type: "single"}
        } as $ant_conversation
      
        conditional {
          if ($ant_conversation != null) {
            db.query agent_message {
              where = $db.agent_message.conversation_id == $ant_conversation.id
              sort = {agent_message.created_at: "asc"}
              return = {type: "list", paging: {page: 1, per_page: 50}}
            } as $ant_msg_results
          
            var.update $ant_messages {
              value = $ant_msg_results.items
            }
          }
        }
      }
    }
  
    var $resp {
      value = {
        success         : true
        job             : {
          id: $job.id
          customer_type: ($job.customer_type ?? "")
          source_type: ($job.source_type ?? "")
          qc_status: ($job.qc_status ?? null)
          scheduling_status: ($job.scheduling_status ?? null)
          pre_diagnosis_complete: ($job.pre_diagnosis_complete ?? false)
          current_status: ($job.current_status ?? "")
          friendly_status: ($job.friendly_status ?? "")
          job_status: ($job.job_status ?? "")
          payment_status: ($job.payment_status ?? "")
          created_at: $job.created_at
          housecall_pro_job_id: ($job.housecall_pro_job_id ?? "")
          technician_decision_report_id: ($job.technician_decision_report_id ?? null)
          warranty_company: ($job.warranty_company ?? "")
          claim_number: ($job.claim_number ?? "")
          sms_consent: ($job.sms_consent ?? false)
          is_rental: ($job.is_rental ?? false)
          customer_preference_text: ($job.customer_preference_text ?? "")
        }
        appliance       : {
          brand: ($job.brand ?? "")
          appliance_type: ($job.appliance_type ?? "")
          model_number: ($job.model_number ?? "")
          serial_number: ($job.serial_number ?? "")
          problem_summary: ($job.problem_summary ?? "")
          problem_description: ($job.problem_description ?? "")
          appliance_age: ($job.appliance_age ?? "")
        }
        customer        : {
          id: ($customer.id ?? null)
          first_name: $cust_first
          last_name: $cust_last
          full_name: $cust_full
          phone: ($customer.phone ?? "")
          email: ($customer.email ?? "")
          address_line1: $address_line1
          city: $address_city
          state: $address_state
          zip: $address_zip
        }
        attachments     : $attachments_out
        existing_tdr    : $existing_tdr
        all_tdrs        : $all_tdrs
        ant_conversation: $ant_messages
      }
    }
  }

  response = $resp
  guid = "qc-cockpit-load-1g-2026-05-06"
}
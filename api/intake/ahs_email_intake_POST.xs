// AHS / Frontdoor email intake parser -- XML edition.
query ahs_email_intake verb=POST {
  api_group = "intake"

  input {
    text rawXml
    text? gmail_message_id?
    text? gmail_thread_id?
    text? sender?
    text? subject?
    text? test_run_id?
    int? received_at_ms?
  }

  stack {
    precondition ($input.rawXml != null && $input.rawXml != "") {
      error_type = "inputerror"
      error = "rawXml is required"
    }
  
    // ── Forward-only gate (2026-06-02): if PARSER_ACTIVATION_TS_MS env is
    // set and the email's received_at_ms (Gmail message internalDate from
    // the poller) is BEFORE the activation timestamp, treat it as a
    // duplicate-style success so the poller labels it Processed and the
    // backlog is skipped. Default 0 = gate disabled. Default
    // received_at_ms 0 = bypass (legacy callers without that field).
    var $activation_ts {
      value = (($env.PARSER_ACTIVATION_TS_MS ?? "0")|to_int)
    }
  
    var $received_at {
      value = ($input.received_at_ms ?? 0)
    }
  
    conditional {
      if ($activation_ts > 0 && $received_at > 0 && $received_at < $activation_ts) {
        db.add event_log {
          data = {
            action  : "ahs_email_intake_pre_activation"
            metadata: {
            gmail_message_id: ($input.gmail_message_id ?? "")
            activation_ts   : $activation_ts
            received_at_ms  : $received_at
            subject_preview : (($input.subject ?? "")|substr:0:120)
          }
          }
        } as $pre_log
      
        return {
          value = {
            success             : true
            duplicate           : true
            reason              : "pre_activation"
            gmail_message_id    : ($input.gmail_message_id ?? "")
            job_id              : null
            customer_id         : null
            consent_channel_used: null
            resolution          : "skipped — pre PARSER_ACTIVATION_TS_MS"
          }
        }
      }
    }
  
    var $effective_gmail_msg_id {
      value = $input.gmail_message_id ?? ""
    }
  
    db.get job_email_event {
      field_name = "gmail_message_id"
      field_value = $effective_gmail_msg_id
    } as $existing_event
  
    conditional {
      if ($existing_event != null) {
        return {
          value = {
            success             : true
            duplicate           : true
            gmail_message_id    : $effective_gmail_msg_id
            job_id              : ($existing_event.job_id ?? null)
            customer_id         : null
            consent_channel_used: null
            resolution          : "gmail_message_id already in job_email_event"
          }
        }
      }
    }
  
    var $looks_like_ahs_xml {
      value = $input.rawXml|contains:"<VendorDispatch"
    }
  
    conditional {
      if ($looks_like_ahs_xml == false) {
        db.add event_log {
          data = {
            action  : "ahs_email_intake_rejected"
            metadata: {
            reason      : "rawXml does not contain <VendorDispatch> root element"
            body_preview: $input.rawXml|substr:0:300
          }
          }
        } as $log_reject
      
        return {
          value = {
            success             : false
            error               : "not an AHS dispatch XML"
            job_id              : null
            customer_id         : null
            consent_channel_used: null
          }
        }
      }
    }
  
    var $vendor_parts {
      value = $input.rawXml|split:"<Vendor "
    }
  
    var $vendor_tag {
      value = `($vendor_parts|count) > 1 ? ($vendor_parts|get:1|split:">"|get:0) : ""`
    }
  
    var $contract_parts {
      value = $input.rawXml|split:"<Contract "
    }
  
    var $contract_tag {
      value = `($contract_parts|count) > 1 ? ($contract_parts|get:1|split:">"|get:0) : ""`
    }
  
    var $contract_inner {
      value = `($contract_parts|count) > 1 ? ($contract_parts|get:1|split:"</Contract>"|get:0) : ""`
    }
  
    var $cp_parts {
      value = $input.rawXml|split:"<CoveredProperty "
    }
  
    var $cp_tag {
      value = `($cp_parts|count) > 1 ? ($cp_parts|get:1|split:">"|get:0) : ""`
    }
  
    var $cc_parts {
      value = $input.rawXml|split:"<ContractCustomer "
    }
  
    var $cc_parts_count {
      value = $cc_parts|count
    }
  
    var $cc_tag {
      value = ""
    }
  
    conditional {
      if ($cc_parts_count > 1) {
        var.update $cc_tag {
          value = $cc_parts
            |get:1
            |split:">"
            |get:0
        }
      }
    }
  
    var $cc_inner {
      value = `($cc_parts|count) > 1 ? ($cc_parts|get:1|split:"</ContractCustomer>"|get:0) : ""`
    }
  
    var $dl_parts {
      value = $input.rawXml|split:"<DispatchList "
    }
  
    var $dl_tag {
      value = `($dl_parts|count) > 1 ? ($dl_parts|get:1|split:">"|get:0) : ""`
    }
  
    var $dl_inner {
      value = `($dl_parts|count) > 1 ? ($dl_parts|get:1|split:"</DispatchList>"|get:0) : ""`
    }
  
    var $wo_parts {
      value = $dl_inner|split:"<WorkOrderLineList "
    }
  
    var $wo_tag {
      value = `($wo_parts|count) > 1 ? ($wo_parts|get:1|split:">"|get:0) : ""`
    }
  
    var $wo_inner {
      value = `($wo_parts|count) > 1 ? ($wo_parts|get:1|split:"</WorkOrderLineList>"|get:0) : ""`
    }
  
    var $msg_parts {
      value = $input.rawXml|split:"<MessageNotes>"
    }
  
    var $msg_block {
      value = `($msg_parts|count) > 1 ? ($msg_parts|get:1|split:"</MessageNotes>"|get:0) : ""`
    }
  
    var $cov_parts {
      value = $input.rawXml|split:"<CoverageNotes>"
    }
  
    var $cov_block {
      value = `($cov_parts|count) > 1 ? ($cov_parts|get:1|split:"</CoverageNotes>"|get:0|trim) : ""`
    }
  
    var $pvr_parts {
      value = $input.rawXml|split:"<ProductVersionRemarks>"
    }
  
    var $pvr_block {
      value = `($pvr_parts|count) > 1 ? ($pvr_parts|get:1|split:"</ProductVersionRemarks>"|get:0|trim) : ""`
    }
  
    var $vendor_id_parts {
      value = $vendor_tag|split:'Id="'
    }
  
    var $warranty_vendor_id {
      value = `($vendor_id_parts|count) > 1 ? ($vendor_id_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $cefdate_parts {
      value = $contract_tag|split:'ContractEffectiveDate="'
    }
  
    var $cefdate_raw {
      value = `($cefdate_parts|count) > 1 ? ($cefdate_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $contract_effective_date_ts {
      value = ($cefdate_raw != "") ? ($cefdate_raw|to_timestamp) : null
    }
  
    var $formcode_parts {
      value = $contract_tag|split:'FormCode="'
    }
  
    var $warranty_plan_type {
      value = `($formcode_parts|count) > 1 ? ($formcode_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $sn_parts {
      value = $cp_tag|split:'StreetNumber="'
    }
  
    var $street_number_raw {
      value = `($sn_parts|count) > 1 ? ($sn_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $stn_parts {
      value = $cp_tag|split:'StreetName="'
    }
  
    var $street_name_raw {
      value = `($stn_parts|count) > 1 ? ($stn_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $service_address_raw {
      value = ($street_number_raw ~ " " ~ $street_name_raw)|trim
    }
  
    var $city_parts {
      value = $cp_tag|split:'CityName="'
    }
  
    var $service_city_raw {
      value = `($city_parts|count) > 1 ? ($city_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $state_parts {
      value = $cp_tag|split:'StateCode="'
    }
  
    var $service_state {
      value = `($state_parts|count) > 1 ? ($state_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $zip_parts {
      value = $cp_tag|split:'ZipPostCode="'
    }
  
    var $service_zip {
      value = `($zip_parts|count) > 1 ? ($zip_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $dl_id_parts {
      value = $dl_tag|split:'Id="'
    }
  
    var $claim_number {
      value = `($dl_id_parts|count) > 1 ? ($dl_id_parts|get:1|split:"\""|get:0) : ""`
    }
  
    //  ========================================================
    //  2026-06-01 - CLAIM_NUMBER DEDUP (mirror servicepower_email_intake)
    // 
    //  Without this guard, AHS sends multiple distinct emails per claim over its
    //  lifecycle (DISPATCH_OFFER, SCHEDULE_CHANGE, NOTES_ADDED, CANCELLATION, etc.)
    //  and each one created a fresh job because the only dedup happened at the
    //  gmail_message_id level. Audit (2026-05-31) found 13,431 excess duplicate
    //  AHS jobs across 2,948 claims with 2+ jobs, max 76 jobs for a single claim.
    //  ServicePower intake (servicepower_email_intake_POST.xs lines 130-145) has
    //  never had this problem because it always checks claim_number first.
    // 
    //  If a job already exists for this claim_number, log an audit row and short
    //  circuit. Do NOT create a second job, do NOT re-enqueue scheduling, do NOT
    //  re-create job_financial or job_event rows.
    //  ========================================================
    var $claim_number_clean {
      value = ($claim_number ?? "")|trim
    }
  
    var $existing_job_for_claim {
      value = null
    }
  
    conditional {
      if ($claim_number_clean != "") {
        db.query jobs {
          where = $db.jobs.claim_number == $claim_number_clean
          return = {type: "single"}
        } as $existing_job_lookup
      
        var.update $existing_job_for_claim {
          value = $existing_job_lookup
        }
      }
    }
  
    conditional {
      if ($existing_job_for_claim != null) {
        conditional {
          if ($effective_gmail_msg_id != "") {
            db.add job_email_event {
              data = {
                job_id          : $existing_job_for_claim.id
                email_type      : "DISPATCH_OFFER"
                vendor          : "ahs"
                gmail_message_id: $effective_gmail_msg_id
                gmail_thread_id : ($input.gmail_thread_id ?? "")
                sender          : ($input.sender ?? "")
                subject         : ($input.subject ?? "")
                body_excerpt    : ($input.rawXml ?? "")|substr:0:500
                triggered_action: "updated_job_status"
                resolution_note : "AHS dispatch matched existing job by claim_number; create suppressed"
                metadata        : {
                claim_number    : $claim_number_clean
                existing_job_id : $existing_job_for_claim.id
                gmail_message_id: $effective_gmail_msg_id
                dedup_source    : "claim_number"
              }
              }
            } as $dedup_audit_event
          }
        }
      
        db.add event_log {
          data = {
            action  : "ahs_email_intake_dedup_skipped"
            metadata: {
            claim_number    : $claim_number_clean
            existing_job_id : $existing_job_for_claim.id
            gmail_message_id: $effective_gmail_msg_id
            reason          : "job already exists for this claim_number"
          }
          }
        } as $dedup_event_log
      
        return {
          value = {
            success             : true
            duplicate           : true
            claim_number        : $claim_number_clean
            existing_job_id     : $existing_job_for_claim.id
            customer_id         : null
            consent_channel_used: null
            resolution          : "claim_number already exists in jobs table"
            test_run_id         : ($input.test_run_id ?? "")
          }
        }
      }
    }
  
    var $ddt_parts {
      value = $dl_tag|split:'DispatchDateTime="'
    }
  
    var $dispatch_date_raw {
      value = `($ddt_parts|count) > 1 ? ($ddt_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $dispatch_date_ts {
      value = ($dispatch_date_raw != "") ? ($dispatch_date_raw|to_timestamp) : null
    }
  
    var $dtype_parts {
      value = $dl_tag|split:'dispatchTypeValueList="'
    }
  
    var $dispatch_type {
      value = `($dtype_parts|count) > 1 ? ($dtype_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $sfa_parts {
      value = $dl_tag|split:'ServiceFeeAmount="'
    }
  
    var $service_fee_amount {
      value = `($sfa_parts|count) > 1 ? ($sfa_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $desc_parts {
      value = $wo_tag|split:'Description="'
    }
  
    var $appliance_raw {
      value = `($desc_parts|count) > 1 ? ($desc_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $appliance_lower {
      value = $appliance_raw|to_lower
    }
  
    var $appliance_type {
      value = $appliance_lower
    }
  
    conditional {
      if ($appliance_lower|contains:"fridge") {
        var.update $appliance_type {
          value = "refrigerator"
        }
      }
    }
  
    conditional {
      if ($appliance_lower|contains:"washing machine") {
        var.update $appliance_type {
          value = "washer"
        }
      }
    }
  
    conditional {
      if ($appliance_lower|contains:"oven" || $appliance_lower|contains:"stove" || $appliance_lower|contains:"cooktop") {
        var.update $appliance_type {
          value = "range"
        }
      }
    }
  
    var $sym_parts {
      value = $wo_inner|split:"<Symptom "
    }
  
    var $sym_tag {
      value = `($sym_parts|count) > 1 ? ($sym_parts|get:1|split:">"|get:0) : ""`
    }
  
    var $sym_name_parts {
      value = $sym_tag|split:'Name="'
    }
  
    var $problem_description {
      value = `($sym_name_parts|count) > 1 ? ($sym_name_parts|get:1|split:"\""|get:0) : ""`
    }
  
    var $problem_summary {
      value = ($problem_description|strlen) > 80 ? ($problem_description|substr:0:80) : $problem_description
    }
  
    var $attr_parts {
      value = $wo_inner|split:"<Attribute "
    }
  
    var $brand {
      value = ""
    }
  
    foreach ($attr_parts) {
      each as $ap {
        conditional {
          if ($brand == "" && ($ap|contains:'Name="Brand"')) {
            var $val_parts {
              value = $ap|split:'Value="'
            }
          
            conditional {
              if (($val_parts|count) > 1) {
                var.update $brand {
                  value = $val_parts
                    |get:1
                    |split:'"'
                    |get:0
                }
              }
            }
          }
        }
      }
    }
  
    var $cust_name_parts {
      value = $cc_tag|split:'Name="'
    }
  
    var $cust_name_parts_count {
      value = $cust_name_parts|count
    }
  
    var $cust_name_raw_enc {
      value = ""
    }
  
    conditional {
      if ($cust_name_parts_count > 1) {
        var.update $cust_name_raw_enc {
          value = $cust_name_parts
            |get:1
            |split:'"'
            |get:0
        }
      }
    }
  
    var $cust_name_raw {
      value = $cust_name_raw_enc|replace:"&amp;":"&"
    }
  
    var $name_ampersand_parts {
      value = $cust_name_raw|split:" & "
    }
  
    var $primary_name_upper {
      value = $name_ampersand_parts|get:0|trim
    }
  
    var $co_member_name_upper {
      value = `($name_ampersand_parts|count) > 1 ? ($name_ampersand_parts|get:1|trim) : ""`
    }
  
    var $name_tokens {
      value = $primary_name_upper|split:" "
    }
  
    var $name_token_count {
      value = $name_tokens|count
    }
  
    var $last_name_upper {
      value = ($name_token_count > 0) ? ($name_tokens|last|trim) : ""
    }
  
    var $first_name_upper {
      value = ""
    }
  
    var $fn_token_index {
      value = 0
    }
  
    foreach ($name_tokens) {
      each as $tok {
        conditional {
          if ($fn_token_index < ($name_token_count - 1)) {
            var.update $first_name_upper {
              value = ($first_name_upper == "") ? $tok : ($first_name_upper ~ " " ~ $tok)
            }
          }
        }
      
        var.update $fn_token_index {
          value = $fn_token_index + 1
        }
      }
    }
  
    conditional {
      if ($first_name_upper == "" && $last_name_upper != "") {
        var.update $first_name_upper {
          value = $last_name_upper
        }
      }
    }
  
    var $fn_lower {
      value = $first_name_upper|to_lower
    }
  
    var $fn_words {
      value = $fn_lower|split:" "
    }
  
    var $first_name {
      value = ""
    }
  
    foreach ($fn_words) {
      each as $w {
        conditional {
          if (($w|strlen) > 0) {
            var $fn_first_char {
              value = ($w|substr:0:1)|to_upper
            }
          
            var $fn_rest {
              value = ($w|strlen) > 1 ? ($w|substr:1) : ""
            }
          
            var $fn_cased {
              value = $fn_first_char ~ $fn_rest
            }
          
            var.update $first_name {
              value = ($first_name == "") ? $fn_cased : ($first_name ~ " " ~ $fn_cased)
            }
          }
        }
      }
    }
  
    var $ln_lower {
      value = $last_name_upper|to_lower
    }
  
    var $ln_words {
      value = $ln_lower|split:" "
    }
  
    var $last_name {
      value = ""
    }
  
    foreach ($ln_words) {
      each as $w {
        conditional {
          if (($w|strlen) > 0) {
            var $ln_first_char {
              value = ($w|substr:0:1)|to_upper
            }
          
            var $ln_rest {
              value = ($w|strlen) > 1 ? ($w|substr:1) : ""
            }
          
            var $ln_cased {
              value = $ln_first_char ~ $ln_rest
            }
          
            var.update $last_name {
              value = ($last_name == "") ? $ln_cased : ($last_name ~ " " ~ $ln_cased)
            }
          }
        }
      }
    }
  
    var $sa_lower {
      value = $service_address_raw|to_lower
    }
  
    var $sa_words {
      value = $sa_lower|split:" "
    }
  
    var $service_address {
      value = ""
    }
  
    foreach ($sa_words) {
      each as $w {
        conditional {
          if (($w|strlen) > 0) {
            var $sa_first_char {
              value = ($w|substr:0:1)|to_upper
            }
          
            var $sa_rest {
              value = ($w|strlen) > 1 ? ($w|substr:1) : ""
            }
          
            var $sa_cased {
              value = $sa_first_char ~ $sa_rest
            }
          
            var.update $service_address {
              value = ($service_address == "") ? $sa_cased : ($service_address ~ " " ~ $sa_cased)
            }
          }
        }
      }
    }
  
    var $sc_lower {
      value = $service_city_raw|to_lower
    }
  
    var $sc_words {
      value = $sc_lower|split:" "
    }
  
    var $service_city {
      value = ""
    }
  
    foreach ($sc_words) {
      each as $w {
        conditional {
          if (($w|strlen) > 0) {
            var $sc_first_char {
              value = ($w|substr:0:1)|to_upper
            }
          
            var $sc_rest {
              value = ($w|strlen) > 1 ? ($w|substr:1) : ""
            }
          
            var $sc_cased {
              value = $sc_first_char ~ $sc_rest
            }
          
            var.update $service_city {
              value = ($service_city == "") ? $sc_cased : ($service_city ~ " " ~ $sc_cased)
            }
          }
        }
      }
    }
  
    var $phone_parts {
      value = $cc_inner|split:"<PhoneNumber "
    }
  
    var $phone_raw {
      value = ""
    }
  
    foreach ($phone_parts) {
      each as $pp {
        conditional {
          if ($phone_raw == "" && ($pp|contains:'Type="CELL"')) {
            var $cell_num_parts {
              value = $pp|split:'Number="'
            }
          
            conditional {
              if (($cell_num_parts|count) > 1) {
                var.update $phone_raw {
                  value = $cell_num_parts
                    |get:1
                    |split:'"'
                    |get:0
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      if ($phone_raw == "" && ($phone_parts|count) > 1) {
        var $first_num_parts {
          value = $phone_parts|get:1|split:'Number="'
        }
      
        conditional {
          if (($first_num_parts|count) > 1) {
            var.update $phone_raw {
              value = $first_num_parts
                |get:1
                |split:'"'
                |get:0
            }
          }
        }
      }
    }
  
    var $phone_digits {
      value = $phone_raw
    }
  
    var $phone_len {
      value = $phone_digits|strlen
    }
  
    var $phone_starts_with_one {
      value = ($phone_digits|substr:0:1) == "1"
    }
  
    var $phone_normalized {
      value = ""
    }
  
    conditional {
      if ($phone_len == 11 && $phone_starts_with_one) {
        var.update $phone_normalized {
          value = $phone_digits|substr:1
        }
      }
    
      else {
        var.update $phone_normalized {
          value = $phone_digits
        }
      }
    }
  
    var $msg_detail_parts {
      value = $msg_block|split:"<MessageNotesDetail>"
    }
  
    var $msg_collected {
      value = ""
    }
  
    foreach ($msg_detail_parts) {
      each as $mp {
        var $mp_close {
          value = $mp|split:"</MessageNotesDetail>"
        }
      
        conditional {
          if (($mp_close|count) > 1) {
            var $detail_text {
              value = $mp_close|get:0|trim
            }
          
            conditional {
              if ($detail_text != "") {
                var.update $msg_collected {
                  value = ($msg_collected == "") ? $detail_text : ($msg_collected ~ "\n" ~ $detail_text)
                }
              }
            }
          }
        }
      }
    }
  
    var $email_split {
      value = $msg_collected
        |split:"accepts email communication"
    }
  
    var $email_split_count {
      value = $email_split|count
    }
  
    var $email {
      value = ""
    }
  
    conditional {
      if ($email_split_count > 1) {
        var $after_marker_raw {
          value = $email_split|get:1
        }
      
        var $after_marker {
          value = ""
        }
      
        var.update $after_marker {
          value = $after_marker_raw|split:"\n"|get:0
        }
      
        var $colon_parts {
          value = $after_marker|split:":"
        }
      
        var $colon_parts_count {
          value = $colon_parts|count
        }
      
        var $email_token_raw {
          value = ""
        }
      
        conditional {
          if ($colon_parts_count > 1) {
            var.update $email_token_raw {
              value = $colon_parts
                |last
                |trim
                |split:" "
                |get:0
                |trim
            }
          }
        
          else {
            var.update $email_token_raw {
              value = $after_marker
                |trim
                |split:" "
                |get:0
                |trim
            }
          }
        }
      
        var.update $email {
          value = $email_token_raw
        }
      }
    }
  
    var $cov_detail_parts {
      value = $cov_block|split:"<CoverageNoteDetail>"
    }
  
    var $cov_collected {
      value = ""
    }
  
    foreach ($cov_detail_parts) {
      each as $cp {
        var $cp_close {
          value = $cp|split:"</CoverageNoteDetail>"
        }
      
        conditional {
          if (($cp_close|count) > 1) {
            var $cv_text {
              value = $cp_close|get:0|trim
            }
          
            conditional {
              if ($cv_text != "") {
                var.update $cov_collected {
                  value = ($cov_collected == "") ? $cv_text : ($cov_collected ~ "\n" ~ $cv_text)
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      if ($cov_collected == "" && $cov_block != "") {
        var.update $cov_collected {
          value = $cov_block|trim
        }
      }
    }
  
    var $pvr_detail_parts {
      value = $pvr_block
        |split:"<ProductVersionRemarksDetail>"
    }
  
    var $pvr_collected {
      value = ""
    }
  
    foreach ($pvr_detail_parts) {
      each as $pp2 {
        var $pp2_close {
          value = $pp2
            |split:"</ProductVersionRemarksDetail>"
        }
      
        conditional {
          if (($pp2_close|count) > 1) {
            var $pv_text {
              value = $pp2_close|get:0|trim
            }
          
            conditional {
              if ($pv_text != "") {
                var.update $pvr_collected {
                  value = ($pvr_collected == "") ? $pv_text : ($pvr_collected ~ "\n" ~ $pv_text)
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      if ($pvr_collected == "" && $pvr_block != "") {
        var.update $pvr_collected {
          value = $pvr_block|trim
        }
      }
    }
  
    var $msg_lower {
      value = $msg_collected|to_lower
    }
  
    var $text_match_a {
      value = $msg_lower
        |contains:"accepts text communication"
    }
  
    var $text_match_b {
      value = $msg_lower|contains:"customer accepts text"
    }
  
    var $text_match_c {
      value = $msg_lower|contains:"opted in to text"
    }
  
    var $text_opt_in {
      value = false
    }
  
    conditional {
      if ($text_match_a || $text_match_b || $text_match_c) {
        var.update $text_opt_in {
          value = true
        }
      }
    }
  
    var $email_match_a {
      value = $msg_lower
        |contains:"accepts email communication"
    }
  
    var $email_match_b {
      value = $msg_lower
        |contains:"customer accepts email"
    }
  
    var $email_match_c {
      value = $msg_lower|contains:"opted in to email"
    }
  
    var $email_opt_in {
      value = false
    }
  
    conditional {
      if ($email_match_a || $email_match_b || $email_match_c) {
        var.update $email_opt_in {
          value = true
        }
      }
    }
  
    var $existing_customer {
      value = null
    }
  
    conditional {
      if ($phone_normalized != "") {
        db.get customer {
          field_name = "phone"
          field_value = $phone_normalized
        } as $existing_customer_lookup
      
        var.update $existing_customer {
          value = $existing_customer_lookup
        }
      }
    }
  
    var $customer_id {
      value = 0
    }
  
    conditional {
      if ($existing_customer == null) {
        db.add customer {
          data = {
            first_name: $first_name
            last_name : $last_name
            phone     : $phone_normalized
            email     : $email
            address   : $service_address
            city      : $service_city
            state     : $service_state
            zip       : $service_zip
          }
        } as $new_customer
      
        var.update $customer_id {
          value = $new_customer.id
        }
      }
    
      else {
        var.update $customer_id {
          value = $existing_customer.id
        }
      }
    }
  
    var $co_member_section {
      value = ($co_member_name_upper != "") ? ("\n\n=== CO-MEMBER ===\n" ~ $co_member_name_upper) : ""
    }
  
    var $sfa_line {
      value = ($service_fee_amount != "") ? ("\nService Fee (DO NOT COLLECT): $" ~ $service_fee_amount) : ""
    }
  
    var $notes_internal {
      value = "=== AHS DISPATCH #" ~ $claim_number ~ " ===\nDispatch Date: " ~ $dispatch_date_raw ~ "\nDispatch Type: " ~ $dispatch_type ~ "\nFormCode (Plan Type): " ~ $warranty_plan_type ~ "\nContract Effective Date: " ~ $cefdate_raw ~ "\nVendor ID: " ~ $warranty_vendor_id ~ $sfa_line ~ $co_member_section ~ "\n\n=== VENDOR NOTES ===\n" ~ $msg_collected ~ "\n\n=== COVERAGE NOTES ===\n" ~ $cov_collected ~ "\n\n=== PRODUCT REMARKS ===\n" ~ $pvr_collected
    }
  
    db.add jobs {
      data = {
        customer_id                     : $customer_id
        appliance_type                  : $appliance_type
        brand                           : $brand
        problem_summary                 : $problem_summary
        problem_description             : $problem_description
        warranty_company                : "AHS"
        claim_number                    : $claim_number
        warranty_vendor_id              : $warranty_vendor_id
        warranty_plan_type              : $warranty_plan_type
        warranty_contract_effective_date: $contract_effective_date_ts
        dispatch_date                   : $dispatch_date_ts
        dispatch_type                   : $dispatch_type
        service_address                 : $service_address
        service_city                    : $service_city
        service_state                   : $service_state
        service_zip                     : $service_zip
        current_status                  : "new_intake"
        friendly_status                 : "New Intake"
        job_status                      : "submitted"
        triage_status                   : "not_reviewed"
        parts_status                    : "not_needed"
        scheduling_status               : "not_ready"
        payment_status                  : "warranty_pending"
        source_type                     : "ahs_email"
        source_agent                    : "webhook"
        intake_source                   : "ahs_email"
        customer_type                   : "warranty"
        notes_internal                  : $notes_internal
        test_run_id                     : ($input.test_run_id ?? "")
      }
    } as $new_job
  
    // Phase B: emit JOB_CREATED for colony loop greeting (see docs/colony-loop-design.md section 16).
    var $jc_phone {
      value = $phone_normalized
    }
  
    var $jc_first {
      value = $first_name
    }
  
    var $jc_appliance {
      value = ($appliance_type ?? "")
    }
  
    var $jc_payload_obj {
      value = {
        job_id             : $new_job.id
        customer_phone     : $jc_phone
        customer_first_name: $jc_first
        appliance_type     : $jc_appliance
        source             : "ahs_email"
      }
    }
  
    var $jc_payload_str {
      value = $jc_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "JOB_CREATED"
        signal_strength: 70
        source_colony  : ""
        target_colonies: ""
        payload        : $jc_payload_str
      }
    } as $jc_signal
  
    // Parallel ANT Phase 1 marker - Danielle's needs-scheduled.html
    // scans event_log for this action to find new email-parsed jobs.
    db.add event_log {
      data = {
        action  : "parallel_job_created_from_email"
        metadata: {
        job_id          : $new_job.id
        customer_id     : ($new_job.customer_id ?? 0)
        intake_source   : "email_ahs"
        warranty_company: "AHS"
        claim_number    : ($jc_appliance ?? "")
      }
      }
    } as $parallel_marker_ahs
  
    // SMS Danielle on every new AHS job (internal recipient - bypasses
    // CUSTOMER_FACING_ENABLED gate via the recipient_role check).
    var $dn_first {
      value = (($new_job.customer_first_name ?? "")|trim)
    }
  
    var $dn_city {
      value = (($new_job.service_city ?? "")|trim)
    }
  
    var $dn_alert_body {
      value = ("[ant] new AHS job in Needs Scheduled: " ~ $dn_first ~ ", " ~ $dn_city ~ ". tnapplianceexchange.net/needs-scheduled.html")
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to         : "+16154850713"
        message    : $dn_alert_body
        context_tag: "parallel_ahs_danielle_alert"
      }
    
      headers = []
        |push:"Content-Type: application/json"
    } as $danielle_ahs_alert
  
    db.add event_log {
      data = {
        action  : "job_created_signal_emitted"
        metadata: {
        job_id   : $new_job.id
        signal_id: $jc_signal.id
        source   : "ahs_email"
      }
      }
    } as $jc_log
  
    conditional {
      if ($effective_gmail_msg_id != "") {
        db.add job_email_event {
          data = {
            job_id          : $new_job.id
            email_type      : "DISPATCH_OFFER"
            vendor          : "ahs"
            gmail_message_id: $effective_gmail_msg_id
            gmail_thread_id : ($input.gmail_thread_id ?? "")
            sender          : ($input.sender ?? "")
            subject         : ($input.subject ?? "")
            body_excerpt    : ($input.rawXml ?? "")|substr:0:500
            triggered_action: "created_job"
            resolution_note : "AHS dispatch #" ~ $claim_number ~ " parsed and ingested via Frontdoor XML attachment"
            metadata        : {
            claim_number      : $claim_number
            warranty_vendor_id: $warranty_vendor_id
            appliance_type    : $appliance_type
            brand             : $brand
            service_state     : $service_state
            dispatch_type     : $dispatch_type
          }
          }
        } as $audit_event_row
      }
    }
  
    db.add job_financial {
      data = {
        job_id        : $new_job.id
        payment_status: "warranty_pending"
      }
    } as $new_financial
  
    db.add job_event {
      data = {
        job_id      : $new_job.id
        event_type  : "intake_created"
        event_source: "ahs_email"
        event_notes : "AHS dispatch #" ~ $claim_number ~ " parsed and ingested"
        created_by  : "system"
      }
    } as $new_event
  
    // HOUR 1: auto-enqueue scheduling_queue propose row for every new AHS job.
    // AHS dispatches carry a date (dispatch_date) but no slot detail, so we push
    // the job into the propose path immediately. scheduling_queue_worker picks
    // it up on its next cycle and SMSes the owner 3 top-scored slot options.
    // Direct enqueue (not via try_auto_schedule) because AHS jobs lack a tech-1
    // pre-diagnosis at intake time and would always fail that gate.
    var $sq_meta_obj {
      value = {
        priority        : 1
        source          : "ahs_email_intake_auto"
        warranty_company: "AHS"
        claim_number    : $claim_number
      }
    }
  
    // Auto-enqueue to scheduling_queue retired 2026-06-01 (#3 of Phase 1).
    // Mock-scheduler now reads jobs directly from the jobs table and
    // schedules without needing the queue. The XS scheduling_queue_worker
    // task is being retired. This enqueue stays behind a feature flag so
    // Teddy can re-enable if any downstream consumer still depends on it.
    var $sq_enabled {
      value = (($env.SCHEDULING_QUEUE_ENABLED ?? "false") == "true")
    }

    conditional {
      if ($sq_enabled == true) {
        db.add scheduling_queue {
          data = {
            job_id     : $new_job.id
            action_type: "propose"
            status     : "pending"
            metadata   : $sq_meta_obj
          }
        } as $sq_row
      }
    }
  
    db.add event_log {
      data = {
        action  : "scheduling_queue_propose_enqueued"
        metadata: {
        job_id             : $new_job.id
        scheduling_queue_id: $sq_row.id
        source             : "ahs_email_intake_auto"
        claim_number       : $claim_number
      }
      }
    } as $sq_log
  
    // Phase B: greeting is now owned by the Mac Mini colony loop (JOB_CREATED signal
    // emitted above). Wire 1 SMS, consent-channel logic, and chat-link mint were removed
    // here - the loop sends the greeting and Ant handles chat from the bare link.
    var $consent_channel_used {
      value = "deferred_to_loop"
    }
  
    var $sms_response_status {
      value = null
    }
  
    db.add event_log {
      data = {
        action  : "ahs_email_intake_created"
        metadata: {
        job_id              : $new_job.id
        customer_id         : $customer_id
        claim_number        : $claim_number
        warranty_vendor_id  : $warranty_vendor_id
        consent_channel_used: $consent_channel_used
        source              : "ahs_email"
      }
      }
    } as $audit_log
  
    var $resp {
      value = {
        success             : true
        job_id              : $new_job.id
        customer_id         : $customer_id
        claim_number        : $claim_number
        consent_channel_used: $consent_channel_used
        sms_response_status : $sms_response_status
        existing_customer   : ($existing_customer != null)
      }
    }
  }

  response = $resp
  guid = "ahs-email-intake-2026-05-11"
}
// Unified TDR status - the central spine artifact. Powers the
// ant-tdr-card.js component embedded on tech-simple, customer-portal,
// warranty-review, job-detail. ONE TDR, multiple lenses.
//
// Returns: 5 core TDR fields with filled/required flags, a readiness
// percentage based on warranty-submission requirements, the list of
// specific blocking fields, attachment count, customer-safe summary,
// warranty vendor (if applicable), and job/customer context for the
// header. Role-filtering happens client-side in ant-tdr-card.js.
query get_unified_tdr_status verb=GET {
  api_group = "intake"

  input {
    int job_id
    int? technician_id?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer

    var $tech_id {
      value = ($input.technician_id ?? ($job.technician_id ?? 0))
    }

    // ALL recent TDR rows for this job + tech, newest first. A job accumulates several
    // TDR rows (each voice pass / finalize / re-open can add one). Reading ONLY the newest
    // let a fresh or half-empty row HIDE a filled older one, so entering a part or
    // re-opening the card looked like it erased the diagnosis, labor, model, everything
    // (Lee 2026-07-15) and made a finished report read 0% (job 20436). We now MERGE below:
    // the newest NON-EMPTY value per field, so a filled field can never disappear behind a
    // blank newer row.
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $tech_id
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 25}}
    } as $tdr_rows

    var $tdr {
      value = (($tdr_rows.items|first) ?? null)
    }

    // Count attachments on job. Table is job_attachments, not attachment.
    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $att_rows

    var $att_count { value = ($att_rows.itemsTotal ?? 0) }

    // Signature is a separate attachment_type. Count rows tagged as
    // signature so the readiness math can require one for warranty.
    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id && $db.job_attachments.attachment_type == "signature"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $sig_rows
    var $sig_count { value = ($sig_rows.itemsTotal ?? 0) }
    var $has_sig { value = ($sig_count > 0) }

    // MERGE newest-non-empty per field across all rows. Rows are newest-first, so the
    // FIRST non-empty value we hit for a field is the newest one. This is the fix for a
    // filled field vanishing behind a blank newer row (Lee's "it erased everything" + the
    // 0% on a finished report). Each field is resolved independently.
    var $v_diag   { value = "" }
    var $v_failed { value = "" }
    var $v_hours  { value = "" }
    var $v_repair { value = "" }
    var $v_parts  { value = "" }
    var $v_notes  { value = "" }

    foreach ($tdr_rows.items) {
      each as $r {
        var $r_diag { value = (($r.diagnosis ?? "")|to_text) }
        conditional { if ($v_diag == "" && $r_diag != "") {
          var.update $v_diag { value = $r_diag }
        } }
        var $r_failed { value = (($r.failed_component ?? "")|to_text) }
        conditional { if ($v_failed == "" && $r_failed != "") {
          var.update $v_failed { value = $r_failed }
        } }
        var $r_hours { value = (($r.labor_time_hours ?? "")|to_text) }
        conditional { if ($v_hours == "" && $r_hours != "" && $r_hours != "0") {
          var.update $v_hours { value = $r_hours }
        } }
        var $r_repair { value = (($r.repair_completed ?? "")|to_text) }
        conditional { if ($v_repair == "" && $r_repair != "") {
          var.update $v_repair { value = $r_repair }
        } }
        var $r_parts { value = (($r.parts_needed ?? [])|join:", ") }
        conditional { if ($v_parts == "" && $r_parts != "") {
          var.update $v_parts { value = $r_parts }
        } }
        var $r_notes { value = (($r.customer_notes ?? "")|to_text) }
        conditional { if ($v_notes == "" && $r_notes != "") {
          var.update $v_notes { value = $r_notes }
        } }
      }
    }

    var $f_diag   { value = ($v_diag != "") }
    var $f_failed { value = ($v_failed != "") }
    var $f_hours  { value = ($v_hours != "" && $v_hours != "0") }
    var $f_repair { value = ($v_repair != "") }
    var $f_parts  { value = ($v_parts != "") }
    var $f_photo  { value = ($att_count > 0) }

    // Required for warranty submission (5 TDR fields + photo + signature).
    var $req_total { value = 7 }
    var $diag_n   { value = ($f_diag == true) ? 1 : 0 }
    var $failed_n { value = ($f_failed == true) ? 1 : 0 }
    var $hours_n  { value = ($f_hours == true) ? 1 : 0 }
    var $repair_n { value = ($f_repair == true) ? 1 : 0 }
    var $parts_n  { value = ($f_parts == true) ? 1 : 0 }
    var $photo_n  { value = ($f_photo == true) ? 1 : 0 }
    var $sig_n    { value = ($has_sig == true) ? 1 : 0 }
    var $filled_count {
      value = ($diag_n + $failed_n + $hours_n + $repair_n + $parts_n + $photo_n + $sig_n)
    }
    var $readiness_pct {
      value = ($filled_count * 100 / $req_total)
    }

    // Blocking list - text of fields still empty.
    var $b_diag   { value = ($f_diag == true) ? "" : "diagnosis" }
    var $b_failed { value = ($f_failed == true) ? "" : "failed_component" }
    var $b_hours  { value = ($f_hours == true) ? "" : "labor_hours" }
    var $b_repair { value = ($f_repair == true) ? "" : "repair_completed" }
    var $b_parts  { value = ($f_parts == true) ? "" : "parts_needed" }
    var $b_photo  { value = ($f_photo == true) ? "" : "photo" }
    var $b_sig    { value = ($has_sig == true) ? "" : "signature" }

    // Header context.
    var $cust_first { value = (($customer.first_name ?? "") |to_text) }
    var $appl_brand { value = (($job.appliance_brand ?? "") |to_text) }
    var $appl_type  { value = (($job.appliance_type ?? "appliance") |to_text) }
    var $appliance_summary { value = ($appl_brand ~ " " ~ $appl_type) }
    var $cust_type  { value = (($job.customer_type ?? "") |to_text) }
    var $warranty_co { value = (($job.warranty_company ?? "") |to_text) }
  }

  response = {
    success           : true
    job_id            : $input.job_id
    technician_id     : $tech_id
    customer_first_name: $cust_first
    appliance_summary : $appliance_summary
    customer_type     : $cust_type
    warranty_company  : $warranty_co
    tdr_id            : ($tdr == null) ? 0 : $tdr.id
    fields: {
      diagnosis       : {value: $v_diag,   filled: $f_diag,   required: true}
      failed_component: {value: $v_failed, filled: $f_failed, required: true}
      labor_hours     : {value: $v_hours,  filled: $f_hours,  required: true}
      repair_completed: {value: $v_repair, filled: $f_repair, required: true}
      parts_needed    : {value: $v_parts,  filled: $f_parts,  required: true}
      customer_notes  : {value: $v_notes,  filled: ($v_notes != ""), required: false}
    }
    attachments_count : $att_count
    has_photo         : $f_photo
    has_signature     : $has_sig
    signature_count   : $sig_count
    filled_count      : $filled_count
    required_total    : $req_total
    readiness_pct     : $readiness_pct
    blocking: {
      diagnosis       : $b_diag
      failed_component: $b_failed
      labor_hours     : $b_hours
      repair_completed: $b_repair
      parts_needed    : $b_parts
      photo           : $b_photo
      signature       : $b_sig
    }
    submission_extras: {
      claim_number    : (($job.claim_number ?? "")|to_text)
      model_number    : (($job.model_number ?? "")|to_text)
      serial_number   : (($job.serial_number ?? "")|to_text)
      problem_summary : (($job.problem_summary ?? "")|to_text)
      service_address : (($job.service_address ?? "")|to_text)
      customer_phone  : (($customer.phone ?? "")|to_text)
      customer_last_name: (($customer.last_name ?? "")|to_text)
      customer_city   : (($customer.city ?? "")|to_text)
      customer_state  : (($customer.state ?? "")|to_text)
    }
  }

  guid = "get-unified-tdr-status-v1"
}

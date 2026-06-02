//  Powers Danielle's needs-scheduled.html - REWRITE 2026-05-30.
// 
//  Original used an event_log scan + substring JSON parsing because the
//  jobs.parallel_mode column did not exist. That column was added
//  2026-05-30, so this version queries the column directly.
// 
//  Also removes original footguns:
//    * line 63 backtick wrap on ($jid_split|get:0)|trim - parser-fatal
//    * line 101 use of (ternary) where coalesce was intended
// 
//  XS rules: no em-dashes, no backticks, no try/catch, no raw if,
//  every filter paren-wrapped, ?? only in value = (...).
query list_needs_scheduled_parallel verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $lim_raw {
      value = ($input.limit ?? 100)
    }
  
    var $lim {
      value = ($lim_raw > 200) ? 200 : $lim_raw
    }
  
    //  Pull all parallel-mode jobs that are not yet scheduled.
    //  scheduled_start null OR 0 = not scheduled.
    // 
    //  2026-05-30 fix: was filtering on parallel_mode == true, but that
    //  column was added via Metadata API with default "" instead of false.
    //  Xano silently drops bool writes against that misconfigured column,
    //  so parallel_mode never lands true and the queue stays empty. We
    //  now filter on intake_source (text column, writes land cleanly)
    //  matching the parallel-only intake sources.
    // 2026-06-02 FIX: intake_source naming was REVERSED — Gmail pollers
    // write 'ahs_email' / 'servicepower_email' / 'allstate_email' (vendor
    // first), not the reversed forms this filter was looking for. The
    // result: every email-sourced job was INVISIBLE in needs-scheduled.
    //
    // Also broadened scheduling_status to include 'broadcasting' /
    // 'intake_complete' / 'needs_more_info' (jobs in those states with
    // no tech assigned still need scheduling attention). And widened to
    // also include jobs with scheduled_start set but technician_id=0
    // (vendor-locked time but no tech claimed).
    //
    // Kept the OLD reversed names in the filter too (backward compat).
    db.query jobs {
      where = ($db.jobs.intake_source == "ahs_email" || $db.jobs.intake_source == "servicepower_email" || $db.jobs.intake_source == "allstate_email" || $db.jobs.intake_source == "email_ahs" || $db.jobs.intake_source == "email_servicepower" || $db.jobs.intake_source == "email_allstate" || $db.jobs.intake_source == "web_chat" || $db.jobs.intake_source == "manual" || $db.jobs.intake_source == "phone_call") && ($db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "needs_scheduled" || $db.jobs.scheduling_status == "broadcasting" || $db.jobs.scheduling_status == "intake_complete" || $db.jobs.scheduling_status == "needs_more_info" || $db.jobs.scheduling_status == "scheduled") && $db.jobs.technician_id == 0
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $job_rows
  
    var $items {
      value = []
    }
  
    foreach ($job_rows.items) {
      each as $j {
        db.get customer {
          field_name = "id"
          field_value = ($j.customer_id ?? 0)
        } as $cust
      
        var $cust_first {
          value = (($cust ?? {first_name: ""}).first_name ?? "")
        }
      
        var $cust_last {
          value = (($cust ?? {last_name: ""}).last_name ?? "")
        }
      
        var $cust_phone {
          value = (($cust ?? {phone: ""}).phone ?? "")
        }
      
        var $cust_address {
          value = (($cust ?? {address: ""}).address ?? "")
        }
      
        var $cust_city {
          value = (($cust ?? {city: ""}).city ?? "")
        }
      
        var $cust_state {
          value = (($cust ?? {state: ""}).state ?? "")
        }
      
        var $cust_zip {
          value = (($cust ?? {zip: ""}).zip ?? "")
        }
      
        var $svc_addr {
          value = (($j.service_address ?? "")|trim)
        }
      
        var $svc_city {
          value = (($j.service_city ?? "")|trim)
        }
      
        var $svc_state {
          value = (($j.service_state ?? "")|trim)
        }
      
        var $svc_zip {
          value = (($j.service_zip ?? "")|trim)
        }
      
        var $row {
          value = {
            id              : $j.id
            created_at      : ($j.created_at ?? 0)
            customer_first  : (($cust_first ?? "")|trim)
            customer_last   : (($cust_last ?? "")|trim)
            customer_phone  : (($cust_phone ?? "")|trim)
            service_address : ($svc_addr != "") ? $svc_addr : (($cust_address ?? "")|trim)
            service_city    : ($svc_city != "") ? $svc_city : (($cust_city ?? "")|trim)
            service_state   : ($svc_state != "") ? $svc_state : (($cust_state ?? "")|trim)
            service_zip     : ($svc_zip != "") ? $svc_zip : (($cust_zip ?? "")|trim)
            appliance       : (($j.appliance_type ?? "")|trim)
            brand           : (($j.brand ?? "")|trim)
            model_number    : (($j.model_number ?? "")|trim)
            problem_summary : (($j.problem_summary ?? "")|trim)
            warranty_company: (($j.warranty_company ?? "")|trim)
            claim_number    : (($j.claim_number ?? "")|trim)
            intake_source   : (($j.intake_source ?? "")|trim)
          }
        }
      
        var.update $items {
          value = $items|push:$row
        }
      }
    }
  }

  response = {success: true, count: $items|count, items: $items}
  guid = "list-needs-scheduled-parallel-v1"
}
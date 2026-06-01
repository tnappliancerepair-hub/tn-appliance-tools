// Creates a new tenant. Used by signup.html when an appliance shop joins
// the free trial. Generates slug if not supplied, validates uniqueness,
// emits COMPANY_ONBOARDED signal for downstream agent welcome flow.
query onboard_company verb=POST {
  api_group = "intake"

  input {
    text name
    text owner_phone
    text owner_email
    text? slug?
    text? timezone?
  }

  stack {
    var $name_clean {
      value = ($input.name ?? "")|trim
    }
  
    var $phone_clean {
      value = ($input.owner_phone ?? "")|trim
    }
  
    var $email_clean {
      value = ($input.owner_email ?? "")|trim|lower
    }
  
    precondition ($name_clean != "" && $phone_clean != "" && $email_clean != "") {
      error_type = "inputerror"
      error = "name + owner_phone + owner_email required"
    }
  
    // Slug: use input or derive from name (first 12 chars, lowercase, alnum only)
    var $slug_in {
      value = ($input.slug ?? "")|trim|lower
    }
  
    var $name_slug_raw {
      value = $name_clean
        |to_lower
        |replace:" ":"_"
        |replace:".":""
        |replace:",":""
    }
  
    var $name_slug_safe {
      value = $name_slug_raw|substr:0:20
    }
  
    var $slug {
      value = ($slug_in != "" ? $slug_in : $name_slug_safe)
    }
  
    // Uniqueness check
    db.query company {
      where = $db.company.slug == $slug
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $dup_rows
  
    conditional {
      if (($dup_rows.items|count) > 0) {
        return {
          value = {success: false, error: "slug_taken", slug: $slug}
        }
      }
    }
  
    db.add company {
      data = {
        name                : $name_clean
        slug                : $slug
        owner_phone         : $phone_clean
        owner_email         : $email_clean
        tenant_status       : "trial"
        timezone            : ($input.timezone ?? "America/Chicago")
        branding_color      : "#f5a623"
        telnyx_from_customer: ""
        telnyx_from_tech    : ""
        logo_url            : ""
      }
    } as $new_company
  
    var $signal_payload {
      value = {
        company_id   : $new_company.id
        name         : $name_clean
        slug         : $slug
        owner_phone  : $phone_clean
        owner_email  : $email_clean
        tenant_status: "trial"
      }
    }
  
    var $payload_json {
      value = $signal_payload|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "COMPANY_ONBOARDED"
        signal_strength: 90
        source_colony  : "saas_signup"
        target_colonies: ""
        payload        : $payload_json
      }
    } as $signal_row
  
    db.add event_log {
      data = {action: "company_onboarded", metadata: $payload_json}
    } as $audit_row
  }

  response = {
    success   : true
    company_id: $new_company.id
    slug      : $slug
    signal_id : $signal_row.id
  }

  guid = "onboard-company-v1"
}
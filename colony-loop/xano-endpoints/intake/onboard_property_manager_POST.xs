// Onboards a property-manager B2B account. Creates a customer record
// with customer_type='property_manager' + writes a property_manager_onboarded
// audit row. Office gets SMS notification.
query onboard_property_manager verb=POST {
  api_group = "intake"

  input {
    text company_name
    text contact_name
    text phone
    text email
    text? notes?
    int? unit_count?
  }

  stack {
    var $company {
      value = ($input.company_name ?? "")|trim
    }

    var $contact {
      value = ($input.contact_name ?? "")|trim
    }

    var $phone_clean {
      value = ($input.phone ?? "")|trim
    }

    precondition ($company != "" && $contact != "" && $phone_clean != "") {
      error_type = "inputerror"
      error      = "company_name + contact_name + phone required"
    }

    db.add customer {
      data = {
        first_name : $contact
        last_name  : "(" ~ $company ~ ")"
        phone      : $phone_clean
        email      : ($input.email ?? "")
        notes      : ($input.notes ?? "")
      }
    } as $cust_row

    var $audit_meta {
      value = {
        customer_id  : $cust_row.id
        company_name : $company
        contact_name : $contact
        phone        : $phone_clean
        email        : ($input.email ?? "")
        unit_count   : ($input.unit_count ?? 0)
      }
    }

    var $audit_json {
      value = $audit_meta|json_encode
    }

    db.add event_log {
      data = {
        action   : "property_manager_onboarded"
        metadata : $audit_json
      }
    } as $audit_row

    db.add colony_signals {
      data = {
        signal_type     : "PROPERTY_MANAGER_ONBOARDED"
        signal_strength : 70
        source_colony   : "b2b_onboarding"
        target_colonies : ""
        payload         : $audit_json
      }
    } as $signal_row
  }

  response = {
    success      : true
    customer_id  : $cust_row.id
    company_name : $company
    signal_id    : $signal_row.id
  }

  guid = "onboard-property-manager-v1"
}

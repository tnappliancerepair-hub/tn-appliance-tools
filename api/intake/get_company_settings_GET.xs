// Returns all settings for a company as a flat object, merged with
// company-table direct fields (name, owner_phone, telnyx_from_*, etc).
// Multi-tenant foundation — every per-tenant runtime decision pulls
// from here.
query get_company_settings verb=GET {
  api_group = "intake"

  input {
    int? company_id?
  }

  stack {
    var $cid {
      value = ($input.company_id ?? 1)
    }
  
    db.get company {
      field_name = "id"
      field_value = $cid
    } as $company
  
    conditional {
      if ($company == null) {
        return {
          value = {
            success   : false
            error     : "company_not_found"
            company_id: $cid
          }
        }
      }
    }
  
    // Merge company columns
    var $base {
      value = {
        company_id          : $company.id
        name                : ($company.name ?? "")
        slug                : ($company.slug ?? "")
        owner_phone         : ($company.owner_phone ?? "")
        owner_email         : ($company.owner_email ?? "")
        tenant_status       : ($company.tenant_status ?? "active")
        telnyx_from_customer: ($company.telnyx_from_customer ?? "")
        telnyx_from_tech    : ($company.telnyx_from_tech ?? "")
        timezone            : ($company.timezone ?? "America/Chicago")
        branding_color      : ($company.branding_color ?? "#f5a623")
        logo_url            : ($company.logo_url ?? "")
      }
    }
  
    // Merge any extra key/value rows
    db.query company_settings {
      where = $db.company_settings.company_id == $cid
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $kv_rows
  
    var $extras {
      value = {}
    }
  
    foreach ($kv_rows.items) {
      each as $r {
        var $k {
          value = ($r.setting_key ?? "")|trim
        }
      
        conditional {
          if ($k != "") {
            var.update $extras {
              value = $extras|set:$k:$r.setting_value ?? ""
            }
          }
        }
      }
    }
  }

  response = {success: true, base_settings: $base, extra_kv: $extras}
  guid = "get-company-settings-v1"
}
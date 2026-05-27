// Upserts a single (company_id, setting_key) → setting_value row.
// Used by company-admin.html and onboarding flow.
query set_company_setting verb=POST {
  api_group = "intake"

  input {
    int company_id
    text setting_key
    text setting_value
  }

  stack {
    var $key_clean {
      value = ($input.setting_key ?? "")|trim
    }

    precondition ($key_clean != "") {
      error_type = "inputerror"
      error      = "setting_key is required"
    }

    db.query company_settings {
      where  = $db.company_settings.company_id == $input.company_id && $db.company_settings.setting_key == $key_clean
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows

    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }

    var $action_taken { value = "" }
    var $row_id { value = 0 }

    conditional {
      if ($existing == null) {
        db.add company_settings {
          data = {
            company_id    : $input.company_id
            setting_key   : $key_clean
            setting_value : ($input.setting_value ?? "")
          }
        } as $new_row

        var.update $row_id { value = $new_row.id }
        var.update $action_taken { value = "created" }
      }

      else {
        db.edit company_settings {
          field_name  = "id"
          field_value = $existing.id
          data        = { setting_value: ($input.setting_value ?? "") }
        } as $updated

        var.update $row_id { value = $existing.id }
        var.update $action_taken { value = "updated" }
      }
    }
  }

  response = {
    success      : true
    row_id       : $row_id
    action_taken : $action_taken
    company_id   : $input.company_id
    setting_key  : $key_clean
  }

  guid = "set-company-setting-v1"
}

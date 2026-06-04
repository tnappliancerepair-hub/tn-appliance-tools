// Operator endpoint — write or update a help-content row. Operator
// can edit help docs in real-time without touching the assistant.
query upsert_app_help verb=POST {
  api_group = "intake"

  input {
    text feature_key
    text feature_display
    text category
    text short_summary
    text in_character_steps
    text keywords
  }

  stack {
    var $key_clean { value = $input.feature_key|lower }

    db.query app_help_content {
      where = $db.app_help_content.feature_key == $key_clean
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $existing { value = (($rows.items|first) ?? null) }
    var $row_id { value = ($existing == null) ? 0 : $existing.id }

    conditional {
      if ($row_id == 0) {
        db.add app_help_content {
          data = {
            feature_key       : $key_clean
            feature_display   : $input.feature_display
            category          : $input.category
            short_summary     : $input.short_summary
            in_character_steps: $input.in_character_steps
            keywords          : $input.keywords
            updated_at_ms     : (now|to_ms)
          }
        } as $created
        var.update $row_id { value = $created.id }
      }
    }
    conditional {
      if ($row_id > 0 && $existing != null) {
        db.edit app_help_content {
          field_name = "id"
          field_value = $row_id
          data = {
            feature_display   : $input.feature_display
            category          : $input.category
            short_summary     : $input.short_summary
            in_character_steps: $input.in_character_steps
            keywords          : $input.keywords
            updated_at_ms     : (now|to_ms)
          }
        }
      }
    }
  }

  response = {
    success    : true
    feature_key: $key_clean
    row_id     : $row_id
  }

  guid = "upsert-app-help-v1"
}

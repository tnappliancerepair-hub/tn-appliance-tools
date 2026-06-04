// Ant Field Assist tool — Brooke calls this when a tech asks how to
// use a feature. Returns the in-character foreman-voice walkthrough
// for the matching app surface so she can read it naturally without
// going corporate.
query lookup_app_help verb=POST {
  api_group = "intake"

  input {
    text? feature_key?
    text? keyword?
  }

  stack {
    var $key_clean {
      value = ($input.feature_key ?? "")|lower
    }
    var $kw_clean {
      value = ($input.keyword ?? "")|lower
    }

    var $rows { value = [] }

    // Try exact feature_key first
    conditional {
      if ($key_clean != "") {
        db.query app_help_content {
          where = $db.app_help_content.feature_key == $key_clean
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $exact_rows
        var.update $rows { value = ($exact_rows.items ?? []) }
      }
    }

    // Fallback: keyword search across feature_display + keywords + short_summary
    conditional {
      if (($rows|length) == 0 && $kw_clean != "") {
        db.query app_help_content {
          where = $db.app_help_content.feature_display |contains: $kw_clean || $db.app_help_content.keywords |contains: $kw_clean || $db.app_help_content.short_summary |contains: $kw_clean
          return = {type: "list", paging: {page: 1, per_page: 3}}
        } as $kw_rows
        var.update $rows { value = ($kw_rows.items ?? []) }
      }
    }

    var $found { value = (($rows|length) > 0) }
    var $top { value = (($rows|first) ?? null) }
  }

  response = {
    success         : true
    found           : $found
    feature_key     : ($top.feature_key ?? "")
    feature_display : ($top.feature_display ?? "")
    in_character_steps: ($top.in_character_steps ?? "")
    short_summary   : ($top.short_summary ?? "")
    matches         : $rows
  }

  guid = "lookup-app-help-v1"
}

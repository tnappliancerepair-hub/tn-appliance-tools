// Tech-side voice toggle — picks between Brooke (female, default)
// and the male variant for all Ant Field Assist calls placed to this
// tech going forward.
query set_tech_voice_preference verb=POST {
  api_group = "intake"

  input {
    int tech_id
    text voice_preference
  }

  stack {
    var $clean_pref {
      value = ($input.voice_preference|to_lowercase)|trim
    }
    precondition ($clean_pref == "brooke" || $clean_pref == "male" || $clean_pref == "sonny" || $clean_pref == "female") {
      error_type = "inputerror"
      error = "voice_preference must be 'brooke' (female) or 'male'"
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    precondition ($tech != null) {
      error_type = "notfound"
      error = "tech not found"
    }

    var $normalized {
      value = ($clean_pref == "female" || $clean_pref == "brooke") ? "brooke" : "male"
    }

    db.edit technicians {
      field_name = "id"
      field_value = $input.tech_id
      data = {voice_preference: $normalized}
    }

    db.add event_log {
      data = {
        action  : "tech_voice_preference_updated"
        metadata: ({tech_id: $input.tech_id, voice_preference: $normalized, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    tech_id: $input.tech_id
    voice_preference: $normalized
  }

  guid = "set-tech-voice-preference-v1"
}

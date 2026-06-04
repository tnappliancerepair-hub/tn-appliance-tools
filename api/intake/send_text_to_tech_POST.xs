// Brooke calls this when a tech asks her to text him something during
// a call — notes, summary, part numbers, anything. Bypasses the
// tech-SMS allow-list because it's a tech-initiated request, not a
// system-initiated push.
query send_text_to_tech verb=POST {
  api_group = "intake"

  input {
    int tech_id
    text message
    int? job_id?
  }

  stack {
    precondition (($input.message ?? "")|trim != "") {
      error_type = "inputerror"
      error = "message required"
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    precondition ($tech != null) {
      error_type = "notfound"
      error = "tech not found"
    }
    var $tech_phone { value = ($tech.phone ?? "")|trim }
    precondition ($tech_phone != "") {
      error_type = "inputerror"
      error = "tech has no phone on file"
    }
    var $phone_starts_plus { value = (($tech_phone|substr:0:1) == "+") }
    var $tech_phone_e164 {
      value = ($phone_starts_plus == true) ? $tech_phone : ("+1" ~ $tech_phone)
    }
    var $msg_clean { value = $input.message|trim }

    api.request {
      url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
      method = "POST"
      params = {to: $tech_phone_e164, message: $msg_clean, recipient_role: "tech", context: {source: "brooke_text_to_tech", action: "ant_field_assist_intro", tech_id: $input.tech_id, job_id: ($input.job_id ?? 0)}}
      headers = ["Content-Type: application/json"]
    } as $sms_resp

    db.add event_log {
      data = {
        action  : "brooke_texted_tech"
        metadata: ({tech_id: $input.tech_id, job_id: ($input.job_id ?? 0), tech_phone: $tech_phone_e164, message_preview: ($msg_clean|substr:0:200), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    tech_id: $input.tech_id
    ack    : "Text sent — should land in a few seconds."
  }

  guid = "send-text-to-tech-v1"
}

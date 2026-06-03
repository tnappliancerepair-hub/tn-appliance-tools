// One-shot: configure Telnyx call-forwarding on the 888 + 866 vanity
// numbers so they ring Teddy's cell. Bypasses the locked-out Telnyx
// portal entirely. Uses the existing $env.TELNYX_API_KEY.
//
// Usage:
//   POST /setup_vanity_forwarding
//   body: { "token": "tn-vanity-fix-2026-06-02-x9k7q", "to": "+16154855795" }
//
// to is optional — defaults to Teddy's cell.
query setup_vanity_forwarding verb=POST {
  api_group = "intake"

  input {
    text token
    text? to?
  }

  stack {
    var $expected_token {
      value = "tn-vanity-fix-2026-06-02-x9k7q"
    }

    var $supplied_token {
      value = (($input.token ?? "")|trim)
    }

    conditional {
      if ($supplied_token != $expected_token) {
        return {
          value = {
            success: false
            error  : "bad_token"
          }
        }
      }
    }

    var $target {
      value = (($input.to ?? "+16154855795")|trim)
    }

    var $auth_header {
      value = "Bearer " ~ $env.TELNYX_API_KEY
    }

    var $results {
      value = []
    }

    // Number 1 — 888-268-8998
    api.request {
      url = "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=%2B18882688998"
      method = "GET"
      headers = ["Authorization: " ~ $auth_header]
      timeout = 15
    } as $lookup_888

    var $found_888 {
      value = ((($lookup_888.response.result.data ?? [])|first) ?? null)
    }

    var $id_888 {
      value = (($found_888.id ?? "")|to_text)
    }

    conditional {
      if ($id_888 != "") {
        api.request {
          url = "https://api.telnyx.com/v2/phone_numbers/" ~ $id_888 ~ "/voice"
          method = "PATCH"
          headers = ["Authorization: " ~ $auth_header, "Content-Type: application/json"]
          params = {
            call_forwarding: {
              call_forwarding_enabled: true
              forwards_to            : $target
              forwarding_type        : "always"
            }
          }
          timeout = 15
        } as $patch_888

        var $result_888 {
          value = {
            number : "+18882688998"
            id     : $id_888
            status : ($patch_888.response.status ?? 0)
            body   : ($patch_888.response.result ?? null)
          }
        }

        var.update $results {
          value = ($results|push:$result_888)
        }
      }
    }

    conditional {
      if ($id_888 == "") {
        var.update $results {
          value = ($results|push:{number:"+18882688998",error:"not_found_in_account"})
        }
      }
    }

    // Number 2 — 866-268-0111
    api.request {
      url = "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=%2B18662680111"
      method = "GET"
      headers = ["Authorization: " ~ $auth_header]
      timeout = 15
    } as $lookup_866

    var $found_866 {
      value = ((($lookup_866.response.result.data ?? [])|first) ?? null)
    }

    var $id_866 {
      value = (($found_866.id ?? "")|to_text)
    }

    conditional {
      if ($id_866 != "") {
        api.request {
          url = "https://api.telnyx.com/v2/phone_numbers/" ~ $id_866 ~ "/voice"
          method = "PATCH"
          headers = ["Authorization: " ~ $auth_header, "Content-Type: application/json"]
          params = {
            call_forwarding: {
              call_forwarding_enabled: true
              forwards_to            : $target
              forwarding_type        : "always"
            }
          }
          timeout = 15
        } as $patch_866

        var $result_866 {
          value = {
            number : "+18662680111"
            id     : $id_866
            status : ($patch_866.response.status ?? 0)
            body   : ($patch_866.response.result ?? null)
          }
        }

        var.update $results {
          value = ($results|push:$result_866)
        }
      }
    }

    conditional {
      if ($id_866 == "") {
        var.update $results {
          value = ($results|push:{number:"+18662680111",error:"not_found_in_account"})
        }
      }
    }

    db.add event_log {
      data = {
        action  : "vanity_forwarding_configured"
        metadata: ({target:$target,results:$results}|json_encode)
      }
    }
  }

  response = {
    success: true
    target : $target
    results: $results
  }

  guid = "setup-vanity-forwarding-v1"
}

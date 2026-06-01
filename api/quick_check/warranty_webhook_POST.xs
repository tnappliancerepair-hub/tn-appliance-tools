query warranty_webhook verb=POST {
  api_group = "quick_check"

  input {
    text rawRequest
  }

  stack {
    var $payload_outer {
      value = $input[""]
    }
  
    var $parsed_inner {
      value = $payload_outer.rawRequest|json_decode
    }
  }

  response = {
    status       : "debug"
    payload_outer: $payload_outer
    parsed_inner : $parsed_inner
  }

  guid = "USg3eGwlqcF3Klsf6NkAu46w4GI"
}
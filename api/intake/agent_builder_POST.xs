query agent_builder verb=POST {
  api_group = "intake"

  input {
    int proposal_id
  }

  stack {
    db.get agent_proposals {
      field_name = "id"
      field_value = $input.proposal_id
    } as $proposal
  
    conditional {
      if ($proposal == null) {
        return {
          value = {success: false, error: "proposal not found"}
        }
      }
    }
  
    var $current_status {
      value = ($proposal.status ?? "")
    }
  
    conditional {
      if ($current_status != "approved") {
        return {
          value = {
            success: false
            error  : "proposal status is '" ~ $current_status ~ "', expected 'approved'"
          }
        }
      }
    }
  
    var $proposal_json {
      value = ```
        ({
                description        : ($proposal.description ?? ""),
                trigger            : ($proposal.trigger ?? ""),
                condition_detected : ($proposal.condition_detected ?? ""),
                proposed_action    : ($proposal.proposed_action ?? "")
              }|json_encode)
        ```
    }
  
    var $prompt_part1 {
      value = "Write a Xano endpoint in XanoScript (XS) implementing this approved agent proposal: "
    }
  
    var $prompt_part2 {
      value = '. The endpoint must be verb=POST and api_group="intake". Use var declarations with the { value = ... } block form. Use var.update for mutation, never reassignment with equals. Use foreach with the \'each as $item\' syntax to iterate arrays. Use db.query, db.get, db.add, db.edit for table operations. Where clauses use $db.tablename.column expressions. Use api.request for HTTP calls; the response is at $resp.response.status and $resp.response.result. '
    }
  
    var $prompt_part3 {
      value = "FORBIDDEN: em-dashes anywhere in code or comments (use plain hyphens only). FORBIDDEN: try/catch blocks (XS has no exception handling). FORBIDDEN: backtick template literals (use double-quoted strings joined with the tilde operator). FORBIDDEN: the ?? null-coalescing operator inside if() comparisons (the serializer silently strips it; the resulting condition is broken). Use ?? only inside value= assignments. The safe pattern is: declare var $safe { value = ($x ?? 0) } first, then write if ($safe == 0). FORBIDDEN: |trim or any pipe filter inside if() comparisons (same serializer bug). Apply filters in a value= assignment, then test the resulting var. FORBIDDEN: closures, lambdas, named functions inside the stack. FORBIDDEN: while loops (only foreach over arrays is supported). FORBIDDEN: SQL placeholder syntax like ? or $1 in where clauses. "
    }
  
    var $prompt_example {
      value = 'EXAMPLE of correct XanoScript structure: query example_agent verb=POST { api_group = intake input { } stack { var window { value = (now|transform_timestamp:"-7 days") } db.query jobs { where = $db.jobs.created_at >= $window sort = {jobs.created_at: "desc"} return = {type: "list", paging: {page: 1, per_page: 100}} } as $rows var $count { value = ($rows.items|count) } db.add event_log { data = {action: "example_ran", metadata: {count: $count}} } as $log } response = {success: true, count: $count} guid = "example-v1" } '
    }
  
    var $prompt_part4 {
      value = 'REQUIRED: log results to event_log via db.add at the end of the stack. REQUIRED: end the endpoint with a response = {...} block and a guid = "..." line. Output ONLY a single valid JSON object with these four fields: endpoint_name (snake_case, lowercase, only a-z 0-9 and underscore), xanoscript (the full XS code starting with \'query <name> verb=POST {\' and ending with the closing brace), frequency_seconds (86400 for daily, 604800 for weekly), description (one-sentence summary). Do not wrap the JSON in markdown fences. Do not include any text before or after the JSON.'
    }
  
    var $prompt_text {
      value = $prompt_part1 ~ $proposal_json ~ $prompt_part2 ~ $prompt_part3 ~ $prompt_example ~ $prompt_part4
    }
  
    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-sonnet-4-5"
        max_tokens: 4096
        messages  : [
          {role: "user", content: $prompt_text}
        ]
      }
    
      headers = [
        "x-api-key: " ~ ($env.ANTHROPIC_API_KEY|to_text)
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]
    
      timeout = 120
    } as $claude_response
  
    var $claude_status {
      value = ($claude_response.response.status ?? 0)
    }
  
    conditional {
      if ($claude_status < 200 || $claude_status >= 300) {
        return {
          value = {
            success: false
            error  : "Claude API returned " ~ ($claude_status|to_text)
          }
        }
      }
    }
  
    var $content_arr {
      value = ($claude_response.response.result.content ?? [])
    }
  
    var $content_count {
      value = $content_arr|count
    }
  
    conditional {
      if ($content_count == 0) {
        return {
          value = {
            success: false
            error  : "Claude returned empty content array"
          }
        }
      }
    }
  
    var $first_block {
      value = $content_arr|get:0
    }
  
    var $reply_text {
      value = ($first_block.text ?? "")
    }
  
    var $cleaned_reply {
      value = $reply_text
        |replace:"```json":""
        |replace:"```":""
        |trim
    }
  
    conditional {
      if ($cleaned_reply == "") {
        return {
          value = {
            success: false
            error  : "Claude reply was empty after fence stripping"
          }
        }
      }
    }
  
    var $parsed {
      value = $cleaned_reply|json_decode
    }
  
    conditional {
      if ($parsed == null) {
        return {
          value = {
            success: false
            error  : "Claude reply was not valid JSON"
          }
        }
      }
    }
  
    var $raw_name {
      value = (($parsed.endpoint_name ?? "")|trim|to_lower)
    }
  
    var $endpoint_name {
      value = $raw_name
    }
  
    db.add event_log {
      data = {
        action  : "agent_builder_debug"
        metadata: {
        reply_text_preview  : $reply_text|substr:0:500
        cleaned_preview     : $cleaned_reply|substr:0:500
        parsed_endpoint_name: ($parsed.endpoint_name ?? "NULL")
        raw_name            : ($raw_name ?? "NULL")
        endpoint_name_final : ($endpoint_name ?? "NULL")
      }
      }
    } as $debug_log
  
    conditional {
      if ($endpoint_name == "") {
        return {
          value = {
            success: false
            error  : "Claude did not provide a valid endpoint_name"
          }
        }
      }
    }
  
    var $xs_body {
      value = ($parsed.xanoscript ?? "")
    }
  
    conditional {
      if ($xs_body == "") {
        return {
          value = {
            success: false
            error  : "Claude did not provide xanoscript"
          }
        }
      }
    }
  
    var $frequency {
      value = ($parsed.frequency_seconds ?? 86400)
    }
  
    var $endpoint_desc {
      value = ($parsed.description ?? "Auto-built by agent_builder")
    }
  
    var $meta_token {
      value = (($env.XANO_METADATA_TOKEN ?? "")|trim)
    }
  
    conditional {
      if ($meta_token == "") {
        return {
          value = {
            success: false
            error  : "XANO_METADATA_TOKEN env var not set"
          }
        }
      }
    }
  
    // Call Metadata API to create the new endpoint
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/apigroup/4/api"
      method = "POST"
      params = {
        name       : $endpoint_name
        description: $endpoint_desc
        verb       : "POST"
        auth       : {active: false}
        cache      : {active: false}
        tags       : []
        xanoscript : $xs_body
      }
    
      headers = [
        "Authorization: Bearer " ~ $meta_token
        "Content-Type: application/json"
      ]
    
      timeout = 60
    } as $create_resp
  
    var $create_status {
      value = ($create_resp.response.status ?? 0)
    }
  
    conditional {
      if ($create_status < 200 || $create_status >= 300) {
        return {
          value = {
            success: false
            error  : "Metadata API create returned " ~ ($create_status|to_text)
            detail : ($create_resp.response.result ?? null)
          }
        }
      }
    }
  
    var $new_endpoint_id {
      value = ($create_resp.response.result.id ?? 0)
    }
  
    db.add event_log {
      data = {
        action  : "agent_builder_create_result"
        metadata: {
        create_status : $create_status
        endpoint_id   : $new_endpoint_id
        result_preview: (($create_resp.response.result ?? "null")|json_encode|substr:0:300)
      }
      }
    } as $create_debug_log
  
    var $deploy_status {
      value = "pending_paste"
    }
  
    var $enabled_flag {
      value = false
    }
  
    var $next_run {
      value = (now + ($frequency * 1000))
    }
  
    db.add agent_queue {
      data = {
        agent_name       : $endpoint_name
        endpoint_path    : ("https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/" ~ $endpoint_name)
        frequency_seconds: $frequency
        next_run_at      : $next_run
        last_run_at      : null
        last_run_status  : null
        enabled          : $enabled_flag
        config           : null
      }
    } as $new_queue_row
  
    db.edit agent_proposals {
      field_name = "id"
      field_value = $input.proposal_id
      data = {status: "built", built_at: now}
    } as $proposal_updated
  
    var $owner_phone {
      value = (($env.OWNER_PHONE_NUMBER ?? "")|trim)
    }
  
    var $cadence_label {
      value = "weekly"
    }
  
    conditional {
      if ($frequency == 86400) {
        var.update $cadence_label {
          value = "daily"
        }
      }
    }
  
    var $sms_body {
      value = ("[ant] shell created: " ~ $endpoint_name ~ " - paste XS body in Xano UI then flip enabled=true in agent_queue. queue id=" ~ ($new_queue_row.id|to_text) ~ ", runs " ~ $cadence_label)
    }
  
    conditional {
      if ($owner_phone != "") {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $owner_phone, message: $sms_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sms_resp
      }
    }
  
    db.add event_log {
      data = {
        action  : "agent_builder_deployed"
        metadata: {
        proposal_id  : $input.proposal_id
        endpoint_name: $endpoint_name
        endpoint_id  : $new_endpoint_id
        queue_id     : $new_queue_row.id
        deploy_status: $deploy_status
        frequency    : $frequency
        xs_chars     : $xs_body|count
      }
      }
    } as $audit_log
  }

  response = {
    success      : true
    proposal_id  : $input.proposal_id
    endpoint_name: $endpoint_name
    endpoint_id  : $new_endpoint_id
    queue_id     : $new_queue_row.id
    deploy_status: $deploy_status
    frequency    : $frequency
  }

  guid = "6F7F3hX6WoEfLFjGTYzziKxqQ74"
}
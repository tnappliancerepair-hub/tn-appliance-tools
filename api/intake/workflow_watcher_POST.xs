//  Workflow Watcher - first autonomous agent builder. Scans the last 24hrs
//  of event_log, finds action patterns repeating 3+ times, and asks Claude
//  to propose ONE automation per pattern. Writes proposals to agent_proposals
//  for human review. SMS Teddy a summary if any new proposals were written.
// 
//  Called by scheduled task (daily, probably 6-7am CT so the summary lands
//  before Teddy's morning routine).
query workflow_watcher verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    // 1. Time window - last 24 hours.
    var $twenty_four_hours_ago {
      value = now|transform_timestamp:"-24 hours"
    }
  
    // 2. Pull recent event_log rows.
    db.query event_log {
      where = $db.event_log.created_at >= $twenty_four_hours_ago
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5000}}
    } as $events_list
  
    // 3. Build list of unique action names. Two-pass approach avoids the
    // dynamic-key map ops that can be flaky in XanoScript.
    var $unique_actions {
      value = []
    }
  
    foreach ($events_list.items) {
      each as $ev {
        var $action_key {
          value = ($ev.action ?? "unknown")
        }
      
        var $already_seen {
          value = false
        }
      
        foreach ($unique_actions) {
          each as $a {
            conditional {
              if ($a == $action_key) {
                var.update $already_seen {
                  value = true
                }
              }
            }
          }
        }
      
        conditional {
          if ($already_seen == false) {
            array.push $unique_actions {
              value = $action_key
            }
          }
        }
      }
    }
  
    // 4. Count occurrences + capture first sample for each unique action.
    // Only keep actions with count >= 3.
    var $repeated_patterns {
      value = []
    }
  
    foreach ($unique_actions) {
      each as $action_name {
        var $count {
          value = 0
        }
      
        var $first_sample {
          value = null
        }
      
        foreach ($events_list.items) {
          each as $ev2 {
            var $ev2_action {
              value = ($ev2.action ?? "")
            }
          
            conditional {
              if ($ev2_action == $action_name) {
                var.update $count {
                  value = $count + 1
                }
              
                conditional {
                  if ($first_sample == null) {
                    var.update $first_sample {
                      value = ($ev2.metadata ?? {})
                    }
                  }
                }
              }
            }
          }
        }
      
        conditional {
          if ($count >= 3) {
            array.push $repeated_patterns {
              value = {
                action: $action_name
                count : $count
                sample: $first_sample
              }
            }
          }
        }
      }
    }
  
    // 5. For each repeated pattern, ask Claude for an automation proposal.
    var $proposals_count {
      value = 0
    }
  
    foreach ($repeated_patterns) {
      each as $p {
        var $sample_json {
          value = ($p.sample ?? {})|json_encode
        }
      
        var $prompt_text {
          value = "You are analyzing a field service business called TN Appliance Exchange. Here is a pattern detected in the last 24 hours: action=" ~ $p.action ~ ", count=" ~ ($p.count|to_text) ~ ", sample_metadata=" ~ $sample_json ~ ". Propose ONE specific automation agent that would reduce manual work. Respond in JSON only with fields: description, trigger, condition_detected, proposed_action, time_saved_estimate."
        }
      
        api.request {
          url = "https://api.anthropic.com/v1/messages"
          method = "POST"
          params = {
            model     : "claude-sonnet-4-5-20250929"
            max_tokens: 1024
            messages  : [
              {role: "user", content: $prompt_text}
            ]
          }
        
          headers = [
            "x-api-key: " ~ $env.ANTHROPIC_API_KEY
            "anthropic-version: 2023-06-01"
            "content-type: application/json"
          ]
        
          timeout = 60
        } as $claude_response
      
        // Defensive Claude response parsing (pre-extract to vars to keep
        // ?? out of if() comparisons - serializer-bug avoidance).
        var $claude_status {
          value = ($claude_response.response.status ?? 0)
        }
      
        var $reply_text {
          value = ""
        }
      
        conditional {
          if ($claude_status >= 200 && $claude_status < 300) {
            var $content_arr {
              value = ($claude_response.response.result.content ?? [])
            }
          
            var $content_count {
              value = $content_arr|count
            }
          
            conditional {
              if ($content_count > 0) {
                var $first_item {
                  value = $content_arr|get:0
                }
              
                var.update $reply_text {
                  value = ($first_item.text ?? "")
                }
              }
            }
          }
        }
      
        // Parse JSON response. Skip if malformed.
        var $parsed {
          value = $reply_text|json_decode
        }
      
        conditional {
          if ($parsed != null) {
            db.add agent_proposals {
              data = {
                description        : ($parsed.description ?? "")
                trigger            : ($parsed.trigger ?? "")
                condition_detected : ($parsed.condition_detected ?? "")
                proposed_action    : ($parsed.proposed_action ?? "")
                time_saved_estimate: ($parsed.time_saved_estimate ?? "")
                pattern_count      : $p.count
                status             : "pending"
                source_builder     : "workflow_watcher"
              }
            } as $new_proposal
          
            var.update $proposals_count {
              value = $proposals_count + 1
            }
          }
        }
      }
    }
  
    // 6. SMS Teddy if any proposals were written.
    var $owner_phone {
      value = (($env.OWNER_PHONE_NUMBER ?? "")|trim)
    }
  
    conditional {
      if ($owner_phone != "" && $proposals_count > 0) {
        var $sms_body {
          value = "[ant] workflow watcher found " ~ ($proposals_count|to_text) ~ " automation opportunities overnight. review at tnapplianceexchange.net/agent-proposals"
        }
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $owner_phone, message: $sms_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sms_resp
      }
    }
  
    // 7. Audit log.
    db.add event_log {
      data = {
        action  : "workflow_watcher_ran"
        metadata: {
        events_scanned   : $events_list.items|count
        unique_actions   : $unique_actions|count
        repeated_patterns: $repeated_patterns|count
        proposals_written: $proposals_count
      }
      }
    } as $audit_log
  }

  response = {
    success          : true
    events_scanned   : $events_list.items|count
    repeated_patterns: $repeated_patterns|count
    proposals_written: $proposals_count
  }

  guid = "dpbFDBK5f5Crd2d8dcxp3DI9taA"
}
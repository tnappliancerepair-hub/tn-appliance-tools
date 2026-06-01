query "chat/reply2" verb=POST {
  api_group = "intake"

  input {
    text channel?
    int? conversation_id?
    text customer_phone? filters=trim
    int? customer_id?
    text message filters=trim
  }

  stack {
    var $customer_id {
      value = 0
    }
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($input.customer_id != null && $input.customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $input.customer_id
        } as $customer
      
        var.update $customer_id {
          value = $customer.id
        }
      }
    
      elseif ($input.customer_phone != null) {
        db.query customer {
          where = $db.customer.phone == $input.customer_phone
          return = {type: "single"}
        } as $customer
      
        conditional {
          if ($customer == null) {
            db.add customer {
              data = {phone: $input.customer_phone}
            } as $customer
          
            var.update $customer_id {
              value = $customer.id
            }
          }
        
          else {
            var.update $customer_id {
              value = $customer.id
            }
          }
        }
      }
    }
  
    var $conversation {
      value = null
    }
  
    var $week_ago {
      value = now|transform_timestamp:"-7 days"
    }
  
    conditional {
      if ($input.conversation_id != null && $input.conversation_id > 0) {
        db.get agent_conversation {
          field_name = "id"
          field_value = $input.conversation_id
        } as $conversation
      }
    
      elseif ($customer != null) {
        db.query agent_conversation {
          where = $db.agent_conversation.customer_id == $customer.id && $db.agent_conversation.created_at >= $week_ago
          sort = {agent_conversation.created_at: "desc"}
          return = {type: "single"}
        } as $conversation
      }
    }
  
    conditional {
      if ($conversation == null) {
        db.add agent_conversation {
          data = {title: "New Conversation", last_message_at: "now"}
        } as $conversation
      }
    }
  
    conditional {
      if ($conversation.customer_id == null && $customer != null) {
        db.edit agent_conversation {
          field_name = "id"
          field_value = $conversation.id
          data = {customer_id: $customer.id}
        } as $conversation
      }
    }
  
    var $system_prompt_final {
      value = $env.SYSTEM_PROMPT
    }
  
    // Get last 6 messages
    db.query agent_message {
      where = $db.agent_message.conversation_id == $conversation.id
      sort = {agent_message.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $recent_messages_desc
  
    var $recent_messages {
      value = $recent_messages_desc.items|reverse
    }
  
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "user"
        content        : $input.message
      }
    } as $new_user_message
  
    var $claude_messages {
      value = []
    }
  
    foreach ($recent_messages) {
      each as $msg {
        array.push $claude_messages {
          value = {role: $msg.role, content: $msg.content}
        }
      }
    }
  
    array.push $claude_messages {
      value = {role: "user", content: $input.message}
    }
  
    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-sonnet-4-5-20250929"
        max_tokens: 1024
        system    : $system_prompt_final
        messages  : $claude_messages
      }
    
      headers = [
        "x-api-key: " ~ $env.ANTHROPIC_API_KEY
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]
    
      timeout = 40
    } as $claude_response
  
    var $reply_text {
      value = $claude_response.response.result.content[0].text
    }
  
    var $clean_reply {
      value = $reply_text
    }
  
    var $job_created {
      value = false
    }
  
    conditional {
      if ($reply_text|contains:"%%JOB_READY%%") {
        var $parts {
          value = $reply_text|split:"%%JOB_READY%%"
        }
      
        var.update $clean_reply {
          value = $parts|get:0|trim
        }
      
        var $json_raw {
          value = $parts|get:1|trim
        }
      
        var $job_data {
          value = $json_raw|json_decode
        }
      
        conditional {
          if ($job_data != null) {
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/create_job_from_chat"
              method = "POST"
              params = ```
                {
                  first_name              : $job_data.first_name
                  last_name               : $job_data.last_name
                  phone                   : $job_data.phone
                  zip                     : $job_data.zip
                  appliance_type          : $job_data.appliance_type
                  brand                   : $job_data.brand
                  model_number            : $job_data.model_number
                  problem_summary         : $job_data.problem_summary
                  recommended_service     : $job_data.recommended_service|first_notempty:"quick_check"
                  channel                 : "web_chat"
                  customer_preference_text: $job_data.customer_preference_text
                  scheduling_type         : $job_data.scheduling_type
                  sms_consent             : $job_data.sms_consent
                  sms_consent_at          : $job_data.sms_consent_at
                }
                ```
              headers = ["Content-Type: application/json"]
            } as $created_job
          
            var.update $job_created {
              value = true
            }
          }
        }
      }
    
      elseif ($reply_text|contains:"__JOB_READY__") {
        var $parts {
          value = $reply_text|split:"__JOB_READY__"
        }
      
        var.update $clean_reply {
          value = $parts|get:0|trim
        }
      
        var $json_raw {
          value = $parts|get:1|trim
        }
      
        var $job_data {
          value = $json_raw|json_decode
        }
      
        conditional {
          if ($job_data != null) {
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/create_job_from_chat"
              method = "POST"
              params = ```
                {
                  first_name              : $job_data.first_name
                  last_name               : $job_data.last_name
                  phone                   : $job_data.phone
                  zip                     : $job_data.zip
                  appliance_type          : $job_data.appliance_type
                  brand                   : $job_data.brand
                  model_number            : $job_data.model_number
                  problem_summary         : $job_data.problem_summary
                  recommended_service     : $job_data.recommended_service|first_notempty:"quick_check"
                  channel                 : "web_chat"
                  customer_preference_text: $job_data.customer_preference_text
                  scheduling_type         : $job_data.scheduling_type
                  sms_consent             : $job_data.sms_consent
                  sms_consent_at          : $job_data.sms_consent_at
                }
                ```
              headers = ["Content-Type: application/json"]
            } as $created_job
          
            var.update $job_created {
              value = true
            }
          }
        }
      }
    }
  
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "assistant"
        content        : $clean_reply
      }
    } as $new_assistant_message
  
    db.edit agent_conversation {
      field_name = "id"
      field_value = $conversation.id
      data = {last_message_at: "now"}
    } as $updated_conversation
  
    return {
      value = {
        reply          : $clean_reply
        conversation_id: $conversation.id
        customer_id    : $customer_id
        success        : true
      }
    }
  }

  response = null
  guid = "iV_hN_5Nqt0qULv51Lm_Ppf6UNQ"
}
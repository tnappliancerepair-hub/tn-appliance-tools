// API endpoint to handle user messages and get a reply from Claude
// Response mapping
// Unique identifier
query "chat/reply" verb=POST {
  api_group = "intake"

  input {
    // Communication channel (e.g., web_chat, sms)
    text channel?
  
    // Unique ID of the conversation
    int? conversation_id?
  
    // Customer phone number for identification
    text customer_phone? filters=trim
  
    // Unique ID of the customer
    int? customer_id?
  
    // The message sent by the user
    text message filters=trim
  }

  stack {
    // Initialize customer variable
    var $customer {
      value = null
    }
  
    // Initialize customer ID variable
    var $customer_id {
      value = 0
    }
  
    // Identify or create the customer based on input
    conditional {
      if ($input.customer_id != null && $input.customer_id > 0) {
        // Retrieve existing customer by ID
        db.get customer {
          field_name = "id"
          field_value = $input.customer_id
        } as $customer
      
        // Update customer ID variable
        var.update $customer_id {
          value = $customer.id
        }
      }
    
      elseif ($input.customer_phone != null) {
        // Search for customer by phone number
        db.query customer {
          where = $db.customer.phone == $input.customer_phone
          return = {type: "single"}
        } as $customer
      
        // Create new customer if not found
        conditional {
          if ($customer == null) {
            // Add new customer to database
            db.add customer {
              data = {phone: $input.customer_phone}
            } as $customer
          
            // Update customer ID variable
            var.update $customer_id {
              value = $customer.id
            }
          }
        
          else {
            // Use existing customer ID
            var.update $customer_id {
              value = $customer.id
            }
          }
        }
      }
    }
  
    // Initialize conversation variable
    var $conversation {
      value = null
    }
  
    // Calculate timestamp for one week ago
    var $week_ago {
      value = now|transform_timestamp:"-7 days"
    }
  
    // Find or resume a conversation
    conditional {
      if ($input.conversation_id != null && $input.conversation_id > 0) {
        // Get conversation by ID
        db.get agent_conversation {
          field_name = "id"
          field_value = $input.conversation_id
        } as $conversation
      }
    
      elseif ($customer != null) {
        // Find recent conversation for the customer
        db.query agent_conversation {
          where = $db.agent_conversation.customer_id == $customer.id && $db.agent_conversation.created_at >= $week_ago
          sort = {agent_conversation.created_at: "desc"}
          return = {type: "single"}
        } as $conversation
      }
    }
  
    // Create a new conversation if none exists
    conditional {
      if ($conversation == null) {
        // Add new conversation record
        db.add agent_conversation {
          data = {title: "New Conversation", last_message_at: "now"}
        } as $conversation
      }
    }
  
    // Link customer to conversation if missing
    conditional {
      if ($conversation.customer_id == null && $customer != null) {
        // Update conversation with customer ID
        db.edit agent_conversation {
          field_name = "id"
          field_value = $conversation.id
          data = {customer_id: $customer.id}
        } as $conversation
      }
    }
  
    // Fetch recent messages for context
    db.query agent_message {
      where = $db.agent_message.conversation_id == $conversation.id
      sort = {agent_message.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 6}}
    } as $recent_messages_desc
  
    // Reverse messages to chronological order
    var $recent_messages {
      value = $recent_messages_desc.items|reverse
    }
  
    // Save the new user message to the database
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "user"
        content        : $input.message
      }
    } as $new_user_message
  
    // Prepare message history for Claude API
    var $claude_messages {
      value = []
    }
  
    // Build message array from history
    foreach ($recent_messages) {
      each as $msg {
        // Add historical message to array
        array.push $claude_messages {
          value = {role: $msg.role, content: $msg.content}
        }
      }
    }
  
    // Add current user message to Claude messages
    array.push $claude_messages {
      value = {role: "user", content: $input.message}
    }
  
    // Request a completion from Anthropic Claude API
    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-sonnet-4-5-20250929"
        max_tokens: 300
        system    : $env.SYSTEM_PROMPT
        messages  : $claude_messages
      }
    
      headers = [
        "x-api-key: " ~ $env.ANTHROPIC_API_KEY
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]
    
      timeout = 25
    } as $claude_response
  
    // Extract text reply from Claude response
    var $reply_text {
      value = $claude_response.response.result.content[0].text
    }
  
    // Initialize delimiter for structured data detection
    var $delimiter {
      value = null
    }
  
    // Store original reply for debugging
    var $debug_reply {
      value = $reply_text
    }
  
    // Detect special delimiters in the response
    conditional {
      if ($reply_text|contains:"%%JOB_READY%%") {
        // Set delimiter for job ready
        var.update $delimiter {
          value = "%%JOB_READY%%"
        }
      }
    
      elseif ($reply_text|contains:"JOB_READY") {
        // Set delimiter for job ready (no markers)
        var.update $delimiter {
          value = "JOB_READY"
        }
      }
    
      elseif ($reply_text|contains:"%%WARRANTY_READY%%") {
        // Set delimiter for warranty ready
        var.update $delimiter {
          value = "%%WARRANTY_READY%%"
        }
      }
    
      elseif ($reply_text|contains:"WARRANTY_READY") {
        // Set delimiter for warranty ready (no markers)
        var.update $delimiter {
          value = "WARRANTY_READY"
        }
      }
    }
  
    // Flag for job creation status
    var $job_created {
      value = false
    }
  
    // Parse structured data if delimiter was found
    conditional {
      if ($delimiter != null) {
        // Split reply into text and structured data
        var $reply_parts {
          value = $reply_text|split:$delimiter
        }
      
        // Check if structured data exists
        conditional {
          if (($reply_parts|count) > 1) {
            // Get raw structured data part
            var $raw_part {
              value = $reply_parts|get:1
            }
          
            // Find start of JSON object
            var $brace_pos {
              value = $raw_part|index:"{"
            }
          
            // Parse JSON if found
            conditional {
              if ($brace_pos != null) {
                // Extract JSON substring
                var $json_string {
                  value = $raw_part|substr:$brace_pos
                }
              
                // Decode JSON to object
                var $job_data {
                  value = $json_string|json_decode
                }
              
                // Process job data if valid
                conditional {
                  if ($job_data != null) {
                    // Check for incomplete data placeholders
                    var $has_placeholders {
                      value = $json_string|contains:"["
                    }
                  
                    // Create job if data is complete
                    conditional {
                      if ($has_placeholders == false) {
                        // Call internal API to create job
                        api.request {
                          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/create_job_from_chat"
                          method = "POST"
                          params = {
                            first_name         : $job_data.first_name
                            last_name          : $job_data.last_name
                            phone              : $job_data.phone
                            zip                : $job_data.zip
                            appliance_type     : $job_data.appliance_type
                            brand              : $job_data.brand
                            model_number       : $job_data.model_number
                            problem_summary    : $job_data.problem_summary
                            recommended_service: $job_data.recommended_service
                            channel            : "web_chat"
                          }
                        } as $created_job
                      
                        // Update job created status
                        var.update $job_created {
                          value = true
                        }
                      }
                    }
                  }
                }
              }
            }
          
            // Get clean text reply without structured data
            var $clean_reply {
              value = $reply_parts|first
            }
          
            // Update reply text with cleaned version
            var.update $reply_text {
              value = $clean_reply|trim
            }
          }
        }
      }
    }
  
    // Save assistant reply to message history
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "assistant"
        content        : $reply_text
      }
    } as $new_assistant_message
  
    // Update conversation timestamp
    db.edit agent_conversation {
      field_name = "id"
      field_value = $conversation.id
      data = {last_message_at: "now"}
    } as $updated_conversation
  
    // Return the response data
    return {
      value = {
        reply          : $reply_text
        conversation_id: $conversation.id
        customer_id    : $customer_id
        success        : true
      }
    }
  }

  response = null
  guid = "NdQNEeSlmktuBjHrjUfD-ORdvFM"
}
//  Customer Experience Builder - fourth autonomous agent builder. Watches
//  customer touchpoints for friction signals over the last 7 days:
//    A) Consent SMS opt-out / no-response rate (consent_request_sent
//       without matching consent_received per customer_id)
//    B) Feedback non-response rate (feedback_queue rows without a matching
//       feedback_reply event for the job_id)
//    C) Self-pay friction: avg days-from-creation-to-completion for
//       self_pay customers vs warranty customers
// 
//  For each finding with a meaningful signal, asks Claude to propose ONE
//  customer experience improvement. Proposals land in agent_proposals with
//  source_builder="customer_experience_builder", reviewed via
//  agent-proposals.html alongside output from other builders.
// 
//  Called by the orchestrator (agent_queue row required).
// 
//  DATA AVAILABILITY NOTE (2026-05-23):
//    - consent_request_sent / consent_received events are NOT currently
//      written to event_log; Finding A will produce 0 signal until those
//      events start firing.
//    - feedback_queue table is currently empty; Finding B will produce 0
//      signal until rows are added.
//    - Finding C is operational today.
query customer_experience_builder verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    var $seven_days_ago {
      value = now|transform_timestamp:"-7 days"
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING A: Consent SMS opt-out / no-response rate
    //   - Pull all consent_request_sent events from last 7 days
    //   - For each, check if any consent_received event exists for the
    //     same customer_id (looked up from metadata.customer_id)
    //   - Compute response rate
    // ════════════════════════════════════════════════════════════════
    db.query event_log {
      where = $db.event_log.action == "consent_request_sent" && $db.event_log.created_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $consent_sent
  
    db.query event_log {
      where = $db.event_log.action == "consent_received" && $db.event_log.created_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $consent_recv
  
    var $consent_sent_count {
      value = $consent_sent.items|count
    }
  
    var $consent_no_response_count {
      value = 0
    }
  
    foreach ($consent_sent.items) {
      each as $cs {
        var $cust_id {
          value = ($cs.metadata.customer_id ?? 0)
        }
      
        var $has_response {
          value = false
        }
      
        foreach ($consent_recv.items) {
          each as $cr {
            var $cr_cust {
              value = ($cr.metadata.customer_id ?? 0)
            }
          
            conditional {
              if ($cr_cust == $cust_id && $cust_id != 0) {
                var.update $has_response {
                  value = true
                }
              }
            }
          }
        }
      
        conditional {
          if ($has_response == false) {
            var.update $consent_no_response_count {
              value = $consent_no_response_count + 1
            }
          }
        }
      }
    }
  
    var $consent_no_response_pct {
      value = 0
    }
  
    conditional {
      if ($consent_sent_count > 0) {
        var.update $consent_no_response_pct {
          value = ($consent_no_response_count * 100) / $consent_sent_count
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING B: Feedback non-response rate
    //   - Pull feedback_queue rows created in last 7 days
    //   - For each, look up event_log for feedback_reply* matching its job_id
    //   - Count "no reply" rows
    // ════════════════════════════════════════════════════════════════
    db.query feedback_queue {
      where = $db.feedback_queue.created_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $fb_queue
  
    var $fb_queue_count {
      value = $fb_queue.items|count
    }
  
    var $fb_no_reply_count {
      value = 0
    }
  
    foreach ($fb_queue.items) {
      each as $fq {
        var $job_id {
          value = ($fq.job_id ?? 0)
        }
      
        var $has_reply {
          value = false
        }
      
        conditional {
          if ($job_id != 0) {
            db.query event_log {
              where = $db.event_log.action == "feedback_reply" && $db.event_log.created_at >= $seven_days_ago
              return = {type: "list", paging: {page: 1, per_page: 50}}
            } as $reply_check
          
            foreach ($reply_check.items) {
              each as $rc {
                var $rc_job {
                  value = ($rc.metadata.job_id ?? 0)
                }
              
                conditional {
                  if ($rc_job == $job_id) {
                    var.update $has_reply {
                      value = true
                    }
                  }
                }
              }
            }
          }
        }
      
        conditional {
          if ($has_reply == false) {
            var.update $fb_no_reply_count {
              value = $fb_no_reply_count + 1
            }
          }
        }
      }
    }
  
    var $fb_no_reply_pct {
      value = 0
    }
  
    conditional {
      if ($fb_queue_count > 0) {
        var.update $fb_no_reply_pct {
          value = ($fb_no_reply_count * 100) / $fb_queue_count
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING C: Self-pay friction
    //   - Pull jobs completed in last 7 days
    //   - Bucket by customer_type, compute avg days_from_creation
    //   - Compare self_pay avg vs warranty avg
    // ════════════════════════════════════════════════════════════════
    db.query jobs {
      where = $db.jobs.job_completed_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $completed_jobs
  
    var $self_pay_sum_ms {
      value = 0
    }
  
    var $self_pay_count {
      value = 0
    }
  
    var $warranty_sum_ms {
      value = 0
    }
  
    var $warranty_count {
      value = 0
    }
  
    foreach ($completed_jobs.items) {
      each as $cj {
        var $created_at_val {
          value = ($cj.created_at ?? 0)
        }
      
        var $completed_at_val {
          value = ($cj.job_completed_at ?? 0)
        }
      
        var $duration_ms {
          value = $completed_at_val - $created_at_val
        }
      
        var $ctype {
          value = (($cj.customer_type ?? "")|trim|to_lower)
        }
      
        conditional {
          if ($ctype == "self_pay" && $duration_ms > 0) {
            var.update $self_pay_sum_ms {
              value = $self_pay_sum_ms + $duration_ms
            }
          
            var.update $self_pay_count {
              value = $self_pay_count + 1
            }
          }
        }
      
        conditional {
          if ($ctype == "warranty" && $duration_ms > 0) {
            var.update $warranty_sum_ms {
              value = $warranty_sum_ms + $duration_ms
            }
          
            var.update $warranty_count {
              value = $warranty_count + 1
            }
          }
        }
      }
    }
  
    // ms-per-day = 86,400,000
    var $self_pay_avg_days {
      value = 0
    }
  
    conditional {
      if ($self_pay_count > 0) {
        var.update $self_pay_avg_days {
          value = ($self_pay_sum_ms / $self_pay_count) / 86400000
        }
      }
    }
  
    var $warranty_avg_days {
      value = 0
    }
  
    conditional {
      if ($warranty_count > 0) {
        var.update $warranty_avg_days {
          value = ($warranty_sum_ms / $warranty_count) / 86400000
        }
      }
    }
  
    var $friction_delta {
      value = $self_pay_avg_days - $warranty_avg_days
    }
  
    // ════════════════════════════════════════════════════════════════
    // BUILD FINDINGS LIST
    // ════════════════════════════════════════════════════════════════
    var $findings {
      value = []
    }
  
    // Finding A: any consent SMS with no_response_pct >= 30% AND
    //            at least 3 consent_request_sent events
    conditional {
      if ($consent_sent_count >= 3 && $consent_no_response_pct >= 30) {
        array.push $findings {
          value = {
            kind   : "consent_no_response"
            summary: ($consent_no_response_count|to_text) ~ " of " ~ ($consent_sent_count|to_text) ~ " consent SMS sent in last 7 days had no consent_received reply (" ~ ($consent_no_response_pct|to_text) ~ "% no-response rate)"
            details: {
              sent_count       : $consent_sent_count
              no_response_count: $consent_no_response_count
              no_response_pct  : $consent_no_response_pct
            }
          }
        }
      }
    }
  
    // Finding B: feedback no-reply rate >= 50% with at least 3 queue rows
    conditional {
      if ($fb_queue_count >= 3 && $fb_no_reply_pct >= 50) {
        array.push $findings {
          value = {
            kind   : "feedback_no_response"
            summary: ($fb_no_reply_count|to_text) ~ " of " ~ ($fb_queue_count|to_text) ~ " feedback requests in last 7 days had no customer reply (" ~ ($fb_no_reply_pct|to_text) ~ "% non-response rate)"
            details: {
              queue_count    : $fb_queue_count
              no_reply_count : $fb_no_reply_count
              no_reply_pct   : $fb_no_reply_pct
            }
          }
        }
      }
    }
  
    // Finding C: self_pay takes >=2 days longer than warranty AND we have
    //            at least 2 of each type for meaningful comparison
    conditional {
      if ($self_pay_count >= 2 && $warranty_count >= 2 && $friction_delta >= 2) {
        array.push $findings {
          value = {
            kind   : "self_pay_friction"
            summary: "Self-pay jobs take " ~ ($friction_delta|to_text) ~ " more days to complete than warranty jobs (self_pay avg=" ~ ($self_pay_avg_days|to_text) ~ "d over " ~ ($self_pay_count|to_text) ~ " jobs, warranty avg=" ~ ($warranty_avg_days|to_text) ~ "d over " ~ ($warranty_count|to_text) ~ " jobs)"
            details: {
              self_pay_count    : $self_pay_count
              self_pay_avg_days : $self_pay_avg_days
              warranty_count    : $warranty_count
              warranty_avg_days : $warranty_avg_days
              friction_delta    : $friction_delta
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // For each finding, ask Claude for ONE customer experience improvement
    // ════════════════════════════════════════════════════════════════
    var $proposals_count {
      value = 0
    }
  
    foreach ($findings) {
      each as $f {
        var $details_json {
          value = ($f.details ?? {})|json_encode
        }
      
        var $prompt_text {
          value = "You are analyzing customer experience for a field service business called TN Appliance Exchange. Here is a friction finding from the last 7 days: kind=" ~ $f.kind ~ ", summary=" ~ $f.summary ~ ", details=" ~ $details_json ~ ". Propose ONE specific customer experience improvement (a copy change, a workflow tweak, an automation, or a touchpoint addition). Respond in JSON only with fields: description, trigger, condition_detected, proposed_action, time_saved_estimate."
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
                pattern_count      : 1
                status             : "pending"
                source_builder     : "customer_experience_builder"
              }
            } as $new_proposal
          
            var.update $proposals_count {
              value = $proposals_count + 1
            }
          }
        }
      }
    }
  
    // SMS Teddy if any proposals written.
    var $owner_phone {
      value = (($env.OWNER_PHONE_NUMBER ?? "")|trim)
    }
  
    conditional {
      if ($owner_phone != "" && $proposals_count > 0) {
        var $sms_body {
          value = "[ant] customer experience builder found " ~ ($proposals_count|to_text) ~ " friction signals this week. review at tnapplianceexchange.net/agent-proposals"
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
  
    // Audit log.
    db.add event_log {
      data = {
        action  : "customer_experience_builder_ran"
        metadata: {
        consent_sent_count : $consent_sent_count
        consent_no_response: $consent_no_response_count
        consent_no_resp_pct: $consent_no_response_pct
        fb_queue_count     : $fb_queue_count
        fb_no_reply_count  : $fb_no_reply_count
        fb_no_reply_pct    : $fb_no_reply_pct
        self_pay_count     : $self_pay_count
        self_pay_avg_days  : $self_pay_avg_days
        warranty_count     : $warranty_count
        warranty_avg_days  : $warranty_avg_days
        friction_delta     : $friction_delta
        findings_count     : $findings|count
        proposals_written  : $proposals_count
      }
      }
    } as $audit_log
  }

  response = {
    success          : true
    consent_sent     : $consent_sent_count
    consent_no_resp  : $consent_no_response_count
    fb_queue         : $fb_queue_count
    fb_no_reply      : $fb_no_reply_count
    self_pay_count   : $self_pay_count
    warranty_count   : $warranty_count
    friction_delta   : $friction_delta
    findings_count   : $findings|count
    proposals_written: $proposals_count
  }

  guid = "gIoCxCOLKFnHXkpfSuqWyg1wmZQ"
}
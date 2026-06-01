//  Revenue Optimizer - third autonomous agent builder. Watches the money.
//  Surfaces three signals each week:
//    A) Pending-payment backlog per tech (cash-flow snapshot)
//    B) Completed jobs with no tech_earnings row (money leaking through the
//       pipeline - earnings stub creation bug or manual completion)
//    C) No-repair (closed) jobs per tech, especially when concentrated
//       (high no-repair rates can indicate triage gaps or tech behavior)
// 
//  For each finding with a meaningful signal, asks Claude to propose ONE
//  revenue improvement. Proposals land in agent_proposals with
//  source_builder="revenue_optimizer" alongside workflow_watcher and
//  error_hunter output, reviewed via agent-proposals.html.
// 
//  Called by scheduled task (weekly, probably Monday morning).
query revenue_optimizer verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    // 1. Time window - last 7 days.
    var $seven_days_ago {
      value = now|transform_timestamp:"-7 days"
    }
  
    // 2. Tech roster (used for grouping + tech name lookup).
    db.query technicians {
      where = $db.technicians.active == true
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $techs_list
  
    // ════════════════════════════════════════════════════════════════
    // FINDING A: Pending payment backlog
    // ════════════════════════════════════════════════════════════════
    db.query tech_earnings {
      where = $db.tech_earnings.status == "pending_payment" && $db.tech_earnings.earned_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $pending_earnings
  
    var $total_pending {
      value = 0
    }
  
    var $pending_by_tech {
      value = []
    }
  
    foreach ($techs_list.items) {
      each as $t {
        var $tech_sum {
          value = 0
        }
      
        var $tech_count {
          value = 0
        }
      
        foreach ($pending_earnings.items) {
          each as $e {
            conditional {
              if ($e.tech_id == $t.id) {
                var.update $tech_sum {
                  value = $tech_sum + ($e.commission_earned ?? 0)
                }
              
                var.update $tech_count {
                  value = $tech_count + 1
                }
              }
            }
          }
        }
      
        conditional {
          if ($tech_count > 0) {
            array.push $pending_by_tech {
              value = {
                tech_id  : $t.id
                tech_name: ($t.name ?? "tech_" ~ ($t.id|to_text))
                row_count: $tech_count
                total_due: $tech_sum
              }
            }
          
            var.update $total_pending {
              value = $total_pending + $tech_sum
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING B: Completed jobs (scheduling_status="complete") with no
    //            tech_earnings row in last 7 days. Money-leak signal.
    // ════════════════════════════════════════════════════════════════
    db.query jobs {
      where = $db.jobs.scheduling_status == "complete" && $db.jobs.job_completed_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $completed_jobs
  
    var $uninvoiced_jobs {
      value = []
    }
  
    foreach ($completed_jobs.items) {
      each as $cj {
        db.query tech_earnings {
          where = $db.tech_earnings.job_id == $cj.id
          return = {type: "list", paging: {page: 1, per_page: 5}}
        } as $earn_check
      
        var $earn_count {
          value = $earn_check.items|count
        }
      
        conditional {
          if ($earn_count == 0) {
            array.push $uninvoiced_jobs {
              value = {
                job_id        : $cj.id
                technician_id : ($cj.technician_id ?? 0)
                completed_at  : ($cj.job_completed_at ?? "")
                appliance_type: ($cj.appliance_type ?? "")
              }
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING C: No-repair (scheduling_status="closed") jobs per tech
    //            in last 7 days. High concentration = triage gap.
    // ════════════════════════════════════════════════════════════════
    db.query jobs {
      where = $db.jobs.scheduling_status == "closed" && $db.jobs.job_completed_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $no_repair_jobs
  
    // Also pull all completed (any scheduling_status with job_completed_at set)
    // so we can compute the no-repair rate denominator.
    db.query jobs {
      where = $db.jobs.job_completed_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $all_recent_completed
  
    var $no_repair_by_tech {
      value = []
    }
  
    foreach ($techs_list.items) {
      each as $t2 {
        var $nr_count {
          value = 0
        }
      
        foreach ($no_repair_jobs.items) {
          each as $nrj {
            conditional {
              if ($nrj.technician_id == $t2.id) {
                var.update $nr_count {
                  value = $nr_count + 1
                }
              }
            }
          }
        }
      
        var $total_count {
          value = 0
        }
      
        foreach ($all_recent_completed.items) {
          each as $arj {
            conditional {
              if ($arj.technician_id == $t2.id) {
                var.update $total_count {
                  value = $total_count + 1
                }
              }
            }
          }
        }
      
        var $rate_pct {
          value = 0
        }
      
        conditional {
          if ($total_count > 0) {
            var.update $rate_pct {
              value = ($nr_count * 100) / $total_count
            }
          }
        }
      
        // Threshold: tech has >= 2 no-repair AND rate >= 25%
        conditional {
          if ($nr_count >= 2 && $rate_pct >= 25) {
            array.push $no_repair_by_tech {
              value = {
                tech_id        : $t2.id
                tech_name      : ($t2.name ?? "tech_" ~ ($t2.id|to_text))
                no_repair_count: $nr_count
                total_count    : $total_count
                rate_pct       : $rate_pct
              }
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // BUILD FINDINGS LIST - one entry per Claude call
    // ════════════════════════════════════════════════════════════════
    var $findings {
      value = []
    }
  
    // Finding A signal threshold: total pending > $100
    conditional {
      if ($total_pending > 100) {
        array.push $findings {
          value = {
            kind   : "pending_payment_backlog"
            summary: "Total pending across all techs: $" ~ ($total_pending|to_text) ~ " across " ~ ($pending_earnings.items|count|to_text) ~ " earning rows over last 7 days"
            details: $pending_by_tech
          }
        }
      }
    }
  
    // Finding B signal threshold: any uninvoiced completion
    var $uninvoiced_count {
      value = $uninvoiced_jobs|count
    }
  
    conditional {
      if ($uninvoiced_count >= 1) {
        array.push $findings {
          value = {
            kind   : "uninvoiced_completions"
            summary: ($uninvoiced_count|to_text) ~ " completed jobs in last 7 days have no tech_earnings row - revenue is leaking"
            details: $uninvoiced_jobs
          }
        }
      }
    }
  
    // Finding C: any tech with concentrated no-repair pattern
    var $nr_tech_count {
      value = $no_repair_by_tech|count
    }
  
    conditional {
      if ($nr_tech_count >= 1) {
        array.push $findings {
          value = {
            kind   : "high_no_repair_rate"
            summary: ($nr_tech_count|to_text) ~ " tech(s) had no-repair rate >= 25% in last 7 days"
            details: $no_repair_by_tech
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // For each finding, ask Claude for ONE revenue improvement proposal
    // ════════════════════════════════════════════════════════════════
    var $proposals_count {
      value = 0
    }
  
    foreach ($findings) {
      each as $f {
        var $details_json {
          value = ($f.details ?? [])|json_encode
        }
      
        var $prompt_text {
          value = "You are analyzing revenue performance for a field service business called TN Appliance Exchange. Here is a finding from the last 7 days: kind=" ~ $f.kind ~ ", summary=" ~ $f.summary ~ ", details=" ~ $details_json ~ ". Propose ONE specific revenue improvement (a process change, an automation, a workflow tweak, or a tool). Respond in JSON only with fields: description, trigger, condition_detected, proposed_action, time_saved_estimate."
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
      
        // Defensive Claude response parsing (pre-extract to vars).
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
                source_builder     : "revenue_optimizer"
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
          value = "[ant] revenue optimizer found " ~ ($proposals_count|to_text) ~ " revenue opportunities this week. review at tnapplianceexchange.net/agent-proposals"
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
        action  : "revenue_optimizer_ran"
        metadata: {
        total_pending    : $total_pending
        pending_row_count: $pending_earnings.items|count
        uninvoiced_count : $uninvoiced_count
        no_repair_techs  : $nr_tech_count
        findings_count   : $findings|count
        proposals_written: $proposals_count
      }
      }
    } as $audit_log
  }

  response = {
    success          : true
    total_pending    : $total_pending
    pending_row_count: $pending_earnings.items|count
    uninvoiced_count : $uninvoiced_count
    no_repair_techs  : $nr_tech_count
    findings_count   : $findings|count
    proposals_written: $proposals_count
  }

  guid = "xGrmMJIrCgw6goG4DWPxAjXlyEo"
}
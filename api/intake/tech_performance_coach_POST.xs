//  Tech Performance Coach - fifth autonomous agent builder. Watches
//  technician performance signals over rolling windows:
//    A) Acceptance rate < 70% (30-day rolling, from tech_performance_ledger)
//    B) Time-on-site outliers (last 7 days, tech_avg > 1.5x team_avg)
//    C) Zero-TDR active techs (last 7 days, no technician_decision_report
//       submissions for an active tech)
// 
//  For each signal, asks Claude to propose ONE coaching or process
//  improvement. Proposals land in agent_proposals with
//  source_builder="tech_performance_coach". Reviewed via
//  agent-proposals.html alongside output from other builders.
// 
//  Called by the orchestrator (agent_queue row required). Weekly cadence
//  is recommended - acceptance_rate moves slowly, time-on-site needs a
//  week of data for a meaningful average, and TDR-volume coaching is best
//  reviewed weekly.
// 
//  Findings bundle ALL flagged techs per finding (not one finding per tech)
//  so we make at most 3 Claude calls per run regardless of team size.
query tech_performance_coach verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    var $seven_days_ago {
      value = now|transform_timestamp:"-7 days"
    }
  
    var $thirty_days_ago {
      value = now|transform_timestamp:"-30 days"
    }
  
    // Tech roster - drives all three findings.
    db.query technicians {
      where = $db.technicians.active == true
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $techs_list
  
    // ════════════════════════════════════════════════════════════════
    // FINDING A: Low acceptance rate (< 0.70)
    //   Pull recent ledger rows (period_end in last 30 days, sorted
    //   newest first). For each active tech, pick the latest row and
    //   check acceptance_rate threshold.
    // ════════════════════════════════════════════════════════════════
    db.query tech_performance_ledger {
      where = $db.tech_performance_ledger.period_end >= $thirty_days_ago
      sort = {tech_performance_ledger.period_end: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $ledger_rows
  
    var $low_acceptance_techs {
      value = []
    }
  
    foreach ($techs_list.items) {
      each as $t {
        // Find this tech's most-recent ledger row (rows already sorted desc
        // by period_end, so the first match wins).
        var $latest_row {
          value = null
        }
      
        foreach ($ledger_rows.items) {
          each as $lr {
            conditional {
              if ($latest_row == null && $lr.tech_id == $t.id) {
                var.update $latest_row {
                  value = $lr
                }
              }
            }
          }
        }
      
        conditional {
          if ($latest_row != null) {
            var $rate {
              value = ($latest_row.acceptance_rate ?? 0)
            }
          
            conditional {
              if ($rate < 0.7) {
                array.push $low_acceptance_techs {
                  value = {
                    tech_id        : $t.id
                    tech_name      : ($t.first_name ~ " " ~ $t.last_name)
                    acceptance_rate: $rate
                    offered_count  : ($latest_row.offered_count ?? 0)
                    accepted_count : ($latest_row.accepted_count ?? 0)
                    called_off     : ($latest_row.called_off_count ?? 0)
                    team_avg       : ($latest_row.team_avg_acceptance_rate ?? 0)
                    period_end     : ($latest_row.period_end ?? "")
                  }
                }
              }
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING B: Time-on-site outlier (tech avg > 1.5x team avg)
    //   Pull all completed jobs in last 7 days with time_on_site_minutes
    //   populated. Compute per-tech avg and team-wide avg.
    // ════════════════════════════════════════════════════════════════
    db.query jobs {
      where = $db.jobs.job_completed_at >= $seven_days_ago && $db.jobs.time_on_site_minutes > 0
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $completed_jobs
  
    // Team avg first
    var $team_total_minutes {
      value = 0
    }
  
    var $team_total_jobs {
      value = 0
    }
  
    foreach ($completed_jobs.items) {
      each as $cj {
        var.update $team_total_minutes {
          value = $team_total_minutes + ($cj.time_on_site_minutes ?? 0)
        }
      
        var.update $team_total_jobs {
          value = $team_total_jobs + 1
        }
      }
    }
  
    var $team_avg_minutes {
      value = 0
    }
  
    conditional {
      if ($team_total_jobs > 0) {
        var.update $team_avg_minutes {
          value = $team_total_minutes / $team_total_jobs
        }
      }
    }
  
    // Per-tech avg + flag
    var $slow_techs {
      value = []
    }
  
    var $outlier_threshold {
      value = ($team_avg_minutes * 3) / 2
    }
  
    foreach ($techs_list.items) {
      each as $t2 {
        var $tech_minutes {
          value = 0
        }
      
        var $tech_jobs {
          value = 0
        }
      
        foreach ($completed_jobs.items) {
          each as $cj2 {
            conditional {
              if ($cj2.technician_id == $t2.id) {
                var.update $tech_minutes {
                  value = $tech_minutes + ($cj2.time_on_site_minutes ?? 0)
                }
              
                var.update $tech_jobs {
                  value = $tech_jobs + 1
                }
              }
            }
          }
        }
      
        var $tech_avg {
          value = 0
        }
      
        conditional {
          if ($tech_jobs > 0) {
            var.update $tech_avg {
              value = $tech_minutes / $tech_jobs
            }
          }
        }
      
        // Require at least 2 jobs to avoid one-bad-day outliers
        conditional {
          if ($tech_jobs >= 2 && $team_avg_minutes > 0 && $tech_avg > $outlier_threshold) {
            array.push $slow_techs {
              value = {
                tech_id     : $t2.id
                tech_name   : ($t2.first_name ~ " " ~ $t2.last_name)
                tech_avg_min: $tech_avg
                team_avg_min: $team_avg_minutes
                jobs_count  : $tech_jobs
                pct_above   : (($tech_avg * 100) / $team_avg_minutes) - 100
              }
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // FINDING C: Zero TDR submissions in last 7 days
    //   For each active tech, count technician_decision_report rows
    //   created in last 7 days. Flag any with count == 0.
    // ════════════════════════════════════════════════════════════════
    db.query technician_decision_report {
      where = $db.technician_decision_report.created_at >= $seven_days_ago
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $recent_tdrs
  
    var $zero_tdr_techs {
      value = []
    }
  
    foreach ($techs_list.items) {
      each as $t3 {
        var $tdr_count {
          value = 0
        }
      
        foreach ($recent_tdrs.items) {
          each as $tdr {
            conditional {
              if ($tdr.technician_id == $t3.id) {
                var.update $tdr_count {
                  value = $tdr_count + 1
                }
              }
            }
          }
        }
      
        conditional {
          if ($tdr_count == 0) {
            array.push $zero_tdr_techs {
              value = {
                tech_id  : $t3.id
                tech_name: ($t3.first_name ~ " " ~ $t3.last_name)
              }
            }
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // BUILD FINDINGS LIST
    // ════════════════════════════════════════════════════════════════
    var $findings {
      value = []
    }
  
    var $low_accept_count {
      value = $low_acceptance_techs|count
    }
  
    conditional {
      if ($low_accept_count >= 1) {
        array.push $findings {
          value = {
            kind   : "low_acceptance_rate"
            summary: ($low_accept_count|to_text) ~ " tech(s) have 30-day acceptance rate < 70%"
            details: $low_acceptance_techs
          }
        }
      }
    }
  
    var $slow_count {
      value = $slow_techs|count
    }
  
    conditional {
      if ($slow_count >= 1) {
        array.push $findings {
          value = {
            kind   : "slow_time_on_site"
            summary: ($slow_count|to_text) ~ " tech(s) have time-on-site > 50% above team average (team_avg=" ~ ($team_avg_minutes|to_text) ~ " min)"
            details: $slow_techs
          }
        }
      }
    }
  
    var $zero_tdr_count {
      value = $zero_tdr_techs|count
    }
  
    conditional {
      if ($zero_tdr_count >= 1) {
        array.push $findings {
          value = {
            kind   : "zero_tdr_submissions"
            summary: ($zero_tdr_count|to_text) ~ " active tech(s) submitted 0 TDRs in last 7 days"
            details: $zero_tdr_techs
          }
        }
      }
    }
  
    // ════════════════════════════════════════════════════════════════
    // For each finding, ask Claude for ONE coaching proposal
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
          value = "You are analyzing technician performance for a field service business called TN Appliance Exchange. Here is a performance signal from a rolling window: kind=" ~ $f.kind ~ ", summary=" ~ $f.summary ~ ", details=" ~ $details_json ~ ". Propose ONE specific coaching action or process improvement (a 1-on-1 talking point, a workflow change, an incentive tweak, or a training topic). Respond in JSON only with fields: description, trigger, condition_detected, proposed_action, time_saved_estimate."
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
                source_builder     : "tech_performance_coach"
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
          value = "[ant] tech performance coach found " ~ ($proposals_count|to_text) ~ " coaching opportunities this week. review at tnapplianceexchange.net/agent-proposals"
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
        action  : "tech_performance_coach_ran"
        metadata: {
        active_techs     : $techs_list.items|count
        low_acceptance   : $low_accept_count
        slow_techs       : $slow_count
        zero_tdr_techs   : $zero_tdr_count
        team_avg_minutes : $team_avg_minutes
        findings_count   : $findings|count
        proposals_written: $proposals_count
      }
      }
    } as $audit_log
  }

  response = {
    success          : true
    active_techs     : $techs_list.items|count
    low_acceptance   : $low_accept_count
    slow_techs       : $slow_count
    zero_tdr_techs   : $zero_tdr_count
    team_avg_minutes : $team_avg_minutes
    findings_count   : $findings|count
    proposals_written: $proposals_count
  }

  guid = "wCvm4AntoGA9bOL5pg9rDwWPzfY"
}
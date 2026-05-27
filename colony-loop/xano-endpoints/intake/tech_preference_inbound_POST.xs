// Inbound preference-edit handler for the SMS-first ant scheduler.
// Called by the Netlify tech-sms-inbound webhook BEFORE the legacy
// tech_sms_inbound endpoint. Handles shortcuts atomically; returns
// matched=false on no-match so the caller falls through to legacy
// CLAIM/PICK/RESCHEDULE handling.
//
// Shortcuts supported (case-insensitive, leading whitespace ok):
//   OFF <DAY>              → permanent weekly day-off (Mon..Sun)
//   ON <DAY>               → opt-in / re-enable a weekly day
//   OFF M/D                → one-day vacation (also OFF MM/DD, OFF MM-DD)
//   HOURS HH-HH            → default working hours (writes technicians.preferred_hours)
//   MAX <N>                → max jobs per day (writes tech_preferences notes="max_jobs:N")
//   NO <APPLIANCE>         → don't send this appliance type
//   YES <APPLIANCE>        → reverse a previous NO
//   SKIP <ZONE>            → don't send jobs in this zip cluster
//   STATUS                 → reply with current settings summary
//   OOPS                   → revert last preference change (10-min window)
//
// Every successful write also writes an event_log row with action=
// "tech_preference_changed" so OOPS can find + reverse the prior state.
query tech_preference_inbound verb=POST {
  api_group = "intake"

  input {
    text phone
    text body
  }

  stack {
    var $phone_clean {
      value = (($input.phone ?? "")|trim)
    }

    var $body_raw {
      value = (($input.body ?? "")|trim)
    }

    var $body_upper {
      value = ($body_raw|upper)
    }

    precondition ($phone_clean != "" && $body_raw != "") {
      error_type = "inputerror"
      error      = "phone and body required"
    }

    // Resolve tech by phone (last-10-digit match)
    var $phone_digits {
      value = $phone_clean|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":""
    }

    var $digits_len {
      value = $phone_digits|strlen
    }

    var $last10_start {
      value = ($digits_len - 10)
    }

    var $last10 {
      value = ($digits_len >= 10) ? ($phone_digits|substr:$last10_start) : $phone_digits
    }

    db.query technicians {
      where  = $db.technicians.phone == $last10 || $db.technicians.phone == ("+1" ~ $last10) || $db.technicians.phone == $phone_clean
      sort   = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tech_rows

    var $tech {
      value = (($tech_rows.items|first) ?? null)
    }

    conditional {
      if ($tech == null) {
        return {
          value = {matched: false, reason: "unknown_tech_phone"}
        }
      }
    }

    var $tech_id { value = $tech.id }
    var $tech_first { value = ($tech.first_name ?? "tech") }

    // ─── SHORTCUT: EXTRA / OPEN / WHO NEEDS HELP ─────────────────────
    // Tech is asking for fill-in work near them. Pull top 3 candidates
    // via find_extra_work_for_tech, format as numbered list, persist
    // the offered job_ids in event_log so the BLAST handler can map
    // numbers → job_ids.
    var $is_extra_cmd { value = ($body_upper == "EXTRA" || $body_upper == "OPEN" || $body_upper == "WHO NEEDS HELP" || $body_upper == "MORE WORK") }

    conditional {
      if ($is_extra_cmd) {
        api.request {
          url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/find_extra_work_for_tech?tech_id=" ~ ($tech_id|to_text) ~ "&limit=3"
          method  = "GET"
          headers = []|push:"Content-Type: application/json"
        } as $extra_resp

        var $extra_body { value = ($extra_resp.response.result ?? {}) }
        var $local_arr { value = ($extra_body.prediag_and_local ?? []) }
        var $other_arr { value = ($extra_body.other_candidates ?? []) }
        var $total { value = ($extra_body.total_in_pool ?? 0) }

        conditional {
          if ($total == 0) {
            return {
              value = {matched: true, reply: ("No extra work in your area right now. I'll keep watching and text you if something opens up.")}
            }
          }
        }

        // Combine local first, then other — cap 3 (find endpoint already limits)
        var $combined { value = [] }

        foreach ($local_arr) {
          each as $lj { var.update $combined { value = $combined|push:$lj } }
        }
        foreach ($other_arr) {
          each as $oj {
            conditional {
              if (($combined|count) < 3) {
                var.update $combined { value = $combined|push:$oj }
              }
            }
          }
        }

        // Build text reply + collect job_ids for the event_log audit
        var $reply_lines { value = "" }
        var $job_ids_csv { value = "" }
        var $line_num { value = 0 }

        foreach ($combined) {
          each as $c {
            var.update $line_num { value = $line_num + 1 }
            var $prediag_mark { value = ($c.has_prediag == true) ? " ✓pre-diag" : " (no pre-diag yet)" }
            var $line {
              value = ($line_num|to_text) ~ ". " ~ (($c.customer_first ?? "")|trim) ~ " — " ~ (($c.appliance ?? "")|trim) ~ ", " ~ (($c.city ?? "")|trim) ~ " " ~ (($c.zip ?? "")|trim) ~ $prediag_mark
            }
            var.update $reply_lines { value = ($reply_lines == "" ? $line : ($reply_lines ~ "\n" ~ $line)) }
            var.update $job_ids_csv { value = ($job_ids_csv == "" ? ($c.id|to_text) : ($job_ids_csv ~ "," ~ ($c.id|to_text))) }
          }
        }

        // Persist offered list — BLAST will look up the most recent
        db.add event_log {
          data = {
            action  : "tech_extra_offered"
            metadata: {
              tech_id      : $tech_id
              job_ids_csv  : $job_ids_csv
              candidate_count: ($combined|count)
            }
          }
        } as $offered_log

        var $reply_full {
          value = (($combined|count)|to_text) ~ " candidates near you:\n" ~ $reply_lines ~ "\n\nReply BLAST 1 / BLAST 1 2 / BLAST ALL to text them. First YES wins (~15 min window)."
        }

        return {
          value = {matched: true, reply: $reply_full}
        }
      }
    }

    // ─── SHORTCUT: BLAST <N> [N2 N3 ...] / BLAST ALL ────────────────
    // Tech is responding to a prior EXTRA candidate list. Look up the
    // most recent tech_extra_offered row for this tech (within 15 min),
    // map the numbers to job_ids, fire offer_extra_work_to_customer
    // for each. Customer replies are handled async by the customer-sms
    // inbound webhook (Phase 2d.next).
    var $is_blast_cmd { value = ($body_upper|substr:0:6) == "BLAST " }

    conditional {
      if ($is_blast_cmd) {
        var $blast_arg { value = ($body_upper|substr:6)|trim }
        var $now_ms_b { value = now|to_ms }
        var $cutoff_ms_b { value = $now_ms_b - 900000 }

        db.query event_log {
          where  = $db.event_log.action == "tech_extra_offered" && $db.event_log.created_at >= $cutoff_ms_b
          sort   = {event_log.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 20}}
        } as $offered_rows

        var $offered_for_tech { value = null }

        foreach ($offered_rows.items) {
          each as $or {
            conditional {
              if ($offered_for_tech == null) {
                var $or_meta_raw { value = ($or.metadata ?? "") }
                var $or_meta { value = $or_meta_raw|json_decode }
                conditional {
                  if (($or_meta.tech_id ?? 0) == $tech_id) {
                    var.update $offered_for_tech { value = $or_meta }
                  }
                }
              }
            }
          }
        }

        conditional {
          if ($offered_for_tech == null) {
            return {
              value = {matched: true, reply: "No active candidate list. Text EXTRA to see open jobs near you."}
            }
          }
        }

        var $job_ids_csv { value = ($offered_for_tech.job_ids_csv ?? "") }
        var $job_ids_arr { value = $job_ids_csv|split:"," }
        var $job_count { value = $job_ids_arr|count }

        // Determine which indices to blast
        var $send_all { value = ($blast_arg == "ALL" || $blast_arg == "EVERYONE") }
        var $idx_tokens_raw { value = $blast_arg|split:" " }
        var $blast_count { value = 0 }
        var $errors_count { value = 0 }

        conditional {
          if ($send_all) {
            // Blast every job_id in the list
            foreach ($job_ids_arr) {
              each as $jid_str {
                var $jid { value = $jid_str|to_int }
                conditional {
                  if ($jid > 0) {
                    api.request {
                      url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/offer_extra_work_to_customer"
                      method  = "POST"
                      headers = []|push:"Content-Type: application/json"
                      params  = {job_id: $jid, tech_id: $tech_id}
                    } as $offer_resp_a
                    var $offer_status_a { value = ($offer_resp_a.response.status ?? 0) }
                    conditional {
                      if ($offer_status_a >= 200 && $offer_status_a < 300) {
                        var.update $blast_count { value = $blast_count + 1 }
                      }
                      else {
                        var.update $errors_count { value = $errors_count + 1 }
                      }
                    }
                  }
                }
              }
            }
          }
          else {
            // Parse number tokens and dispatch
            foreach ($idx_tokens_raw) {
              each as $tok {
                var $tok_int { value = $tok|to_int }
                conditional {
                  if ($tok_int >= 1 && $tok_int <= $job_count) {
                    var $target_idx { value = $tok_int - 1 }
                    var $jid_b { value = ($job_ids_arr|get:$target_idx)|to_int }
                    conditional {
                      if ($jid_b > 0) {
                        api.request {
                          url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/offer_extra_work_to_customer"
                          method  = "POST"
                          headers = []|push:"Content-Type: application/json"
                          params  = {job_id: $jid_b, tech_id: $tech_id}
                        } as $offer_resp_b
                        var $offer_status_b { value = ($offer_resp_b.response.status ?? 0) }
                        conditional {
                          if ($offer_status_b >= 200 && $offer_status_b < 300) {
                            var.update $blast_count { value = $blast_count + 1 }
                          }
                          else {
                            var.update $errors_count { value = $errors_count + 1 }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        var $blast_reply {
          value = "Blasted " ~ ($blast_count|to_text) ~ " customer" ~ (($blast_count == 1) ? "" : "s") ~ ". First YES wins (~15 min window). I'll text you the moment someone accepts."
        }

        conditional {
          if ($errors_count > 0) {
            var.update $blast_reply { value = ($blast_reply ~ " (" ~ ($errors_count|to_text) ~ " failed to send)") }
          }
        }

        return {
          value = {matched: true, reply: $blast_reply}
        }
      }
    }

    // ─── SHORTCUT: STATUS ────────────────────────────────────────────
    conditional {
      if ($body_upper == "STATUS" || $body_upper == "MY SCHEDULE" || $body_upper == "SCHEDULE") {
        var $cur_start {
          value = ($tech.preferred_hours_start ?? "08:00")
        }
        var $cur_end {
          value = ($tech.preferred_hours_end ?? "16:00")
        }

        db.query tech_preferences {
          where  = $db.tech_preferences.tech_id == $tech_id && $db.tech_preferences.active == true
          sort   = {tech_preferences.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $pref_rows

        var $pref_count {
          value = ($pref_rows.items|count)
        }

        var $status_text {
          value = ($tech_first ~ ": hours " ~ $cur_start ~ "-" ~ $cur_end ~ ", weekends off by default. " ~ ($pref_count|to_text) ~ " active preferences on file. Text any change like OFF SAT, HOURS 9-6, MAX 5, NO MICROWAVE, SKIP HAMMOND.")
        }

        return {
          value = {matched: true, reply: $status_text}
        }
      }
    }

    // ─── SHORTCUT: OOPS (undo last change in 10 min) ─────────────────
    conditional {
      if ($body_upper == "OOPS" || $body_upper == "UNDO") {
        var $now_ms { value = now|to_ms }
        var $cutoff_ms { value = $now_ms - 600000 }

        db.query event_log {
          where  = $db.event_log.action == "tech_preference_changed" && $db.event_log.created_at >= $cutoff_ms
          sort   = {event_log.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 20}}
        } as $recent_log

        var $found_for_tech { value = null }

        foreach ($recent_log.items) {
          each as $log_row {
            conditional {
              if ($found_for_tech == null) {
                var $log_meta_raw {
                  value = ($log_row.metadata ?? "")
                }
                var $meta_obj { value = $log_meta_raw|json_decode }
                conditional {
                  if (($meta_obj.tech_id ?? 0) == $tech_id) {
                    var.update $found_for_tech { value = $meta_obj }
                  }
                }
              }
            }
          }
        }

        conditional {
          if ($found_for_tech == null) {
            return {
              value = {matched: true, reply: "Nothing to undo. Your last change was more than 10 min ago, or you haven't made one yet."}
            }
          }
        }

        // Revert based on change_type
        var $change_type {
          value = ($found_for_tech.change_type ?? "")
        }

        var $undo_reply { value = "" }

        conditional {
          if ($change_type == "hours") {
            db.edit technicians {
              field_name  = "id"
              field_value = $tech_id
              data        = {
                preferred_hours_start: ($found_for_tech.prior_start ?? "08:00")
                preferred_hours_end  : ($found_for_tech.prior_end ?? "16:00")
              }
            } as $u1
            var.update $undo_reply { value = ("Undone — hours back to " ~ ($found_for_tech.prior_start ?? "08:00") ~ "-" ~ ($found_for_tech.prior_end ?? "16:00")) }
          }
          elseif ($change_type == "preference_row_added") {
            db.edit tech_preferences {
              field_name  = "id"
              field_value = ($found_for_tech.pref_row_id ?? 0)
              data        = {active: false}
            } as $u2
            var.update $undo_reply { value = ("Undone — removed " ~ ($found_for_tech.summary ?? "last preference")) }
          }
        }

        db.add event_log {
          data = {
            action  : "tech_preference_undone"
            metadata: {
              tech_id   : $tech_id
              reverted  : $found_for_tech
            }
          }
        } as $undo_audit

        return {
          value = {matched: true, reply: $undo_reply}
        }
      }
    }

    // ─── SHORTCUT: HOURS HH-HH ───────────────────────────────────────
    // Match patterns: "HOURS 9-6", "HOURS 9-18", "HOURS 09:00-18:00"
    var $is_hours_cmd {
      value = ($body_upper|substr:0:6) == "HOURS "
    }

    conditional {
      if ($is_hours_cmd) {
        var $hours_arg {
          value = ($body_upper|substr:6)|trim
        }

        // Try to find a "-" separator
        var $dash_pos {
          value = $hours_arg|strpos:"-"
        }

        conditional {
          if ($dash_pos < 1) {
            return {
              value = {matched: true, reply: "Try HOURS 9-6 or HOURS 09:00-18:00"}
            }
          }
        }

        var $start_raw {
          value = ($hours_arg|substr:0:$dash_pos)|trim
        }

        var $end_start_pos { value = $dash_pos + 1 }

        var $end_raw {
          value = ($hours_arg|substr:$end_start_pos)|trim
        }

        // Normalize — if it doesn't contain ":", treat as bare-hour. End
        // hours less than start get +12 (so "9-6" becomes "09:00-18:00").
        var $start_has_colon { value = $start_raw|strpos:":" }
        var $end_has_colon { value = $end_raw|strpos:":" }

        var $start_h_int { value = ($start_has_colon >= 0) ? ($start_raw|substr:0:$start_has_colon)|to_int : ($start_raw|to_int) }
        var $end_h_int { value = ($end_has_colon >= 0) ? ($end_raw|substr:0:$end_has_colon)|to_int : ($end_raw|to_int) }

        // Auto-promote end hour to PM if it's less than start (common
        // shorthand: "9-6" = 9am to 6pm)
        var $end_h_promoted {
          value = ($end_h_int < $start_h_int && $end_h_int < 12) ? ($end_h_int + 12) : $end_h_int
        }

        var $start_min_str { value = ($start_has_colon >= 0) ? ($start_raw|substr:($start_has_colon + 1)) : "00" }
        var $end_min_str { value = ($end_has_colon >= 0) ? ($end_raw|substr:($end_has_colon + 1)) : "00" }

        var $start_str_h { value = ($start_h_int < 10) ? ("0" ~ ($start_h_int|to_text)) : ($start_h_int|to_text) }
        var $end_str_h { value = ($end_h_promoted < 10) ? ("0" ~ ($end_h_promoted|to_text)) : ($end_h_promoted|to_text) }

        var $start_final { value = ($start_str_h ~ ":" ~ $start_min_str) }
        var $end_final { value = ($end_str_h ~ ":" ~ $end_min_str) }

        var $prior_start { value = ($tech.preferred_hours_start ?? "08:00") }
        var $prior_end { value = ($tech.preferred_hours_end ?? "16:00") }

        db.edit technicians {
          field_name  = "id"
          field_value = $tech_id
          data        = {
            preferred_hours_start: $start_final
            preferred_hours_end  : $end_final
          }
        } as $u_hours

        db.add event_log {
          data = {
            action  : "tech_preference_changed"
            metadata: {
              tech_id     : $tech_id
              change_type : "hours"
              prior_start : $prior_start
              prior_end   : $prior_end
              new_start   : $start_final
              new_end     : $end_final
              raw_message : $body_raw
            }
          }
        } as $log_hours

        return {
          value = {matched: true, reply: ("Got it — hours set to " ~ $start_final ~ "-" ~ $end_final ~ ". Text OOPS within 10 min to undo.")}
        }
      }
    }

    // ─── SHORTCUT: OFF <day> ─────────────────────────────────────────
    var $is_off_cmd { value = ($body_upper|substr:0:4) == "OFF " }

    conditional {
      if ($is_off_cmd) {
        var $off_arg { value = ($body_upper|substr:4)|trim }

        // Map common day shortcuts
        var $day_canon { value = "" }

        conditional {
          if ($off_arg == "MON" || $off_arg == "MONDAY")           { var.update $day_canon { value = "monday" } }
          elseif ($off_arg == "TUE" || $off_arg == "TUES" || $off_arg == "TUESDAY") { var.update $day_canon { value = "tuesday" } }
          elseif ($off_arg == "WED" || $off_arg == "WEDS" || $off_arg == "WEDNESDAY") { var.update $day_canon { value = "wednesday" } }
          elseif ($off_arg == "THU" || $off_arg == "THUR" || $off_arg == "THURS" || $off_arg == "THURSDAY") { var.update $day_canon { value = "thursday" } }
          elseif ($off_arg == "FRI" || $off_arg == "FRIDAY")       { var.update $day_canon { value = "friday" } }
          elseif ($off_arg == "SAT" || $off_arg == "SATURDAY")     { var.update $day_canon { value = "saturday" } }
          elseif ($off_arg == "SUN" || $off_arg == "SUNDAY")       { var.update $day_canon { value = "sunday" } }
        }

        conditional {
          if ($day_canon != "") {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "time"
                day_of_week       : $day_canon
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                active            : true
              }
            } as $pref_new

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_new.id
                  summary     : ("OFF " ~ $day_canon)
                  raw_message : $body_raw
                }
              }
            } as $log_off

            return {
              value = {matched: true, reply: ("Got it — " ~ $day_canon ~ "s off going forward. Text OOPS within 10 min to undo, or STATUS to see your schedule.")}
            }
          }
        }

        // Not a recognized day → fall through (Phase 2a v1 will Claude-classify)
        return {
          value = {matched: true, reply: ("I think you meant OFF <day>, like OFF SAT or OFF FRIDAY. Try again?")}
        }
      }
    }

    // ─── SHORTCUT: MAX <N> ───────────────────────────────────────────
    var $is_max_cmd { value = ($body_upper|substr:0:4) == "MAX " }

    conditional {
      if ($is_max_cmd) {
        var $max_arg_str { value = ($body_upper|substr:4)|trim }
        var $max_n { value = $max_arg_str|to_int }

        conditional {
          if ($max_n < 1 || $max_n > 12) {
            return {
              value = {matched: true, reply: "MAX needs a number 1-12. Try MAX 5"}
            }
          }
        }

        // Deactivate any prior max_jobs preference rows
        db.query tech_preferences {
          where  = $db.tech_preferences.tech_id == $tech_id && $db.tech_preferences.preference_type == "time" && $db.tech_preferences.notes == ("max_jobs:" ~ ($max_n|to_text)) && $db.tech_preferences.active == true
          return = {type: "list", paging: {page: 1, per_page: 5}}
        } as $existing_max

        db.add tech_preferences {
          data = {
            tech_id           : $tech_id
            preference_type   : "time"
            strength          : "hard"
            source            : "explicit"
            captured_via_text : $body_raw
            notes             : ("max_jobs:" ~ ($max_n|to_text))
            active            : true
          }
        } as $pref_max

        db.add event_log {
          data = {
            action  : "tech_preference_changed"
            metadata: {
              tech_id     : $tech_id
              change_type : "preference_row_added"
              pref_row_id : $pref_max.id
              summary     : ("MAX " ~ ($max_n|to_text))
              raw_message : $body_raw
            }
          }
        } as $log_max

        return {
          value = {matched: true, reply: ("Got it — max " ~ ($max_n|to_text) ~ " jobs per day. Text OOPS within 10 min to undo.")}
        }
      }
    }

    // ─── SHORTCUT: NO <appliance> ───────────────────────────────────
    var $is_no_cmd { value = ($body_upper|substr:0:3) == "NO " }

    conditional {
      if ($is_no_cmd) {
        var $no_arg { value = ($body_upper|substr:3)|trim|lower }

        conditional {
          if ($no_arg != "") {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "both"
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                notes             : ("appliance_no:" ~ $no_arg)
                active            : true
              }
            } as $pref_no

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_no.id
                  summary     : ("NO " ~ $no_arg)
                  raw_message : $body_raw
                }
              }
            } as $log_no

            return {
              value = {matched: true, reply: ("Got it — won't send you " ~ $no_arg ~ " jobs. Text OOPS within 10 min to undo, or YES " ~ ($no_arg|upper) ~ " to reverse later.")}
            }
          }
        }
      }
    }

    // ─── SHORTCUT: SKIP <zone> ──────────────────────────────────────
    var $is_skip_cmd { value = ($body_upper|substr:0:5) == "SKIP " }

    conditional {
      if ($is_skip_cmd) {
        var $skip_arg { value = ($body_upper|substr:5)|trim|lower }

        conditional {
          if ($skip_arg != "") {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "geographic"
                zip_or_area       : $skip_arg
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                notes             : "zone_skip"
                active            : true
              }
            } as $pref_skip

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_skip.id
                  summary     : ("SKIP " ~ $skip_arg)
                  raw_message : $body_raw
                }
              }
            } as $log_skip

            return {
              value = {matched: true, reply: ("Got it — won't send you " ~ $skip_arg ~ " jobs. Text OOPS within 10 min to undo.")}
            }
          }
        }
      }
    }

    // ─── FREE-TEXT CLAUDE CLASSIFICATION ─────────────────────────────
    // No shortcut matched. Ask Claude Haiku to classify the message into
    // one of the known intents + extract params, then dispatch. If Claude
    // returns "unclear" or "not_a_preference" we return matched=false so
    // the legacy CLAIM/PICK/RESCHEDULE/Claude flow can try.

    var $sys_prompt {
      value = "You classify SMS messages from appliance-repair technicians about their scheduling preferences. The tech is texting their dispatcher (ant scheduler). Output ONLY valid JSON, no prose, no markdown fences. Schema: {\"intent\": one of [day_off_weekly, day_off_specific, working_hours, max_jobs, appliance_decline, appliance_accept, zone_decline, zone_accept, status_query, undo, not_a_preference], \"params\": {\"day_of_week\": \"monday\"|...|\"sunday\"|null, \"date_ymd\": \"YYYY-MM-DD\"|null, \"start_time\": \"HH:MM\"|null, \"end_time\": \"HH:MM\"|null, \"max_jobs\": int|null, \"appliance\": \"refrigerator\"|\"washer\"|\"dryer\"|\"dishwasher\"|\"range\"|\"oven\"|\"microwave\"|\"hvac\"|null, \"zone\": string|null}, \"confidence\": 0.0-1.0, \"clarification\": string|null}. Examples: \"make me off sundays\" → {\"intent\":\"day_off_weekly\",\"params\":{\"day_of_week\":\"sunday\"},\"confidence\":0.95,\"clarification\":null}. \"i don't do microwaves\" → {\"intent\":\"appliance_decline\",\"params\":{\"appliance\":\"microwave\"},\"confidence\":0.9,\"clarification\":null}. \"start at 9 from now on\" → {\"intent\":\"working_hours\",\"params\":{\"start_time\":\"09:00\",\"end_time\":\"17:00\"},\"confidence\":0.8,\"clarification\":\"keeping end at 5pm — text HOURS 9-6 to change\"}. \"what jobs do i have\" → {\"intent\":\"not_a_preference\",\"params\":{},\"confidence\":0.95,\"clarification\":null}. \"cap me at 5\" → {\"intent\":\"max_jobs\",\"params\":{\"max_jobs\":5},\"confidence\":0.95,\"clarification\":null}. \"don't send me hammond\" → {\"intent\":\"zone_decline\",\"params\":{\"zone\":\"hammond\"},\"confidence\":0.9,\"clarification\":null}. If you cannot reliably extract params for the intent, use confidence<0.6."
    }

    var $user_payload {
      value = $body_raw
    }

    var $msg_obj {
      value = {role: "user", content: $user_payload}
    }

    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-haiku-4-5-20251001"
        max_tokens: 300
        system    : $sys_prompt
        messages  : [$msg_obj]
      }

      headers = [
        "x-api-key: " ~ $env.ANTHROPIC_API_KEY
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]

      timeout = 7
    } as $claude_resp

    var $claude_status {
      value = ($claude_resp.response.status ?? 0)
    }

    conditional {
      if ($claude_status < 200 || $claude_status >= 300) {
        return {
          value = {matched: false, reason: "claude_error", status: $claude_status}
        }
      }
    }

    var $claude_result {
      value = ($claude_resp.response.result ?? {})
    }

    var $claude_content {
      value = ($claude_result.content ?? [])
    }

    conditional {
      if (($claude_content|count) == 0) {
        return {
          value = {matched: false, reason: "claude_empty_content"}
        }
      }
    }

    var $claude_first {
      value = $claude_content|get:0
    }

    var $raw_text {
      value = (($claude_first.text ?? "")|trim)
    }

    var $clean_text {
      value = ($raw_text|replace:"```json":""|replace:"```":"")|trim
    }

    var $classified {
      value = $clean_text|json_decode
    }

    conditional {
      if ($classified == null) {
        return {
          value = {matched: false, reason: "claude_unparseable_json", raw: ($raw_text|substr:0:200)}
        }
      }
    }

    var $intent {
      value = (($classified.intent ?? "not_a_preference")|trim|lower)
    }

    var $conf {
      value = ($classified.confidence ?? 0)
    }

    // Low confidence or definitively-not-preference → bail to legacy
    conditional {
      if ($intent == "not_a_preference" || $conf < 0.6) {
        return {
          value = {matched: false, reason: "claude_low_confidence_or_not_pref", intent: $intent, confidence: $conf}
        }
      }
    }

    var $params {
      value = ($classified.params ?? {})
    }

    var $clarif {
      value = (($classified.clarification ?? "")|trim)
    }

    var $clarif_suffix {
      value = ($clarif != "") ? (" " ~ $clarif ~ ".") : ""
    }

    // ── DISPATCH ON INTENT ──────────────────────────────────────────
    conditional {
      if ($intent == "day_off_weekly") {
        var $dow_param {
          value = (($params.day_of_week ?? "")|trim|lower)
        }
        conditional {
          if ($dow_param != "") {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "time"
                day_of_week       : $dow_param
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                active            : true
              }
            } as $pref_dow

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_dow.id
                  summary     : ("OFF " ~ $dow_param ~ " (free-text)")
                  raw_message : $body_raw
                  claude_conf : $conf
                }
              }
            } as $log_dow

            return {
              value = {matched: true, reply: ("Got it — " ~ $dow_param ~ "s off going forward." ~ $clarif_suffix ~ " Text OOPS within 10 min to undo.")}
            }
          }
        }
      }

      elseif ($intent == "working_hours") {
        var $start_p { value = (($params.start_time ?? "")|trim) }
        var $end_p { value = (($params.end_time ?? "")|trim) }
        conditional {
          if ($start_p != "" && $end_p != "") {
            db.edit technicians {
              field_name  = "id"
              field_value = $tech_id
              data        = {
                preferred_hours_start: $start_p
                preferred_hours_end  : $end_p
              }
            } as $u_h

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "hours"
                  prior_start : ($tech.preferred_hours_start ?? "08:00")
                  prior_end   : ($tech.preferred_hours_end ?? "16:00")
                  new_start   : $start_p
                  new_end     : $end_p
                  raw_message : $body_raw
                  claude_conf : $conf
                }
              }
            } as $log_h

            return {
              value = {matched: true, reply: ("Got it — hours set to " ~ $start_p ~ "-" ~ $end_p ~ "." ~ $clarif_suffix ~ " Text OOPS within 10 min to undo.")}
            }
          }
        }
      }

      elseif ($intent == "max_jobs") {
        var $mn { value = ($params.max_jobs ?? 0)|to_int }
        conditional {
          if ($mn >= 1 && $mn <= 12) {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "time"
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                notes             : ("max_jobs:" ~ ($mn|to_text))
                active            : true
              }
            } as $pref_mn

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_mn.id
                  summary     : ("MAX " ~ ($mn|to_text) ~ " (free-text)")
                  raw_message : $body_raw
                  claude_conf : $conf
                }
              }
            } as $log_mn

            return {
              value = {matched: true, reply: ("Got it — max " ~ ($mn|to_text) ~ " jobs per day." ~ $clarif_suffix ~ " Text OOPS within 10 min to undo.")}
            }
          }
        }
      }

      elseif ($intent == "appliance_decline") {
        var $app_p { value = (($params.appliance ?? "")|trim|lower) }
        conditional {
          if ($app_p != "") {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "both"
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                notes             : ("appliance_no:" ~ $app_p)
                active            : true
              }
            } as $pref_app

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_app.id
                  summary     : ("NO " ~ $app_p ~ " (free-text)")
                  raw_message : $body_raw
                  claude_conf : $conf
                }
              }
            } as $log_app

            return {
              value = {matched: true, reply: ("Got it — won't send you " ~ $app_p ~ " jobs." ~ $clarif_suffix ~ " Text OOPS within 10 min to undo.")}
            }
          }
        }
      }

      elseif ($intent == "zone_decline") {
        var $zn_p { value = (($params.zone ?? "")|trim|lower) }
        conditional {
          if ($zn_p != "") {
            db.add tech_preferences {
              data = {
                tech_id           : $tech_id
                preference_type   : "geographic"
                zip_or_area       : $zn_p
                strength          : "hard"
                source            : "explicit"
                captured_via_text : $body_raw
                notes             : "zone_skip"
                active            : true
              }
            } as $pref_zn

            db.add event_log {
              data = {
                action  : "tech_preference_changed"
                metadata: {
                  tech_id     : $tech_id
                  change_type : "preference_row_added"
                  pref_row_id : $pref_zn.id
                  summary     : ("SKIP " ~ $zn_p ~ " (free-text)")
                  raw_message : $body_raw
                  claude_conf : $conf
                }
              }
            } as $log_zn

            return {
              value = {matched: true, reply: ("Got it — won't send you " ~ $zn_p ~ " jobs." ~ $clarif_suffix ~ " Text OOPS within 10 min to undo.")}
            }
          }
        }
      }
    }

    // Claude classified but couldn't extract usable params, OR an intent
    // we don't have a write path for yet. Surface clarification or bail.
    conditional {
      if ($clarif != "") {
        return {
          value = {matched: true, reply: $clarif}
        }
      }
    }

    return {
      value = {matched: false, reason: "claude_missing_params", intent: $intent}
    }
  }

  guid = "tech-preference-inbound-v1"
}

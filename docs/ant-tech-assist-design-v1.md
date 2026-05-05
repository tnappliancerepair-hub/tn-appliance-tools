# Ant Tech Assist — Design v1

**Status:** Scoping complete. Ready for build the moment TCR clears.
**Last updated:** Monday May 4, 2026
**Owner:** Teddy / James Pivacek
**Estimated build:** 2-3 marathon sessions

---

## 1. What Ant Tech Assist Is

The on-site field copilot that closes the diagnostic submission loop. Triggers when a tech marks a job in_progress (HCP webhook), captures findings during the visit (web-primary with SMS fallback), and ensures all warranty-company-required TDR fields are complete before the tech leaves the data orphaned.

Not a diagnostic AI. Not a part-lookup tool. Not a tech training tool. The v1 product is a completion-enforcing scribe.

---

## 2. Why This Project (the hottest pain)

Techs are comfortable leaving and then doing reports at the end of the day and then just not getting to them. Techs leave the home with TDRs incomplete. Intend to finish later. Often don't. By the time Danielle gets the report, the tech has done multiple subsequent jobs and can't remember details. Warranty submission is delayed or rejected for missing fields. Danielle ends up chasing techs by phone/text for info that should have been captured at the appliance.

Secondary pains acknowledged but not v1 priorities: rare part-number lookup (handled inline as a tool call), diagnostic thinking partner (out of scope for v1), poor signal in field areas (drives SMS-fallback architecture).

---

## 3. Locked Architecture Decisions

### Channel: web-primary, SMS fallback
- Web app reuses CaptureOverlay IIFE from index.html (lines 2046-2480, ~430 lines, lifted verbatim)
- SMS works as fallback for poor signal areas (North Shore, Clarksville outskirts) and quick-text moments
- Voice deferred indefinitely

### Trigger: existing HCP webhook
- hcp_job_webhook already handles work_status=in_progress event
- Already sends SMS to techs with tech-ant.html?job_id=X&tech_id=Y link
- v1 change: swap SMS URL to tech-ant-live.html?job_id=X&tech_id=Y - that's the only webhook change required
- Existing tech-ant.html stays in place for post-job retrospective TDR (work_status=completed)
- Two-stage TDR flow: live capture during job (in_progress -> tech-ant-live), retrospective after (completed -> tech-ant)

### Twilio number: shared with Scheduler (+17273508487)
- State-routed at webhook entry: if tech has active assist session for a job -> assist handler, else -> scheduler handler
- Reason: zero new infra, zero new TCR submission, single number for techs
- Risk: intent ambiguity solved by Claude classifying intent in router prompt

### Auth: PIN fallback (reuse existing verify_tech_pin)
- Tech taps SMS link -> Tech Ant Live page -> enters 4-digit PIN -> session starts
- Reuses technicians.pin field, verify_tech_pin Xano endpoint, verify-pin-proxy.js netlify function
- All three already production
- v1.1 upgrade: signed magic-link from SMS for one-tap auth

### Activation: always-on, session-anchored
- Default: HCP in_progress webhook -> starts assist session, Ant texts opening message
- Manual: tech texts "starting job 1234" if HCP webhook delayed
- Session ends on job.completed HCP event AFTER completion gate validation

### Two-mode operation
- Slam-dunk mode (default): Ant offers help on session start, then stays out of the way. Captures whatever tech reports, asks only for missing required fields at completion. ~3-5 messages per visit.
- Assist mode (tech opts in): Tech says "yeah help me" / "give me the checklist" / "what does squaretrade need" -> Ant runs through diagnostic flow. ~15-25 messages per visit.
- Trigger detection: Claude classifies natural-language intent

### Push back on data contradictions (always, regardless of mode)
- If captured data contradicts tech's stated conclusion, Ant speaks up
- Pattern: name the data, name the implication, ask. Peer-to-peer tone. NOT "you're wrong."
- Tech can override; override captured to TDR with tech_override_flag and reasoning, audit trail preserved

### Completion gate: SOFT BLOCK + 2hr escalation
- Tech can mark HCP complete normally - Ant doesn't physically prevent it
- If captured data is missing required fields when job.completed fires:
  - Ant texts/messages tech, asking for missing fields one at a time (most important first)
  - Tech has 2 hours to backfill via continued conversation
  - If 2 hours pass with no resolution -> Ant texts Teddy with the gap details
- Override available: tech can text "override - leaving without [field], reason: [explanation]"
  - Captured to TDR with tech_override_flag = true and reason text
  - Logged for review

### Multi-job-per-day handling
- Auto-close behavior: when HCP in_progress fires for Job B while Job A's session is still open, Ant auto-closes Job A (with whatever data captured, marked as pending_followup if incomplete) and starts Job B fresh
- 2-hour escalation timer on Job A still applies (now starts at the moment of auto-close)
- Job B opening message acknowledges the auto-close
- Between-job questions (no active session): Ant queries jobs table for tech's recent 3-5 jobs, infers context, asks if uncertain
- Critical rule: Ant NEVER writes to a guessed job. Reading is fine; writing requires explicit job_id confirmation

### Acknowledgment & status
- Ant always confirms receipt on captures: "got it, freezer 28" - silence means something failed
- Tech can text "whats my status" anytime -> Ant fires __QUERY_STATUS__ token, returns captured_data summary + missing fields

### Cash/self-pay jobs activate with lighter fields
- Tech Assist runs for customer_type=self_pay jobs too
- Cash field requirements: appliance model, symptom, diagnosis, repair_completed, parts_used, labor_hours, technician_notes, customer_signature
- Completion gate still active but with lighter checklist

### "I don't know" pattern
- Default escalation: Danielle
- Pattern: Ant says "not sure - let me ping danielle, she'll get back to you" -> fires __ESCALATE_TO_OFFICE__ token -> SMS to Danielle with context
- Confidence handling: Ant always honest. "not 100% sure but my best guess is X, verify before ordering." Source URL always included
- v1.1 fallback: smart escalation routing (Teddy after-hours/weekends, Danielle business-hours)

---

## 4. Tech Ant Live UI/UX

### Build approach
- New file: tech-ant-live.html - sibling to existing tech-ant.html, NOT an evolution of it
- Reason: tech-ant.html serves a different lifecycle (post-job retrospective). Don't risk breaking production
- Starting skeleton: copy tech-ant.html (822 lines, single self-contained file)
- Port CaptureOverlay IIFE from index.html
- Swap prompt env var and Anthropic call endpoint

### Opening message (locked)
🐜 hey jimmy - on the whirlpool dishwasher at the jones house. customer reported model WDT730PAHZ0 + said it's not draining. teddy hasnt pre-diagnosed yet. confirm the model first then text findings or open: tnapplianceexchange.net/tech/job/abc123 - lmk if you want my help.

Conditional variants when no pre-diagnosis: "teddy hasnt pre-diagnosed yet."
With pre-diagnosis: "teddy's guess: bad pump motor."
🐜 emoji is for opening message ONLY, not every Ant response

### Tier 1 customer message templates (locked)

All use {preferred_name} (matches what customer used in intake; falls back to first_name if empty) and tech first name only.

1. Just arrived: hi {preferred_name} - tn appliance here, your tech jimmy just pulled up. coming to the door now.
2. Diagnosis complete: hi {preferred_name} - jimmy finished checking out your {appliance}. office will follow up shortly with what we found and next steps.
3. Starting repair: hi {preferred_name} - jimmy is starting the repair on your {appliance} now. should have it sorted shortly.
4. Wrapping up: hi {preferred_name} - jimmy is wrapping up and needs a quick signature before he heads out. come find him when you get a sec, thanks!
5. Repair complete: hi {preferred_name} - jimmy finished the repair on your {appliance}. it's back up and running. office will send a summary shortly.
6. Heading out: hi {preferred_name} - jimmy just headed out. thanks for choosing tn appliance today. youll get a feedback link from us shortly.

---

## 5. Schema additions / new entities

### New table: tech_assist_session
- id (pk)
- created_at, updated_at
- job_id (fk jobs)
- technician_id (fk technicians)
- warranty_company (text - mirrors jobs.warranty_company at session start, may be tech-corrected)
- customer_type (enum: warranty, self_pay, other)
- status (enum: active, awaiting_completion, complete, abandoned, escalated)
- captured_data (json - running structure of what's been captured. Shape: free-form keys mapping to captured values like {"freezer_temp": 28, "fresh_food_temp": 45, "compressor_running": false, "model_tag_photo_url": "..."})
- required_fields_remaining (json - array of field name strings derived from warranty_company on session start, like ["freezer_temp", "model_tag_photo", "failure_cause"])
- session_start_event (text: hcp_in_progress, manual)
- last_message_at (timestamp)
- escalated_at (nullable timestamp)
- escalated_to (nullable text - danielle, teddy)

### Schema additions to technician_decision_report
- tech_override_flag (bool, default false)
- tech_override_notes (text - reason for override)
- ant_data_flag (bool - set true if Ant pushed back on diagnosis)
- ant_flag_reason (text - Ant's pushback reasoning)
- Warranty-company-specific fields TBD from Danielle interview

### Schema additions to agent_conversation
- assist_session_id (nullable fk tech_assist_session)

### Schema additions to customer
- preferred_name (text - captured by Customer Ant during intake)

### Schema additions to agent_message
- source (text - values like tech_assist, customer_ant, tech_scheduler, manual)

---

## 6. New endpoints

- tech_assist_chat - main handler. Sister of chat/reply2, tech-oriented
- start_tech_assist_session - called from hcp_job_webhook on in_progress event
- validate_tdr_completeness - called on job.completed, checks required fields, fires escalation if needed

### Tools (token-based, parsed from Claude responses)
- __LOOKUP_PART__ - web search via brand-routed query
- __ORDER_PART__ - write to part_order, SMS Danielle
- __ESCALATE_TO_OFFICE__ - escalate question to Danielle
- __QUERY_STATUS__ - return captured_data summary + missing fields
- __SEND_CUSTOMER_MESSAGE__ - Tier 1 templated send (with template_id parameter)
- __OVERRIDE_FIELD__ - tech-explicit override of a required field, captures reason

---

## 7. Phase 1a tasks (THIS BUILD)

Schema work + skeleton, no live behavior changes:
1. Create tech_assist_session table per spec above
2. Schema additions to technician_decision_report
3. Schema additions to agent_conversation
4. Schema additions to agent_message
5. Schema additions to customer
6. Copy tech-ant.html to tech-ant-live.html
7. Port CaptureOverlay IIFE from index.html (lines 2046-2480) into tech-ant-live.html
8. Stub tech_assist_chat endpoint returning {success: true, message: "phase 1a stub"}

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

---

## Danielle Interview Findings (2026-05-05)

> **Updated 2026-05-05 (later same day):** This section was originally written from a partial Q&A. The full 10-question transcript subsequently revealed that the "2-week gap" headline metric was a misread — actual job-completion-to-submission is ~2 days; the 2 weeks is parts-ordering wait DURING the repair. Sections below corrected. Full verbatim Q&A is preserved in memory at `~/.claude/.../memory/danielle_interview_findings.md`.

Office manager interview that validates Tech Assist v1's design and unblocks Phase 1d. Danielle runs warranty portal submissions to AHS/SquareTrade and is the primary office-side user of any tooling that affects warranty turnaround.

### Key bottleneck identified

The biggest production friction is incomplete tech reports + lack of communication when reports are done.

> "When the tech report is not fully there. He may have report but no parts or other way around. Slows down the process cause they wont update it till later and not even tell me it's done."

This validates the Tech Assist v1 architecture (completion-enforcing scribe + escalation cron). Phase 1d is no longer interview-blocked — the interview confirms the design solves the right problem.

### Critical metrics — corrected 2026-05-05

| Metric | Today | Tech Assist v1 target |
|---|---|---|
| Job completion → warranty claim submission | ~2 days | Unchanged (already fast) |
| Daily tech-chasing for incomplete reports | ~every day ("almost every day i need to request something from someone") | Eliminated by completion-enforcing scribe |
| Job-scheduled → completion (parts-wait jobs) | ~2 weeks | Unchanged in v1 (parts-ordering automation is Phase 2 cash TDR §10/§11) |
| AHS submission → approval | up to 48 hours | Unchanged (warranty co's process) |
| Approval → payment | varies by company | Unchanged |

The previous draft of this section claimed the 2-week gap was the headline opportunity ("14x improvement"). That was wrong — Danielle's verbatim per Q4: *"No job completed to submission is 2 days. It's about a 2 week from when tech gose out when job is scheduled to completion generlly. An that is mainly for the jobs we have to request parts for."*

**The actual headline opportunity** is the daily tech-chasing friction (Q5: *"Almost every day i need to request something from someone"*). Tech Assist v1's completion-enforcing scribe directly closes it.

### Warranty company behavior — Q1, Q2, Q3 verbatim

**AHS phrasing rules (Q1).** *"They will reject if it says bad asking what is bad about it. The examples given are good wording to use. AHS needs to know how the failure effects the machine."* → Phase 1d feature: AHS phrasing coach detects rejected language ("bad", etc.) and suggests "how the failure affects the machine" framings inline.

**AHS field structure (Q2).** *"AHS has star astrics next to the reqired fields. Item, style, brand, model, age are all things I manully have to enter. I copy and past tech report and part numbers. Then manully enter part again and cost if we supply and labor."* → Phase 1d captures structured TDR data; Phase 2 opportunity is AHS portal auto-population eliminating Danielle's re-entry entirely.

**SquareTrade is fundamentally different (Q3).** *"SquareTrade just wants to know if machine got fixed first time with parts they sent, if not what parts are needed to fix it and if what they sent was used, not used, or needed for second possible repair. SqareTrade is more or less wanting to determine if its a good repair for them or easier to replace."* → **Phase 1d implication: warranty-company-aware question sets** branched on `jobs.warranty_company`. AHS = narrative form; SquareTrade = binary decision-tree (first-fix? parts-needed? part-used/not-used/needed-for-second-visit?). NOT one universal TDR form.

- No partial payments — binary state (full pay or unpaid). Simplifies AR tracker design — no gap-tracking needed.
- Question for v2: should schema-driven warranty handling support warranty companies beyond AHS+SquareTrade? Danielle unsure of plans.

### Repetitive/automation candidates

- "Everything is repetitive. It the job" — she's normalized friction, not specific tasks. Automation needs come from observation, not feature requests.
- Parts location lookups: techs constantly call her to ask if parts are local. Self-serve tech tool would eliminate this friction.
- Strategic work crowded out by tactical:
  - Customer follow-up
  - Parts arrival tracking → faster scheduling

  Both are automation candidates for future projects.

**Removed from earlier draft:** "unpaid job follow-up" was previously listed here as an automation candidate. Per Q7 (full Q&A), this is NOT a current friction point: *"Not currectly sure how many if any."* Don't build for this.

### Dashboard/visibility (NOT a priority)

> "I don't feel like I have to dig for much of anything really. Everything is easily accessible"

Don't over-invest in dashboards thinking they'll help her — she doesn't perceive visibility as the problem.

### Strategic ask (the priority signal)

When asked "if you could fix ONE thing": "More support for the office. Not in the office just in general."

Translation: she wants tools that reduce the load, not extra people. The current Tech Assist v1 + future automation projects (AR tracker, parts visibility, customer follow-up) are exactly this.

### Good day vs bad day (energizing vs draining)

- Good day: real-time tech reports + timely customer responses + full schedule.
- Bad day: opposite of all those.
- Side note: Dawn handles most of the customer messaging system — worth understanding her workflow for future tool design (TDR delivery, customer follow-up automation).

### Success metrics for Tech Assist v1 (post-launch) — corrected 2026-05-05

Measurable improvements to track:
- **Daily tech-chasing volume** (target: drop count of "request something from someone" instances per week — measured via Tech Assist completion-enforcement preventing incomplete TDRs from being submitted in the first place).
- **AHS rejection rate** (target: drop via phrasing coach — avoid "bad" and similar non-accepted words; suggest "how the failure affects the machine" alternatives).
- **Parts-pending → completion-when-arrived gap** (target: real-time tech-to-office signal eliminates "didn't tell me it's done").
- ~~Submission-time-to-warranty-co (target: same-day vs 2-week baseline).~~ **Removed:** baseline was misread; submission is already 2 days, not a target area.

### What this unlocks

- **Phase 1d scope sharpens** to: completion-enforcement on TDR + AHS phrasing coach + warranty-company-aware question sets (AHS narrative vs SquareTrade decision-tree) + parts used/not-used/needed-for-second-repair tracking.
- Phase 1d is no longer interview-blocked. Still blocked on TCR clearance for SMS delivery (campaign rejected 2026-05-05; fix landed; resubmission pending per `tcr_pending_blocks_sms_verification.md` memory).
- AR tracker design has clearer scope — binary paid/unpaid, no partial-payment tracking needed.
- Future Tier 3 customer messaging automation has a clear customer (Dawn) and a clear use case (timely response). Per Q10: Dawn + Danielle handle messages with judgment, not rules — AI triage is Phase 3+.
- Parts visibility self-serve tool is a small high-leverage project after Tech Assist v1 ships.

### Future projects identified (NOT Phase 1d)

| Project | Phase | Eliminates | Source |
|---|---|---|---|
| AHS portal auto-population | 2 | Danielle's manual data re-entry into AHS portal | Q2 |
| Unified parts-arrival event source | 2 | TN/LA workflow split (TN: Google Sheets + Meister; LA: customer-notify or Dawn-tracking) | Q6 |
| Customer-message AI triage | 3 | Routing decisions between Dawn (routine) and Danielle (escalations) | Q10 |

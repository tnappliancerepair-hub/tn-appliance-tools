Discovery report from 2026-05-09 chat session, written by Claude Code session-paced from repo + design docs. Companion to docs/system-blueprint-v1.md and docs/system-blueprint-decisions-2026-05-09.md.

---

# Tech Scheduler vs Tech Assist — discovery report

**Source documents read end-to-end this session:**
- `docs/ant-tech-scheduler-design-v2.md` (633 lines, locked 2026-05-03)
- `docs/ant-tech-assist-design-v1.md` (285 lines, locked 2026-05-04)

**Predecessor not in repo:** `docs/ant-tech-scheduler-design.md` (the Saturday 5/2 evening voice/scope decisions doc) is referenced by v2's header but is NOT committed. Likely where the "9 design decisions" live — see §6.

**SKILL.md files:** none in repo.

---

## 1 — Tech Scheduler

### Purpose
SMS-based AI dispatcher that becomes each tech's daily point of contact. Absorbs the friction of schedule management — day-off requests, sick days, ASAP job broadcasts, customer reschedules, performance feedback, and "the constant low-level griping about jobs techs don't want." Long-term vision: replaces the human dispatcher (~$40-60k/yr role) for any appliance repair shop that licenses the platform — the B2B unit-economics moat.

### Surface area
- **UI surface:** SMS only. No HTML page. Tech texts the dedicated number `+17273508487`, conversation persists in Xano `agent_conversation` keyed on `tech_id + channel='sms'`.
- **Inbound endpoint:** `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` (api_group `scheduling`). Single router. Phone lookup → mode-select on `technicians.onboarding_completed_at` → onboarding flow (5 paired tokens) OR daily-mode (~640 lines, 7 paired tokens: `__CLAIM_BROADCAST__`, `__DECLINE_BROADCAST__`, `__UPDATE_AVAILABILITY__`, `__ADD_PREFERENCE__`, `__RESCHEDULE_JOB__`, `__ESCALATE_TO_OWNER__`, `__QUERY_MY_NUMBERS__`) plus 3 owner-only tokens (`__OWNER_REASSIGN_JOB__`, `__OWNER_OVERRIDE_AVAILABILITY__`, `__OWNER_BROADCAST_CONTROL__`).
- **Crons:**
  - `task/daily_tech_summary.xs` — every 15 min, gated by `DAILY_SUMMARY_ENABLED`.
  - `task/scheduling_queue_worker.xs` — every minute, gated by `SCHEDULING_QUEUE_ENABLED`. Dispatches `broadcast / book / propose / wait / notify / escalate / sick_day_cascade` queue rows.
  - `task/compute_tech_performance_ledger.xs` — nightly 04:00 UTC, gated by `LEDGER_TASK_ENABLED`. Computes 30-day rolling stats + pattern detection (O(N²) bucket scan over `broadcast_decline` event_log entries → sets `pending_pattern_offer`).
- **Tables it owns:** `scheduling_decision_history`, `scheduling_queue`, `tech_preferences`, `tech_performance_ledger`, `broadcast_attempt`. Plus added fields on `technician_decision_report` (scheduling_decision + audit fields), `jobs` (current_scheduling_decision, scheduling_status), `technicians` (daily_summary_time, preferred_hours_*, personal_context, onboarding_completed_at, pending_pattern_offer).
- **Triggers:**
  - TDR `scheduling_decision` change → enqueues a `scheduling_queue` row.
  - Daily summary cron at tech's preferred time.
  - Inbound tech SMS → freeform conversational reasoning, 7+3 tokens.
- **Owner integration:** Phone lookup recognizes Teddy → elevated permission flag in conversation context. Three owner-only tokens. `TECH ROSTER` block in CONTEXT to prevent tech_id ↔ name hallucination.

### Status
Phases 0-8 **shipped to backend** (commits 2026-05-03 / 2026-05-04). Phase 7b deterministic "my numbers" fallback shipped. Phase 8 owner override shipped. **All three relevant env gates (`SCHEDULING_QUEUE_ENABLED`, `DAILY_SUMMARY_ENABLED`, `LEDGER_TASK_ENABLED`) currently UNSET in production** — the system is built but dormant pending TCR clearance. Conversation 626 is the canonical Teddy SMS thread, end-to-end verified.

---

## 2 — Tech Assist

### Purpose
On-site field copilot. Closes the diagnostic submission loop. Triggers when a tech marks a job `in_progress` (HCP webhook), captures findings during the visit (web-primary with SMS fallback), and ensures all warranty-company-required TDR fields are complete before the tech leaves the data orphaned. **NOT a diagnostic AI, NOT a part-lookup tool, NOT a tech training tool. v1 = completion-enforcing scribe.**

### Surface area
- **UI surface:** Web page `tech-ant-live.html` (49,434 bytes, exists in repo, dated 2026-05-04). Sibling — not evolution — of existing `tech-ant.html` (post-job retrospective TDR, 25,031 bytes). Lifts the CaptureOverlay IIFE from `index.html:2046-2480`. Auth via existing PIN flow (`verify_tech_pin` + `verify-pin-proxy.js`).
- **Endpoints:**
  - `xano-workspace/api/intake/start_tech_assist_session_POST.xs` — called from `hcp_job_webhook` on `work_status=in_progress`. Auto-closes any prior open session on the same tech.
  - `xano-workspace/api/intake/tech_assist_chat_POST.xs` — main conversational handler. System prompt `$env.ANT_TECH_ASSIST_PROMPT`. Token vocabulary in repo: `__CAPTURE_FIELD__`, `__QUERY_STATUS__`, `__ESCALATE_TO_OFFICE__`, `__SEND_CUSTOMER_MESSAGE__`. Token shape uses paired-with-different-end-marker (`__CAPTURE_FIELD__ name="x" value="y" __END_CAPTURE_FIELD__`).
  - `xano-workspace/api/intake/get_tech_assist_session_history_GET.xs` — fetches recent agent_message rows for the live UI.
  - `xano-workspace/api/intake/validate_tdr_completeness_POST.xs` — on `job.completed`, checks required fields, fires escalation if needed.
- **Cron:** `task/compute_tech_assist_escalation.xs` — every 15 min, gated by `TECH_ASSIST_ENABLED`. Finds 2h+ stale `tech_assist_session` rows with required fields missing, SMS-escalates to owner.
- **Tables it owns:** `tech_assist_session` (status enum: active / awaiting_completion / complete / abandoned / escalated; carries `captured_data` json + `required_fields_remaining` json). Plus added fields on `technician_decision_report` (`tech_override_flag`, `tech_override_notes`, `ant_data_flag`, `ant_flag_reason`), `agent_conversation.assist_session_id`, `agent_message.source` enum, `customer.preferred_name`.
- **Triggers:**
  - HCP `work_status=in_progress` webhook → starts session.
  - Tech texts manually ("starting job 1234") → manual session start (designed; verify wiring).
  - Job `completed` event → `validate_tdr_completeness` fires soft-block check.
  - 2h escalation timer (cron).
- **6 Tier-1 customer message templates** locked in the doc (just-arrived / diagnosis-complete / starting-repair / wrapping-up / repair-complete / heading-out) using `{preferred_name}` + tech first name only.

### Status
**Partially built backend.** All four endpoints exist in `xano-workspace/api/intake/`, plus the table, plus the HTML page. The escalation cron is gated by `TECH_ASSIST_ENABLED` (currently UNSET). Build state per the doc: Phase 1a (schema + skeleton) is the canonical "ready to build" line. Live behavior requires `TECH_ASSIST_ENABLED` flip + system prompt populated in `$env.ANT_TECH_ASSIST_PROMPT`.

---

## 3 — Direct cross-references in the docs

The grep across both docs for `merge / unify / consolidate / unified / single tool / combined`:

- `docs/ant-tech-scheduler-design-v2.md:58` — "Combined with another env-var re-paste." (about prompt iteration; not a system-merge mention)
- `docs/ant-tech-assist-design-v1.md:284` — "Unified parts-arrival event source" (a future-projects table item about parts data unification, not a Scheduler+Assist merge)

**Tech Scheduler v2 (633 lines) makes ZERO references to Tech Assist** — no mentions of `tech_assist`, `tech-ant-live`, `assist session`, or any concept of an in-field copilot.

**Tech Assist v1 makes one explicit Scheduler reference** (line 40-41):
> "Twilio number: shared with Scheduler (+17273508487) — State-routed at webhook entry: if tech has active assist session for a job -> assist handler, else -> scheduler handler"

That's the entire documented integration pattern. **And it is NOT implemented in code** (see §5).

---

## 4 — The 9 design decisions

**Not in canonical form anywhere in the repo.**

- v2's header references the predecessor doc `ant-tech-scheduler-design.md` ("Saturday 5/2 evening, voice/scope decisions") — that file does NOT exist in `docs/` today.
- v2 documents 8 BUILD PHASES (0-8), not 9 design decisions. They map to schema, tech ID + onboarding, daily summary, TDR processor, broadcast logic, conversational reasoning, sick-day cascade, performance ledger, owner override.
- The phrase "9 design decisions" appears in the repo only in `docs/system-blueprint-v1.md:578` (my own carry-forward note from yesterday flagging the gap) and in `docs/cash-tdr-delivery-design-v1.md:3` referring to a different "4 design decisions LOCKED 2026-05-05" for cash-TDR.

**Conclusion:** the "9 design decisions" Teddy referenced live in either (a) the uncommitted predecessor doc, (b) a chat session transcript, or (c) Teddy's working memory. Cannot be quoted from repo state today.

---

## 5 — Merge / unify language: explicit answer

**No design doc anywhere mentions merging Tech Scheduler and Tech Assist into a single unified tech tool.**

Closest the docs come:
- The shared-Twilio-number / state-routed-handler pattern in Tech Assist v1 line 40-41. That's **integration**, not merge.
- The `agent_message.source` enum (`tech_assist | customer_ant | tech_scheduler | manual`) treats them as siblings under a shared conversation table. That's **shared infrastructure**, not unified product.

**Flag for the architecture session:** the merge direction Teddy is considering is **undocumented**. No prior decision quotes exist to ground it. Whatever shape it takes will be a Teddy-driven framing, not a derivation from existing docs.

---

## 6 — Data and decision flow as it exists today

```
                     ┌────────────────────────┐
                     │ TDR scheduling_decision│
                     │  (set in Teddy Tool)   │
                     └───────────┬────────────┘
                                 │ trigger
                                 ▼
                       ┌───────────────────┐
                       │ scheduling_queue  │ (Scheduler-owned)
                       └─────────┬─────────┘
                                 │ worker dispatch
                       ┌─────────┴─────────┐
                       ▼                   ▼
           ┌──────────────────┐   ┌──────────────────┐
           │ broadcast SMS to │   │ propose / book / │
           │  qualified techs │   │  notify / wait   │
           │   (Scheduler)    │   │   (Scheduler)    │
           └────────┬─────────┘   └──────────────────┘
                    │ tech accepts via SMS
                    ▼
              ┌───────────┐
              │ jobs.tech │
              │  assigned │
              └─────┬─────┘
                    │
                    ▼  (HCP records job + dispatches tech in HCP)
            ╔═══════════════╗
            ║   HCP system  ║
            ╚═══════╤═══════╝
                    │ webhook: work_status=in_progress
                    ▼
       ┌───────────────────────┐
       │ start_tech_assist_    │ (Assist takes over)
       │  session_POST.xs      │
       └───────────┬───────────┘
                   │
                   ▼
       ┌───────────────────────┐
       │ tech_assist_session   │  ← captured_data, required_fields_remaining
       └───────────┬───────────┘
                   │ tech captures via tech-ant-live.html
                   │ → tech_assist_chat_POST.xs
                   │
                   ▼
            ┌─────────────┐
            │ HCP work_   │  webhook on completion
            │ status=     │──────────────────────────┐
            │ completed   │                          │
            └─────┬───────┘                          ▼
                  │                       ┌──────────────────────┐
                  └──────────────────────▶│ validate_tdr_        │
                                          │  completeness_POST   │
                                          └──────────┬───────────┘
                                                     │ if missing fields
                                                     ▼
                                          ┌──────────────────────┐
                                          │ 2h escalation cron → │
                                          │  SMS owner (Danielle)│
                                          └──────────────────────┘
```

### Where Tech Scheduler hands off to Tech Assist
**Implicitly via HCP, not directly.** Scheduler's broadcast → tech accepts → `jobs.technician_id` is set → HCP holds the job → tech marks `in_progress` in HCP → HCP webhook fires → `start_tech_assist_session` runs. No direct Scheduler→Assist call. No shared session ID at the system boundary. **HCP is the de-facto handoff bus.**

### Does Assist feed back to Scheduler?
**No, not today.** Searched both repo + docs:
- `tech_assist_session.status` transitions (active → awaiting_completion → complete/abandoned/escalated) are written by Assist endpoints; the Scheduler never reads them.
- `tech_assist_session.captured_data` is private to Assist.
- `validate_tdr_completeness` results don't write to `tech_performance_ledger`.
- Escalation events go to Danielle/Teddy via SMS, not into the Scheduler's pattern-detection or preference-suggestion systems.

The performance ledger COULD ingest signals like "tech leaves jobs incomplete" → "soft preference: this tech needs more time per job" → adjust scheduling weights. **It doesn't, today.** Pure Scheduler-internal: ledger reads from `broadcast_attempt` (offered/accepted), `event_log` (broadcast_decline, sick_day_silent_reassign), `scheduling_decision_history` (called_off detection).

### Who populates `tech_performance_ledger`?
**Exclusively the Scheduler.** `xano-workspace/task/compute_tech_performance_ledger.xs` writes the rows. The only reader of the ledger is the Scheduler's `__QUERY_MY_NUMBERS__` token handler in `tech_sms_inbound_POST.xs:1320`. No Assist code touches it.

---

## 7 — Architectural overlap and duplication

Where the two systems touch the same data, surface, or workflow but treat it as separate concerns:

### Shared concerns currently treated as separate

| Concern | Scheduler | Assist | Overlap signal |
|---|---|---|---|
| **Tech identity / phone lookup** | `tech_sms_inbound_POST.xs` lines 24-50: phone E.164 + last-10 fallback + `technicians` table read | `start_tech_assist_session_POST.xs` looks up tech by `technician_id` (already known via HCP webhook) | Same `technicians` table, different lookup mechanisms |
| **Conversation persistence** | `agent_conversation` keyed on `tech_id + channel='sms'`; `agent_message.source='tech_scheduler'` | `agent_conversation` keyed on `tech_id + channel='web'` (likely; verify); `agent_message.source='tech_assist'` + `assist_session_id` FK | **Same two tables, source-tagged.** Designed for shared infrastructure but not used as such today |
| **TDR field writes** | Sets `scheduling_decision`, `scheduling_decision_updated_by` via Teddy Tool | Sets `tech_override_flag`, `tech_override_notes`, `ant_data_flag`, `ant_flag_reason`; captures structured TDR data into the rest of the TDR fields | Both write to `technician_decision_report` but on different fields. No conflict, but no shared validator either |
| **Twilio number `+17273508487`** | Active outbound (~10 call sites in v2 code) and inbound (TwiML reply) | Designed shared (per Tech Assist v1 doc line 40), but in code Assist communicates via web UI not SMS | **Documented intent ≠ built reality.** Assist's SMS fallback is unimplemented |
| **Claude / paired tokens** | 7 + 3 tokens in `tech_sms_inbound`, paired form `__T__{}__T__` and bare `__T__` | 4 tokens in `tech_assist_chat`, paired-with-different-end-marker form `__T__ inner __END_T__` | Two different token vocabularies, two different parsing patterns, both running on Anthropic. Footgun #13 (paired-with-different-end) was discovered in Assist build |
| **System prompt env var** | Daily-mode prompt assembled in `tech_sms_inbound` (likely composed from multiple env vars) | `$env.ANT_TECH_ASSIST_PROMPT` (separate env var, separate persona) | Two distinct AI personas, one tech-side workflow |
| **Tech Roster context** | v2 Phase 8 added `TECH ROSTER` block in CONTEXT to prevent tech_id hallucination | Not present in Assist's prompt today (verify during merge session) | Assist could borrow the same pattern |
| **Customer messaging** | Sick-day cascade composes a 2-option script for the customer | 6 Tier-1 templates for arrival/diagnosis/wrap-up | Both write customer-facing copy with the same Twilio account, different code paths |

### Specific duplications likely candidates for de-duplication in a unified design

1. **The "tech identification" layer.** Scheduler does an exhaustive phone lookup; Assist relies on HCP webhook providing `technician_id`. A unified entry point would have one identification layer that hands off `tech` to either path.
2. **The `agent_conversation` channel split.** Today there are conceptually two threads per tech (SMS scheduling + web assist). A unified architecture could treat them as one conversation with a session-context selector.
3. **The "what's the tech doing right now" question.** Scheduler doesn't know if a tech is in an active assist session (didn't read `tech_assist_session`). Assist doesn't know if a tech is mid-broadcast or onboarding. Unified state would let either side see the other's mode.
4. **Performance ledger inputs.** Today only Scheduler-event signals feed it. A merged tool could include Assist signals (TDR-completion timeliness, escalation count, override-rate) as additional dimensions.
5. **Customer-facing SMS infrastructure.** Both systems compose customer SMS independently. The customer-transparency SMS workstream (locked in yesterday's decisions doc) will overlap with both Scheduler's sick-day reroute customer messages AND Assist's 6 Tier-1 templates.

### What's NOT overlapping (clean separation)

- **Scheduler tables** (`scheduling_decision_history`, `scheduling_queue`, `tech_preferences`, `tech_performance_ledger`, `broadcast_attempt`) are exclusive to Scheduler.
- **Assist table** (`tech_assist_session`) is exclusive to Assist.
- **Triggers are distinct:** TDR-decision-change → Scheduler queue; HCP-in_progress → Assist session.

---

## 8 — Bottom-line for the architecture session

What you actually have to work with:

1. **Two independent backends** that share three pieces of infrastructure (`technicians`, `agent_conversation/agent_message`, `technician_decision_report`) and one Twilio number (in design, not in code).
2. **Tech Scheduler is more complete** — 8 phases shipped, all three env gates flippable. **Tech Assist is partially complete** — endpoints + table + HTML exist; one env gate (`TECH_ASSIST_ENABLED`); SMS fallback path documented but not built.
3. **HCP is the implicit bus** between Scheduler and Assist. No direct call.
4. **No feedback loop from Assist into Scheduler.** Performance ledger is Scheduler-only. Pattern detection is Scheduler-only.
5. **The "9 design decisions" Teddy referenced are not in the repo.** They likely live in the uncommitted predecessor doc or in chat history. The architecture session needs them surfaced before relying on them.
6. **No documented merge/unify intent.** The merge direction is Teddy's working framing, not a derivation from existing docs. Whatever the unified tool becomes will be a fresh architectural choice.
7. **The shared-Twilio-with-state-router pattern in Tech Assist v1 doc is an unbuilt design.** Assist runs over web today. Activating SMS fallback for Assist would require building the state router into `tech_sms_inbound_POST.xs` — a non-trivial change (the file is ~640 lines of dense daily-mode logic).

The single highest-leverage question for the architecture session, surfaced by this discovery: **"Is the merger about (a) merging the conversational AI persona — one Ant the tech talks to for both schedule + on-site — or (b) merging the data plane — one shared session/state/ledger that both modes read and write — or (c) both?"** The two answers lead to very different builds.

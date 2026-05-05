# Ant Tech Scheduler — Complete Design + Build Order

**Date locked:** May 3, 2026 (Sunday afternoon)
**Status:** Full design complete. Ready to build.
**Owner:** James "Teddy" Pivacek, TN Appliance Exchange
**Predecessor:** ant-tech-scheduler-design.md (Saturday 5/2 evening, voice/scope decisions)

---

## EXECUTIVE SUMMARY

Ant Tech Scheduler is the SMS-based AI dispatcher that becomes each tech's daily point of contact. It absorbs the friction of schedule management — day off requests, sick days, ASAP job broadcasts, customer reschedules, performance feedback, and most importantly, the **constant low-level griping about jobs techs don't want** that human dispatchers get worn down by.

**Long-term vision:** Replaces the human dispatcher (~$40-60k/yr role) for any appliance repair shop that licenses the platform. The B2B unit economics moat.

**Today's vision:** Eliminate Teddy and Danielle's biggest pain point — being the sponge for every tech complaint about their schedule. Ant listens infinitely, never gets annoyed, captures patterns, and quietly shapes future schedules to honor what each tech wants. Techs feel heard without anyone burning out.

---

## BUILD STATUS

| Phase | Status | Notes |
|-------|--------|-------|
| 0. Schema | ✅ COMPLETE (5/3) | All 3 modified tables + 5 new tables pushed and verified |
| 1. Tech ID + onboarding | ✅ COMPLETE (5/3) | End-to-end backend proven: Twilio → Netlify → Xano → Anthropic → token parsing → persistence. Outbound delivery TCR-blocked but all server-side logic verified. Conv 626 (tech_id=1) is the canonical Teddy SMS thread. Bugs caught + fixed during build: model string typo (`20251001` → `20250929`) and phone-lookup regex capture-group failure (replaced with literal `+1` strip + SQL OR-match). |
| 2. Daily summary cron | ✅ BUILT, DISABLED (5/3) | Defaults to off via `$env.DAILY_SUMMARY_ENABLED`. Awaiting morning live test (5/4 at Teddy's onboarded summary time) for real validation. |
| 3. TDR processor + queue worker | ✅ COMPLETE (5/3) | Smoke-tested end-to-end on TDR 14 / Job 195. Endpoint inserts history row, updates TDR + jobs denorm, queues action; auto-cron worker picked up the queue row 7 min later and ran the broadcast stub correctly. Cron defaults to off via `$env.SCHEDULING_QUEUE_ENABLED`. Cleanup ran (test data reverted). |
| 4. Broadcast logic | ✅ COMPLETE (5/3) | Real broadcast handler replaces Phase 3 stub. Filters: cluster + availability + hard prefs (full-day-off only — capacity check + time-window prefs deferred to V2). Inserts `broadcast_attempt`, fans out SMS via Twilio env-var pattern (FROM=+17273508487, "+1"+tech.phone), populates techs_notified with `{tech_id, phone, sid, success}` per recipient. Worker also runs an expiry sweep each tick: open broadcasts past expires_at flip to `expired` and queue an `escalate` row. Smoke-tested end-to-end on Job 195 / TN Metro: 3 techs notified (Teddy, Lee, Jimmy) with valid Twilio SIDs (TCR-blocked outbound delivery, but API-level all 3 succeeded). Empty-qualified-set path also tested (cluster set to fake string → failed + escalate row). Idempotency confirmed (duplicate broadcast queue row correctly skipped while existing was open). Inbound claim handling deferred to Phase 5. Phase 3 cosmetic fix bundled (empty-string-aware `?? "default"` fallbacks). |
| 5. Conversational reasoning | ✅ COMPLETE (5/3) | Daily-mode handler (~640 lines) replaces the stub in `tech_sms_inbound_POST.xs`. CONTEXT block injected at runtime (today date anchor, hard/soft prefs, pending broadcasts filtered by `techs_notified` array, jobs scheduled next 3 days, owner override flag). 7 paired-token tools wired: `__CLAIM_BROADCAST__` (race-safe two-step + win-path SMS to losers), `__DECLINE_BROADCAST__` (event_log only), `__UPDATE_AVAILABILITY__` (find-or-create row), `__ADD_PREFERENCE__` (reuses Phase 1 shape), `__RESCHEDULE_JOB__` (defensive own-job check + auto-escalate on cross-tech), `__ESCALATE_TO_OWNER__` (event_log + Twilio to OWNER_PHONE_NUMBER), `__QUERY_MY_NUMBERS__` (Phase 7 placeholder). Tested 7 scenarios — 6 passed cleanly, 1 (owner cross-tech) deferred to Phase 8. **3 critical bugs caught and fixed during testing**: (a) Today date anchor missing in CONTEXT — Claude couldn't resolve "tomorrow"; added `Today: YYYY-MM-DD (Day) - Central Time` line. (b) **XanoScript bug**: `regex_replace` with `[\s\S]*?` non-greedy returns `null` instead of the modified string. Refactored ALL 7 token strips from regex_replace to split-on-token + rejoin (`parts[0] ~ parts[2]`). Phase 1 had the same latent bug but never surfaced because onboarding had no empty-reply fallback. (c) Conversation-history poison pill: empty-content assistant messages and consecutive same-role messages cause Anthropic 400. Added defensive filter (skip empty content + skip same-role-as-last-pushed) when building messages array. Empty-reply fallback (`"got it"`) added so post-strip empty replies don't blank-SMS the tech. |
| 6. Sick day cascade | ✅ COMPLETE (5/3) | Auto-reroute when a tech's `__UPDATE_AVAILABILITY__` fires for TODAY with `available=false`. Daily-mode handler enqueues a `sick_day_cascade` row in scheduling_queue (added to enum) with `metadata={tech_id, sick_date, reason}`. New `metadata` JSON field on scheduling_queue carries tech-scoped context for handlers that operate outside a single-job. Worker handler: idempotency dedupe (skip if a completed cascade exists for same tech+date), pull today's jobs, attempt silent cluster reroute (find first active alternate by rank, exclude sick tech), fall back to customer 2-option SMS when no alternate, confirm back to sick tech with outcome-tailored message (4 variants: zero-jobs / all-reassigned / all-customer / mixed). Tested 3 scenarios, all passed: zero-jobs path (Teddy with 0 jobs → just confirmation SMS), silent reroute (job 220 → reassigned tech 1→tech 4 with `sick_day_silent_reassign` event_log), customer SMS (Lee+Jimmy deactivated → `sick_day_customer_notified` event_log + Twilio call to customer). **2 critical bugs caught and fixed**: (a) `db.get` with `null` `field_value` throws and kills the enclosing foreach mid-iteration before the finalize step. Worker had `db.get jobs by row.job_id` upfront before dispatch — fine for job-scoped actions but threw for sick_day_cascade where `job_id=null`. Wrapped in a null check. (b) `(($val ?? "")|trim) != ""` in if-predicate context can mis-evaluate when the chain involves multiple parens — same XanoScript filter precedence quirk we saw in Phase 5 CONTEXT block. Fix: hoist the trimmed value into a `var` first, then compare. Customer reply handling deferred to **Phase 6b** (Teddy/Danielle handle replies manually for now). |
| 7. Performance ledger + patterns | ✅ COMPLETE (5/3→5/4) | Schema migration: added `pending_pattern_offer json?` to `technicians`. New task `compute_tech_performance_ledger` runs daily at 04:00 UTC, gated by `$env.LEDGER_TASK_ENABLED`. Computes 30-day rolling ledger per tech: offered (broadcasts where tech in `techs_notified` array), accepted (`claimed_by_tech_id == tech.id`), called_off (broadcast_decline + sick_day fallout where this tech was sick), helped_out (sick_day_silent_reassign where this tech took the redirect), acceptance_rate, team_avg_acceptance_rate (backfill pass after all techs processed). Pattern detection scans last 14 days of `broadcast_decline` event_log; for each tech, builds context array {city, dow, time_window} from broadcast→job→customer chain, runs O(N²) bucket scan across 3 dimensions, picks highest count ≥ 3, verifies tech doesn't already have a matching active pref, sets `pending_pattern_offer` with {dimension, value, match_count, detected_at}. Modified `tech_sms_inbound_POST.xs`: CONTEXT block renders PENDING PATTERN OFFER section (with dimension-specific instructions for Ant), `__ADD_PREFERENCE__` clears `pending_pattern_offer` when source=pattern_detected, `__QUERY_MY_NUMBERS__` handler pulls latest ledger row and auto-appends formatted readout (offered/accepted/called off/helped out + team-avg comparison; "ahead of"/"below"/"right around" the pack based on ±5% delta). Verified: ledger task runs cleanly (6 rows for 6 techs, all counts 0 given clean state, team_avg backfill works). Token strip refactored from split/rejoin to chained `replace` calls to handle both paired (`__TOKEN__{}__TOKEN__`) and bare (`__TOKEN__`) token forms — Claude inconsistently emits one or the other. **Phase 7b carryover documented separately** for the LLM-behavior gap on token firing. |
| 8. Owner override | ✅ COMPLETE (5/4) | Three new owner-only paired tokens added to `tech_sms_inbound_POST.xs`: `__OWNER_REASSIGN_JOB__` (changes `jobs.technician_id`, notifies both old + new tech via Twilio, event_log audit), `__OWNER_OVERRIDE_AVAILABILITY__` (find-or-create `tech_availability` row for any tech on any date, notifies affected tech), `__OWNER_BROADCAST_CONTROL__` (action="expire" force-expires open broadcast / action="rebroadcast" inserts new `scheduling_queue` row). All handlers defensive-guard on `$tech.id == 1` (Teddy) — even if a non-owner conversation somehow emits the token, the handler refuses to act. Daily prompt updated with `OWNER-ONLY TOOLS` section explaining the 3 tools + when to use + question-confirm reminders for vague intent. **Critical safety fix discovered during testing**: Claude hallucinates tech_id ↔ first_name mapping (said "Billy" but fired token with tech_id=3 / Andre — wrong tech got marked unavailable). Fix: added `TECH ROSTER` block to CONTEXT (only renders when `OWNER OVERRIDE: true`) listing all active techs as `tech_id=N: FirstName LastName`. Re-test with roster fix verified Claude correctly used tech_id=5 for Billy. Tests run: vague request ("tell billy to push his thursday jobs") → Claude correctly asked for specifics, no token fired ✅; specific request ("mark billy out") → token fired with correct tech_id (after roster fix) ✅; non-existent broadcast ("expire broadcast 999") → handler silently no-op'd correctly ✅, though Claude's prose claimed "killed broadcast 999" — overconfident-prose LLM behavior, documented as 8b carryover. Phase 5 Test 7 carryover (cross-tech ops not firing tokens) is now resolved via dedicated owner tools. |

### Carryover items for Phase 4

These are cosmetic Phase 3 artifacts that don't affect logic but should get cleaned up when Phase 4 builds the real broadcast handler:

1. **`previous_decision` stored as `""` not `null`** in `scheduling_decision_history` when the source TDR's `scheduling_decision` was unset. Cause: Xano stores empty string for unset text/enum fields rather than null. Fix: in `update_scheduling_decision_POST.xs` step 5, normalize `$previous_decision = ($tdr.scheduling_decision == "" ? null : $tdr.scheduling_decision)` before writing the audit row.
2. **`?? "unknown"` fallback skipped on empty-string fields**. Same root cause. Affects `cluster` rendering in the broadcast stub's `result_notes` (saw `cluster ''` in the smoke test instead of `cluster 'unknown'`). Fix when the real broadcast handler reads cluster: use `(($job.cluster|trim) != "") ? $job.cluster : "unknown"` or similar empty-aware fallback. Apply same pattern to any other `?? "default"` reads of TDR/job text fields.

These are 2-line patches each — bundle with Phase 4's broadcast handler PR.

### Phase 7b — QUERY_MY_NUMBERS pattern-match fallback ✅ COMPLETE (5/4)

Refactored the `__QUERY_MY_NUMBERS__` handler from single-conditional (token-only) to **flag-based dual-trigger** (`$force_numbers_append`). The append fires when EITHER Claude emits the token OR the user's message body matches numbers-intent patterns. The pattern fallback is deterministic — no reliance on Claude cooperation. Patterns matched (lowercase, OR'd): `my numbers`, `my number`, `how am i doing`, `how am i performing`, `acceptance rate`, `my stats`, `my performance`, `whats my`, `what's my`, `show me my`. Verified end-to-end: positive cases append real numbers, negative control ("yo whats good") does not. **Bug caught during 7b testing**: the chained `||` between `$body|contains:"X"` expressions had the same XanoScript filter-precedence ambiguity as several other footguns — wrapping each `contains` expression in parens (`($body|contains:"X") || ($body|contains:"Y")`) fixed it. Tech still sees Claude's sometimes-fabricated lead-in prose followed by the labeled real numbers — UX is not perfect, but the truth is always present and labeled. Acceptable for V1.

### Original carryover from Phase 7 (now resolved by 7b)

Server-side ledger compute is fully shipped in Phase 7 — schema, nightly task, computation, auto-append code all working. The remaining gap is conversational presentation:

- **Claude doesn't reliably fire `__QUERY_MY_NUMBERS__`** when the tech asks about numbers/stats. Across 4 attempts during testing, Claude variously: (1) wrote placeholder-themed prose without firing, (2) emitted bare token (single not paired), (3) emitted token but ALSO fabricated numbers in the lead-in, (4) made up numbers entirely with no token at all.
- **Number fabrication**: when Claude does fire the token, it sometimes also writes plausible-sounding fake numbers in the prose ("90% acceptance, no calloffs in the last month"). Tech sees the fake lead followed by the real auto-appended readout — confusing but not data-corrupting.
- **Prompt updates didn't fully solve it.** We tried strengthening the QUERY_MY_NUMBERS section in `ANT_TECH_DAILY_PROMPT` to remove "placeholder" language and emphasize "system auto-appends real numbers, don't fabricate". Conversation-history poisoning (Claude staying consistent with its own prior placeholder responses) required deleting historical messages 3417 + 3419 to force a fresh framing — and even then Claude went sideways.

**Possible Phase 7b fixes (in order of preference)**:
1. **Code-side pattern match in `tech_sms_inbound_POST.xs`** (15 min, deterministic). Detect "my numbers"/"acceptance rate"/"how am i doing" in `$input.body`, force the ledger lookup + append regardless of token presence. Deterministic UX, no reliance on Claude cooperation.
2. **Anthropic native `tool_use` API** instead of paired-token convention (bigger refactor). Would let the model commit to a tool call as a structured response instead of emitting tokens in natural language. Forces stop-and-call-tool semantics. Would touch all 7 tools, not just QUERY_MY_NUMBERS.
3. **Stronger prompt language**: "DO NOT write any numbers in your prose. The system handles all numerical data. Your prose is 5–10 words max." Combined with another env-var re-paste.

**Workaround until 7b ships**: tech can still ask, system gives plausible-but-fake numbers from Claude + real numbers auto-appended at the end. Confusing UX but the underlying ledger is unaffected — Teddy/Danielle can pull real numbers from the dashboard or Meta API directly.

### Phase 8 — owner override ✅ SHIPPED (5/4) — see Build Status table for details.

The Phase 5 Test 7 carryover ("tell billy to push his thursday jobs") is resolved: Phase 8 added 3 dedicated owner-only paired tokens, the daily prompt explains them, and a TECH ROSTER block in CONTEXT prevents tech_id hallucination.

### Carryover items for Phase 8b (LLM-behavior polish)

Phase 8 ships with two known LLM-behavior gaps that don't affect data correctness but produce confusing UX:

- **Day-of-week math is consistently wrong.** Across multiple phases (5, 6, 7, 8), Claude has gotten day-of-week → date arithmetic wrong (e.g., "next Thursday" → 5/9 Saturday). Server-side handlers use whatever date Claude provides; if Claude says "Friday" but stores 5/9 (Saturday), the row goes to the wrong date. Possible 8b fix: pre-compute the next 7 days in the CONTEXT block and label each (`Tomorrow: 2026-05-05 (Tuesday)`, `Wednesday: 2026-05-07`, etc.) so Claude maps day-name → date by lookup instead of arithmetic.
- **Overconfident success prose on owner_broadcast_control no-ops.** When Teddy asks to expire broadcast 999 and the handler correctly silently no-ops (no such open broadcast), Claude's prose claims "killed broadcast 999" — leading Teddy to think it worked. Possible 8b fix: append a status note from the handler when a no-op fires (`"(actually that broadcast wasn't open — may have already been claimed or canceled)"`), similar to the race-lost note in CLAIM_BROADCAST.

Neither blocks production deployment — these are polish items.

### XanoScript footguns — language quirks discovered during build

Document these for any future XanoScript work:

1. **`regex_replace` with non-greedy `[\s\S]*?` returns `null`** instead of the modified string. Workaround: use `split:"<token>"` then rejoin `parts[0] ~ parts[2]`. Affects any pattern that uses non-greedy any-char matching.
2. **`db.edit` has no compound WHERE** — only takes `field_name/field_value` (PK match). For atomic conditional updates (e.g., "claim broadcast WHERE status='open'"), use a two-step: `db.query` to verify state, then `db.edit` by PK. Small race window.
3. **`?? "default"` fallback doesn't fire on empty strings**. Xano stores unset text/enum fields as `""`, not `null`. Use `(($val|trim) != "") ? $val : "default"` for empty-aware fallbacks.
4. **Anthropic API rejects empty-content messages and consecutive same-role messages** in the messages array. Always filter conversation history before sending: skip messages where `(content|trim) == ""` and skip messages where `role == previous_pushed_role`.
5. **No explicit timezone arg on `format_timestamp`** in confirmed-working code. To express CT, use `now|transform_timestamp:"-5 hours"|format_timestamp:"H:i"` (assumes CDT — adjust to `-6` for CST in winter).
6. **Filter precedence inside long string concatenations** can be ambiguous — hoist filtered values into vars before the concat to avoid surprises.
7. **`db.get` with `null` `field_value` throws and kills the enclosing `foreach` mid-iteration**, before any finalize step. The row stays in whatever state the iteration set it to (e.g., `processing`) and is never reprocessed because the next tick's pending-rows query excludes processing. Always wrap `db.get` in a null-check when the PK might be null. Discovered in Phase 6 — `scheduling_queue_worker` pre-fetched `$job` from `$row.job_id` before dispatch, which threw for the new `sick_day_cascade` action where `job_id` is intentionally null.
8. **`(($val ?? "")|trim) != ""` in `if`-predicate context can mis-evaluate** even when `$val` is a non-empty string — same filter-precedence quirk as #6 but in conditional-test position. Hoist into a `var $trimmed { value = ($val ?? "")|trim }` first, then compare `if ($trimmed != "")`. Discovered in Phase 6 testing — debug log showed the field value was correct but the `if` branched as if it were empty.
9. **`split:"<token>"` strip approach assumes paired tokens**. When the LLM emits a bare single token instead of paired (`__TOK__` instead of `__TOK__{}__TOK__`), `split` returns 2 parts not 3, the `>= 3` count check fails, and the token stays visible in the reply. Solution: chain `replace` calls to handle both paired and bare forms, e.g. `|replace:"__TOK__{}":""` then `|replace:"__TOK__":""`. Discovered in Phase 7 testing — Claude inconsistently fires `__QUERY_MY_NUMBERS__` paired vs. bare.
10. **Conversation-history poisoning**. When a prompt change alters the meaning or availability of a tool, the historical assistant messages where the model said "this isn't available yet" must be deleted (or the conversation reset) — otherwise the model stays consistent with its own prior responses and ignores the prompt update. Discovered in Phase 7: changing `__QUERY_MY_NUMBERS__` from placeholder to real didn't take effect until poisoned `agent_message` rows 3417 and 3419 were deleted from `conversation_id=626`. The model was reading its own "still placeholder" replies and refusing to fire the token.
11. **Chained `||` between filter expressions in `if` predicates** has the same precedence quirk as #6 and #8. `$body|contains:"X" || $body|contains:"Y"` mis-parses — the `||` binds inside the `contains` filter argument. Wrap each filter expression in its own parens: `($body|contains:"X") || ($body|contains:"Y")`. Discovered in Phase 7b — the deterministic pattern fallback wasn't firing because the multi-pattern `||` chain was being parsed as a single `contains` call with a weird argument.
12. **Dynamic-arg `|filter` does not bind outer-scope variables**. `$arr|filter:$this != "literal"` works fine — confirmed in `normalize_service_zone_clusters_POST.xs` (`$tech_array|filter:$this != "Omer"`). But `$arr|filter:$this != $dynamic_var` silently drops every element regardless of value, as if `$dynamic_var` evaluates to something that makes the comparison always false (or the closure doesn't see the outer var at all). Workaround: nested `foreach` over the source array with an inner `foreach` over a pre-built names-list, manually checking equality and `array.push`-ing keepers into a fresh accumulator. Discovered in Phase 1c (Tech Ant Assist) — `$session.required_fields_remaining|filter:$this != $cf_field_name` was wiping the entire array on every `__CAPTURE_FIELD__` token instead of removing only the captured name. Note: dynamic-arg `|set` on objects (`$obj|set:$dynamic_key:$dynamic_value`) DOES work — this footgun is `|filter`-specific.
13. **Paired-with-different-end-marker token parsing**. The Phase 1b strip pattern `$reply|split:"__TOKEN__"` followed by an `if count >= 3` check assumes the open and close markers are the same string (`__TOKEN__{}__TOKEN__` style). For paired-with-different-end-marker tokens (`__TOKEN__ inner __END_TOKEN__` style), the outer split returns 2 parts not 3, the `>= 3` branch never fires, and the inner content never gets extracted — even though the strip-only `else` branch silently masks the bug by removing both markers and leaving the inner attribute string visible in the user-facing reply. Workaround: outer-split on the opening marker, then sub-split `[1]` on the end marker to get `[inner, post-prose]`. Then `clean_reply = pre ~ post`. Affected tokens in Tech Ant Assist Phase 1c: `__CAPTURE_FIELD__`, `__ESCALATE_TO_OFFICE__`, `__SEND_CUSTOMER_MESSAGE__`. Symptoms: event_log entries with `token_inner: ""` despite the model clearly emitting a populated inner; visible attribute strings (`topic="..." question="..."`) leaking into the tech-facing reply. Discovered in Phase 1c verification.

---

## ARCHITECTURE OVERVIEW

```
TDR (decision)
   │
   ▼
scheduling_queue (event)
   │
   ▼
Ant Tech Scheduler processor
   │
   ├── must_time → propose-and-confirm SMS to tech → book if accepted
   ├── ready_to_schedule → broadcast to qualified techs → first reply wins
   ├── awaiting_parts → hold until parts arrive → re-trigger
   ├── customer_constraint → use captured constraint to filter slot booking
   ├── second_visit_needed → create linked job, schedule appropriately
   ├── not_scheduling → close loop, no action
   └── hold_for_customer → notify human, pause
   │
   ▼
SMS to tech (Twilio) ↔ tech's phone
SMS to customer (Twilio) ↔ customer's phone
```

---

## DATA MODEL

### Existing tables (already in Xano)
- `tech_availability` — 384 rows, 90 days × 6 techs × Mon-Fri 8-4 bootstrapped
- `service_zone` — 120 rows, 6 clusters
- `cluster_assignment` — zip → cluster mapping
- `technicians` — 6 techs with phone numbers, HCP IDs
- `jobs` — has `customer_preference_text` and `scheduling_type` already
- `technician_decision_report` — TDR records

### New fields on existing tables

**`technician_decision_report`:**
- `scheduling_decision` enum (one of 6 values listed below)
- `scheduling_decision_updated_at` timestamp
- `scheduling_decision_updated_by` int (tech_id of updater, including Teddy)
- `scheduling_constraint` text (only used when decision = customer_constraint)

**`jobs`:**
- `current_scheduling_decision` enum (denormalized mirror of latest TDR value)
- `scheduling_status` enum (pipeline state — see status values below)

**`technicians`:**
- `daily_summary_time` time (e.g., "06:00:00") — set during onboarding
- `preferred_hours_start` time — overrides bootstrapped 8am if customized
- `preferred_hours_end` time — overrides bootstrapped 4pm if customized
- `personal_context` text — opt-in personal info captured during onboarding
- `onboarding_completed_at` timestamp

### New tables

**`scheduling_decision_history`:**
```
id (int, PK)
created_at (timestamp)
tdr_id (int, FK to technician_decision_report)
job_id (int, FK to jobs)
previous_decision (enum, nullable for first decision)
new_decision (enum)
changed_by (int, tech_id including Teddy)
changed_at (timestamp)
notes (text, optional)
```

**`scheduling_queue`:**
```
id (int, PK)
created_at (timestamp)
job_id (int, FK to jobs)
action_type (enum: broadcast, book, propose, wait, notify, escalate)
status (enum: pending, processing, completed, failed, escalated)
processed_at (timestamp, nullable)
result_notes (text, optional)
retry_count (int, default 0)
```

**`tech_preferences`:**
```
id (int, PK)
created_at (timestamp)
tech_id (int, FK to technicians)
preference_type (enum: geographic, time, both)
zip_or_area (text, nullable)
day_of_week (enum, nullable: monday..sunday)
time_window_start (time, nullable)
time_window_end (time, nullable)
strength (enum: hard, soft)
source (enum: explicit, vented, pattern_detected)
captured_via_text (text, the original message that captured this)
active (boolean, default true)
notes (text, optional)
```

**`tech_performance_ledger`:**
```
id (int, PK)
tech_id (int, FK to technicians)
period_start (date)
period_end (date)
offered_count (int, default 0)
accepted_count (int, default 0)
called_off_count (int, default 0)
helped_out_count (int, default 0)
acceptance_rate (computed, decimal)
team_avg_acceptance_rate (decimal, snapshotted)
updated_at (timestamp)
```

**`broadcast_attempt`:**
```
id (int, PK)
created_at (timestamp)
job_id (int, FK to jobs)
broadcast_type (enum: open_schedule_first_reply, must_time_proposal)
broadcast_at (timestamp)
expires_at (timestamp, nullable for 30-min escalation)
techs_notified (json array of tech_ids)
claimed_by_tech_id (int, nullable, FK to technicians)
claimed_at (timestamp, nullable)
escalated_to_owner_at (timestamp, nullable)
status (enum: open, claimed, expired, escalated, canceled)
```

---

## ENUMS

### `scheduling_decision` (6 values)
1. `ready_to_schedule` — parts on hand, can dispatch anytime
2. `awaiting_parts` — wait for parts delivery, then schedule
3. `customer_constraint` — must_time, with captured constraint
4. `second_visit_needed` — needs another visit later, link to original
5. `not_scheduling` — declined, closed, replace recommended
6. `hold_for_customer` — waiting on payment/signature/info

### `scheduling_status` (pipeline state)
- `pending` — TDR not yet completed
- `awaiting_parts` — parts ordered, not yet received
- `ready` — all preconditions met, ready to broadcast/book
- `broadcasting` — broadcast or proposal active
- `scheduled` — tech confirmed, customer notified
- `in_progress` — tech en route or on site
- `completed` — work done
- `escalated` — bumped to owner for manual handling
- `canceled` — job killed
- `held` — paused for customer action

### `broadcast_type`
- `open_schedule_first_reply` — flexible customer, first qualified tech wins
- `must_time_proposal` — rigid customer, propose specific time/tech

---

## BUSINESS LOGIC RULES

### Broadcast filter
For `ready_to_schedule` + `open_schedule` customer, broadcast pool = techs who pass all of:
1. **Cluster match** — tech is assigned to the customer's cluster
2. **Availability** — tech has open hours in next 3 days per `tech_availability`
3. **Capacity** — tech has < 6 jobs already booked that day
4. **Preferences** — tech's hard preferences don't conflict with this job

V1 implementation: cluster + availability filter only. Add capacity check + preference filter as data accumulates.

### Must_time booking
For `customer_constraint` + customer's specified time:
1. Find first qualified tech (cluster + availability + capacity + preferences)
2. Ant proposes via SMS: "tuesday 9-11am opening for fridge in hammond. yes/no?"
3. Tech confirms → booked, customer notified
4. Tech declines → propose to next qualified tech
5. After all qualified techs decline → escalate to Teddy

### No-takers escalation
- Broadcast goes out → 30-minute timer starts
- No claims by 30 min → escalate to Teddy
- Ant texts Teddy: "Job 234 in Hammond, no takers in 30 min. What do you want to do?"
- Teddy decides: manual assign, defer to next day, expand cluster, etc.
- Teddy's reply triggers Ant action

### Parts arrival flow
1. **Now (manual):** Danielle marks parts received in dashboard → triggers TDR update
2. **Future (auto):** Marcone API webhook updates parts received → triggers TDR update
3. **Reaction speed:** Hold until next business hour, batch within window
4. **Customer notification:** Two-message pattern
   - Immediate: "parts arrived, scheduling now"
   - Later: "tech confirmed [time]"

### Sick day cascade
1. Tech texts "sick today" → mark unavailable in `tech_availability`
2. Pull tech's jobs for today
3. For each job: try cluster reroute first (silent — customer never knows)
4. Reroute fails → Ant texts customer with 2-option script:
```
   Hey Sarah! It's Ant from TN Appliance. Billy came down 
   sick today and unfortunately I don't have another tech 
   free in your area to grab today's slot. 
   
   Want me to push to tomorrow morning? Billy should be back 
   by then. Or if you'd rather have someone else, I can get 
   John out Thursday afternoon.
   
   What works for you?
```
5. Confirm back to Billy: "got you covered. 3 of your 4 jobs reassigned. The 11am with sarah being rescheduled — she'll pick a new time. feel better."

### Daily summary
- **When:** Customizable per tech (default 6:00am)
- **Format:** Job rundown + performance pulse
- **Response style:** Conversational, no special acknowledge tracking

Sample:
```
morning. 4 jobs today. 

9am - sarah johnson, antioch - whirlpool fridge not cooling
       (parts on hand, model wrf555sdfz)
11am - mike chen, hermitage - washer wont drain
       (water pump in, model wtw5000)
1:30pm - patel family, mt juliet - dryer fire risk
         (CSIA cleaning + part swap)
3pm - jacob shore, mt juliet - dishwasher install
       (new unit delivered yesterday)

quick check: youre 2 jobs ahead of pace this week. nice.
```

### Tech-initiated requests
- **Freeform conversational.** Tech texts whatever. Ant uses Claude reasoning to figure out intent. No keyword commands required.
- **Question-confirm pattern.** When intent is ambiguous, Ant asks for confirmation BEFORE acting:
```
  Tech: "the patel one, push it"
  Ant: "you wanna push patel to tomorrow same time? want me to 
        give sarah a heads up?"
  Tech: "yeah"
  Ant: "done. pushed to tomorrow 2pm, sarah notified."
```
- **Authority boundary.** Self-management = full freedom. Cross-tech changes (reassigning, bumping someone else) → require Teddy approval.

### Owner override (Teddy's elevated permissions)
- Phone number lookup recognizes Teddy as owner
- Teddy's commands accepted via same SMS channel
- Examples:
  - "assign job 234 to billy tuesday 10am"
  - "override billy's day off friday, give him job 240"
  - "reschedule job 215 to next wednesday, tell the customer i made the call"
  - "push all of andre's tuesday jobs to wednesday, he's going to a funeral"
  - "don't broadcast anything in LA for the rest of the day"
- Ant executes, confirms back

### Tech preferences (the unlock — pain point eliminator)
**Three capture paths:**
1. **Explicit statement** — "no slidell after 2pm" → Ant asks hard/soft → stored
2. **Natural venting** — "ugh, mt juliet again" → Ant offers ("you've had 6 this month, want me to lighten up?") → stored if confirmed
3. **Pattern detection** — 3+ similar declines triggers proactive observation: "noticed you've passed on 4 slidell jobs, lighten up on those?" → stored if confirmed

**Preference types:**
- Geographic (zip, area, region)
- Time (day of week, time window)
- Both (compound, e.g., "no slidell after 2pm")

**Strength:**
- Hard = absolute respect, never broadcast
- Soft = respect by default, edge cases offered with context

**Storage:** `tech_preferences` table. `active` flag for tech toggling preferences off. `captured_via_text` preserves original message for context.

### Performance ledger (the marketplace signal)
**Rolling 30-day window per tech:**
- Offered (broadcasts received)
- Accepted (claimed)
- Called off (declined or last-minute reschedules)
- Helped out (took jobs to cover for another tech's sick day, etc.)
- Acceptance rate (computed)
- Team average acceptance rate (snapshotted for benchmark)

**Tech access:** Text "show me my numbers" → Ant returns the readout.
**Owner access:** Teddy texts "show me everyone's numbers" → all 6 techs side-by-side.

**Pattern detection runs nightly** to update ledger and check for preference triggers.

---

## ONBOARDING CONVERSATION (locked sample)

```
Ant: yo billy, new dispatcher in town. taking over the schedule 
     stuff so the office aint gotta chase you down anymore. 
     gonna ask a few quick things to get set up — sound good?

Billy: cool

Ant: aight. first — any standing days off i should know about? 
     like every other friday for kid stuff or whatever?

Billy: every sunday off and i try to be home by 4 on fridays

Ant: got it. sundays full off, fridays you're done by 4. 
     locked in. 
     
     work hours rest of the week — same as bootstrapped 8 to 4 
     mon-thurs? or you running different?

Billy: 8 to 5 actually, 4 is too early

Ant: nice. updating to 8-5 mon-thurs. 
     
     what time you want your daily run-down each morning? most 
     guys go 6 or 6:30, but pick whatever works.

Billy: 6 is fine

Ant: 6am it is. 
     
     last thing — anything you want me to know about you? like 
     family stuff, things to watch for, whatever. totally 
     optional, just helps me remember.

Billy: nah just keep me busy

Ant: got it, busy billy. you're set up. ill ping you tomorrow 
     6am with your monday lineup. text me anytime you need 
     something — day off, running late, whatever. im around.
```

**7 captures hit:**
1. Name confirmed (already in Xano)
2. Cluster confirmed (silent, already in Xano)
3. Standing days off (Sundays + Friday early-out)
4. Preferred hours (8-5 vs default 8-4)
5. Daily summary time (6am)
6. Personal context (declined — captured as "no personal context")
7. Communication style (short replies → Ant should mirror)

---

## VOICE & TONE GUIDE

**The dispatcher buddy.** Not a corporate dispatcher. Not a customer-facing chatbot. The casual coworker who knows the tech personally.

**Yes:**
- "yo billy"
- "aint gotta"
- "got it"
- "feel better"
- "you're 2 jobs ahead of pace this week. nice."

**No:**
- "Good morning, William."
- "Your schedule has been updated."
- "Please confirm your acknowledgment."

**Mirroring:** Tech texts in fragments → Ant matches. Tech writes full sentences → Ant matches. This is automatic, learned from the conversation.

**Casing:** Ant uses lowercase by default. Capitalizes proper nouns (customer names, places) but otherwise keeps things informal.

**Humor:** Allowed when it fits. Not forced. Banter when the tech invites it, otherwise stays focused.

---

## BUILD ORDER

### Phase 0 — Schema (1 hour)
Add new fields/tables to Xano:
1. `technician_decision_report` — add scheduling_decision fields
2. `jobs` — add current_scheduling_decision + scheduling_status
3. `technicians` — add daily_summary_time, preferred_hours_start/end, personal_context, onboarding_completed_at
4. Create `scheduling_decision_history`
5. Create `scheduling_queue`
6. Create `tech_preferences`
7. Create `tech_performance_ledger`
8. Create `broadcast_attempt`

Push via xano CLI. Verify schemas match expectations.

### Phase 1 — Tech identification + onboarding endpoint (2 hours)
1. **Inbound SMS webhook** at Twilio → Netlify function → Xano endpoint `tech_sms_inbound`
2. **Phone lookup** in `tech_sms_inbound`: matches sender phone to `technicians` table
3. **Onboarding state machine:**
   - First text from a tech with `onboarding_completed_at = null` → triggers onboarding flow
   - Sequential capture of 7 onboarding items
   - Stores responses in `technicians` table + `tech_preferences` for any preferences mentioned
   - Marks `onboarding_completed_at` when complete
4. **System prompt for onboarding mode** — small focused prompt, captures the casual voice

### Phase 2 — Daily summary cron (1 hour)
1. Xano scheduled task runs every 15 minutes
2. For each tech where `daily_summary_time` matches current time window:
   - Pull today's jobs assigned to that tech
   - Pull performance pulse (jobs ahead/behind pace this week)
   - Format the morning text
   - Send via Twilio
3. Mark daily summary sent in a small log table

### Phase 3 — TDR scheduling decision processor (3 hours)
1. **Webhook on TDR update:** When `technician_decision_report` is created/updated, trigger processor
2. **Processor logic:**
   - Read new `scheduling_decision`
   - Compare to previous (from `scheduling_decision_history`)
   - If changed: insert row into `scheduling_decision_history`
   - Update `jobs.current_scheduling_decision` and `jobs.scheduling_status`
   - Insert appropriate action into `scheduling_queue`
3. **Queue worker:** Xano scheduled task runs every minute, pulls pending queue items, dispatches to action handlers:
   - `broadcast` → fire SMS to qualified techs, create `broadcast_attempt` record
   - `propose` → must_time proposal flow
   - `wait` → no action, just acknowledge
   - `notify` → send notification SMS
   - `escalate` → text Teddy

### Phase 4 — Broadcast logic (2 hours)
1. **Broadcast trigger:** Queue worker pulls a `broadcast` action
2. **Filter qualified techs:** cluster + availability + capacity + hard preferences
3. **Create `broadcast_attempt` record** with `expires_at = now + 30 minutes`
4. **Send SMS to all qualified techs** in parallel
5. **Atomic claim handler:** When tech texts YES (or however we phrase it), Ant locks the broadcast in a single transaction:
```
   UPDATE broadcast_attempt 
   SET claimed_by_tech_id = X, claimed_at = NOW(), status = 'claimed'
   WHERE id = Y AND status = 'open'
```
   First tech wins by virtue of the WHERE clause. Other techs get "sorry, billy grabbed this 15 sec ago."
6. **30-minute expiry handler:** Scheduled task checks expired open broadcasts → escalates to Teddy

### Phase 5 — Conversational reasoning (3 hours)
1. **System prompt for daily mode** — main Ant Tech Scheduler personality, knows all the rules
2. **Inbound SMS reasoning:** When tech texts something, Claude API call with:
   - System prompt (full Ant Tech Scheduler context)
   - User memory (this tech's preferences, performance ledger, recent context)
   - Conversation history (last N messages)
   - Available actions (toolset Ant can call)
3. **Tool calls Ant can invoke:**
   - `update_availability(tech_id, date, available)` — day off / sick day
   - `confirm_job_assignment(tech_id, job_id)` — accepts a proposal
   - `reschedule_job(job_id, new_time, reason)` — pushes a job
   - `update_preference(tech_id, ...)` — captures stated preferences
   - `escalate_to_owner(message)` — when can't handle
   - `send_to_customer(customer_id, message)` — for sick day reroute conversations
4. **Question-confirm pattern:** Ambiguous intent → Ant asks for confirmation, awaits reply, THEN tool-calls

### Phase 6 — Sick day cascade (1.5 hours)
1. Tech texts "sick today" → Ant tool-calls `update_availability` for today
2. Ant queries jobs assigned to tech today
3. For each job: 
   - Try cluster reroute via `find_alternate_tech(cluster, time, capacity)`
   - If alternate found → `reassign_job(job_id, new_tech_id)` (silent to customer)
   - If no alternate → text customer with 2-option script, await reply
4. Once all jobs handled → confirm back to original tech

### Phase 7 — Performance ledger + preference patterns (1.5 hours)
1. **Nightly task** computes rolling 30-day ledger for each tech
2. **Pattern detection:** Count similar declines (zip/area/time pattern) in last 14 days
3. **If 3+ matches:** Ant proactively offers preference observation next time tech is online
4. **Tech queries:** "show me my numbers" → Ant returns ledger readout
5. **Owner queries:** Teddy texts "show me everyone" → side-by-side readout

### Phase 8 — Owner override mode (1 hour)
1. Phone lookup recognizes Teddy → elevated permission flag in conversation context
2. System prompt has Teddy-specific rules: can override tech preferences, reassign across techs, cancel jobs, etc.
3. All other reasoning identical, just with elevated authority

---

## TIME ESTIMATES — ALL PHASES

| Phase | Time | Cumulative |
|-------|------|------------|
| 0. Schema | 1 hr | 1 hr |
| 1. Tech ID + onboarding | 2 hr | 3 hr |
| 2. Daily summary cron | 1 hr | 4 hr |
| 3. TDR processor | 3 hr | 7 hr |
| 4. Broadcast logic | 2 hr | 9 hr |
| 5. Conversational reasoning | 3 hr | 12 hr |
| 6. Sick day cascade | 1.5 hr | 13.5 hr |
| 7. Performance + patterns | 1.5 hr | 15 hr |
| 8. Owner override | 1 hr | 16 hr |

**Total: ~16 focused hours.** Spread across 3-4 build sessions.

---

## TONIGHT'S TARGET (Sunday 5/3, 2:30pm-11pm)

**8.5 hours.** Realistic to ship Phases 0-2. Stretch goal Phases 0-3.

**Phase 0 (1 hr):** Get the schema in. This is the foundation everything else builds on.

**Phase 1 (2 hr):** Tech identification + onboarding flow. By end of phase 1, Billy can text the new line and Ant will onboard him correctly.

**Phase 2 (1 hr):** Daily summary. By end of phase 2, Ant texts each tech every morning at their preferred time with their day's jobs.

**Phase 3 stretch (3 hr):** TDR processor. By end of phase 3, scheduling decisions on TDRs flow through to the queue automatically.

**Total to Phase 2: 4 hours.** Comfortable in 8.5-hour window with buffer for testing.

**Total to Phase 3: 7 hours.** Tight in 8.5-hour window. Possible if no major debugging.

After tonight: Phases 4-8 across the next 2-3 sessions.

---

## RISKS & MITIGATIONS

### Risk 1 — Twilio TCR not yet approved
SMS sending at scale blocked until TCR approves campaign CM2e229065885a4147c. **Mitigation:** Test with single approved sender (Teddy's phone) initially. When TCR approves, expand to all techs. Functionally everything still works — just narrower test pool.

### Risk 2 — Existing endpoints get pulled with workspace push
Some endpoints have hardcoded Twilio creds + Swagger tokens. Pushing workspace can expose these. **Mitigation:** Continue gitignoring `xano-workspace/` folder. Rotate credentials before any other dev pulls workspace.

### Risk 3 — Ant misinterprets tech intent
Conversational reasoning is hard. **Mitigation:** Question-confirm pattern is the safety net. Tech approves before action fires. Wrong inference → tech says "no", Ant adjusts.

### Risk 4 — Broadcast race conditions
Two techs claim the same broadcast simultaneously. **Mitigation:** Atomic UPDATE with WHERE status='open' clause. First UPDATE wins, second sees no rows updated, gets the "sorry, taken" response.

### Risk 5 — TDR field accidentally cleared
TDR update path could blank out scheduling_decision unintentionally. **Mitigation:** scheduling_decision_history audit trail catches it. Plus jobs.current_scheduling_decision is a separate write so won't be silently overwritten.

---

## SUCCESS METRICS (90 days post-launch)

How we know it's working:

1. **Tech satisfaction signal:** % of techs who say preferences captured by Ant matter to their day. Target: 80%+.
2. **Friction reduction:** Hours/week Teddy spends on tech schedule complaints. Target: cut 50%.
3. **Schedule fill rate:** % of broadcasts claimed within 30 min. Target: 70%+.
4. **Sick day reroute rate:** % of sick day jobs rerouted silently (no customer reschedule needed). Target: 50%+.
5. **B2B platform readiness signal:** Could a different shop's 6-tech crew be onboarded in <1 day?

---

🐜⚡ LONG LIVE ANT.

The thing that makes this work is not the code. It's the personality, the patience, the listening. The technology is in service of the relationship. Build accordingly.

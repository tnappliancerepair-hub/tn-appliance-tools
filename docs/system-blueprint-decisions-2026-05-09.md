# Architectural Decisions Locked — 2026-05-09

**Source session:** 2026-05-09 chat session.
**Companion document:** `docs/system-blueprint-v1.md` (full architecture + running status).
**Status:** Locked unless explicitly revisited. Layer-1 commitments — durable across sessions.

---

## Decision 1 — Ant Tech Scheduler architecture session

**Status:** **DEFERRED.** To be addressed in its own dedicated session.

**Rationale:** Teddy stated this is the most important tool in development with multiple uses. It deserves full architectural attention, not a sidebar within a verification pass.

**Owner:** Teddy.

**Next action:** Schedule the dedicated architecture session. A separate blueprint document (`docs/ant-tech-scheduler-blueprint-v1.md` or equivalent) will be produced from that session.

**Linked context:** Tech Scheduler v2 Phases 0-8 already shipped to backend (see `docs/ant-tech-scheduler-design-v2.md` and §13 of v1 blueprint). The dedicated session will architect the next layer — likely the customer-side surfaces, multi-tenant primitives, and the Tech Scheduler v2 → Tech Scheduler v3 evolution.

---

## Decision 2 — Voice-only customer transparency: "Ant Status Update" agent

**Status:** **PARTIALLY DECIDED — requires Teddy's manual Vapi dashboard inventory before the existing-vs-new branch resolves.**

**Phase 1 verification finding:** The repo cannot determine whether any of the 8 unverified Vapi agents (Reminder, Missed Call, Auth Update, Parts ETA, Running Late, Reschedule, After Hours, Warranty Company Inbound) covers the "general-purpose customer status update via outbound voice call" use case. **Their configs (system prompts, agent IDs, tool wirings) live in the Vapi dashboard, not in the repo.** See "Phase 1 inventory results" at the end of this doc for what the repo DID confirm.

**Decision logic — to apply once inventory is complete:**

- **IF** inventory finds an existing agent that already accepts variable context (job_id, trigger_type, message_template) and delivers it as a warm short voice call → **repurpose it.** Document its agent ID and wire the new outbound triggers to its existing pattern.
- **IF NOT** → **build new "Ant Status Update" agent.** Spec:
  - **Inputs:** `job_id`, `trigger_type` (e.g., `teddy_started_review` / `parts_ordered` / `parts_shipped` / `parts_delivered_diy` / `parts_delivered_install` / etc.), `message_template` (the natural-language script the agent reads).
  - **Behavior:** Warm, short voice call (~30-60 seconds). Reads the message template. Ends with the callback number `615-280-2949` (post-Vapi port; today's RingCentral until ported). Leaves voicemail if no answer (handled by Vapi's built-in voicemail detection).
  - **Stack:** Same as existing — Claude Sonnet + Heisenberg (11Labs) voice + Nova 2 Phonecall.
  - **Wiring:** New Xano endpoint `trigger_vapi_status_update_POST.xs` mirrors the pattern of the existing `trigger_vapi_warranty_call_POST.xs` (verified file in repo): POST `https://api.vapi.ai/call` with `{assistantId: $env.VAPI_STATUS_ASSISTANT_ID, phoneNumberId: VAPI_PHONE_ID_TN|LA based on customer.state, customer: {number, name}, assistantOverrides: {variableValues: {...the trigger context}}}`.

**When to fire:** Whenever an SMS trigger fires AND `customer.consent_method == "voice_only_button_click"` (or equivalent voice-only flag). Same touchpoints as the SMS workstream, different channel.

**Owner:** Teddy (manual Vapi dashboard inventory) → Claude Code (build, after inventory resolves).

**Next action — Teddy:** 10-minute Vapi dashboard pass. For each of the 8 unverified agents, capture: agent ID, one-line purpose (what it does today), trigger pattern (inbound/outbound), and a yes/no on "does this accept variable context for general-purpose status updates?" Paste the inventory back into a follow-up session.

---

## Decision 3 — "Teddy started review" SMS trigger source

**Status:** **DECIDED.**

**Rationale:** No new button. The act of opening the job for review IS the trigger. Cleaner UX, no extra step for Teddy to remember.

**Implementation:**

- Auto-fire on the existing `qc_cockpit_load` endpoint (the single-call hydrate Teddy hits when he opens `teddy-tdr-tool.html?job_id=…` from the new-job SMS).
- Idempotent: add `teddy_review_started_at` timestamp column on the `jobs` table.
- On every `qc_cockpit_load` call:
  - **IF** `jobs.teddy_review_started_at IS NULL` → set timestamp to `now` AND fire the customer SMS in the same call. Body: `"Hi {first_name}, Teddy is now reviewing your {appliance}. He'll have your diagnosis ready shortly."` (refine copy in the build session.)
  - **IF NOT NULL** → do nothing. No re-fire on subsequent loads. No duplicate SMS if Teddy reopens the cockpit.
- Schema change: `jobs.teddy_review_started_at` — nullable `timestamp` column. Default null.
- Caveat: ensure the column-add is via Xano admin UI (not CLI ALTER COLUMN — see XanoScript footgun #13 in v1 blueprint Section 16). Verify with a test job before flipping live.

**Owner:** Build session.

---

## Decision 4 — "Parts delivered" event source

**Status:** **DECIDED.**

**Rationale:** Customer self-report via inbound SMS keyword. Simple, no carrier API integration required initially. Doubles as a customer engagement check — silence indicates potential shipment issue.

**Implementation:**

1. **Inbound SMS keyword recognition.** In the existing inbound SMS handler (`netlify/functions/tech-sms-inbound.js` and/or `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` — confirm exact path during build), add keyword matching for: `"DELIVERED"`, `"delivered"`, `"got it"`, `"arrived"`, `"received"`. Case-insensitive. Whole-word or substring — pick during build (substring is more forgiving but risks false positives like "I've not received it yet").

2. **On match:**
   - Look up the customer's most recent open job in shipped state (likely heuristic: `customer_id == sender's customer` AND `parts_shipped_at IS NOT NULL` AND `parts_delivered_at IS NULL` AND `current_status` indicates active job — confirm exact filter during build).
   - Set `jobs.parts_delivered_at = now`.
   - Fire the next SMS in the chain based on the `tdr_failure.selected_option` path:
     - `diy_oem` / `diy_amazon` → DIY post-delivery message (offer the $40 Premium Video Call upgrade per Decision 7 of v1 §15).
     - `install_oem` / `install_amazon` → Install "sending to techs now" message (triggers Tech Scheduler v2 broadcast to the qualified cluster).

3. **Backup nudge:** Daily check (cron). If `parts_shipped_at > 3 days ago AND parts_delivered_at IS NULL` → fire `"Just checking in — did your part arrive yet? Reply YES when it does."` Limit to one nudge per shipment (track via a flag like `delivery_nudge_sent_at`).

4. **Schema additions:**
   - `jobs.parts_shipped_at` — nullable timestamp (verify if exists; `part_order` table has `tracking_number` + `order_status` enum, but `parts_shipped_at` on jobs may be net-new).
   - `jobs.parts_delivered_at` — nullable timestamp.
   - `jobs.delivery_nudge_sent_at` — nullable timestamp.

**Owner:** Build session.

---

## Decision 5 — No-fix-needed customer messaging

**Status:** **DECIDED with one verification action.**

**Rationale:** The $50 = "honest assessment, no refund" agreement is set BEFORE payment. No special apology or explanation needed in the post-diagnosis journey. The standard diagnosis SMS template handles this case.

**Implementation:**

- The existing "Teddy completed review" SMS template (sent via `send_qc_diagnosis_to_customer_POST.xs`) handles the `skip` branch (no-fix-needed) with the same warm tone. Suggested phrasing variant:
  - **Standard fix-needed case:** *"Your diagnosis is ready, here are your options: {tdr_link}"*
  - **No-fix-needed case:** *"Teddy reviewed your {appliance}. The honest answer is {reason}. Glad we could save you a visit. {tdr_link if any context to view}"*
- No new trigger, no separate template. Branch on `tdr_failure.selected_option == "skip"` (or equivalent — confirm during build) at SMS-composition time.
- Open verification item — DO BEFORE BUILD: confirm the homepage Quick Check pitch + Stripe checkout copy + intake waiver text (Jotform `260495320372050`, version `v1.0_2026-04-20`) clearly communicate "no refund — you're paying for an honest assessment" UP FRONT. Read each surface: `index.html` (service strip + chat consent gate copy), Stripe Checkout description, Jotform waiver text. If wording is unambiguous: leave alone. If not: queue a small UX fix to add "Honest assessment service. No refunds — you're paying Teddy to look, not to find a problem." or equivalent at each surface.

**Owner:** Build session — verification first, copy fix only if needed.

---

## Decision 6 — SMS_ENABLED master kill-switch

**Status:** **DECIDED — BUILD.**

**Phase 2 verification finding:** `SMS_ENABLED` does NOT exist anywhere. No env var. No code references except prior reconstruction docs that flagged it as missing. Production env confirmed empty (`netlify env:get SMS_ENABLED --context production` returned "No value set"). No global SMS gating constant of any other name exists either.

**Rationale:** Real kill-switch under Teddy's control. Useful during the TCR review window for bouncing test messages without spending real Twilio credits or risking 10DLC infraction patterns. Useful long-term for any future audit, compliance, or test scenarios. ~30-60 minutes of work given the scatter; gives infinite future optionality.

**Implementation:**

1. **Add Xano env variable** `SMS_ENABLED` (boolean-as-text, since Xano envs are strings). Default value: `"false"` until TCR clears, then `"true"`. Document the contract: `"true"` = send live; anything else (`"false"`, empty, missing) = bounce.

2. **Wrap the canonical `send_sms_POST.xs` first.** That covers 5 indirect callers automatically:
   - `xano-workspace/api/cash_tdr/send_qc_diagnosis_to_customer_POST.xs`
   - `xano-workspace/api/cash_tdr/stripe_checkout_session_completed_POST.xs`
   - `xano-workspace/api/intake/create_job_POST.xs`
   - `xano-workspace/api/intake/create_tdr_POST.xs`
   - `xano-workspace/api/intake/send_payment_link_POST.xs`
   These all hit `send_sms` via internal `api.request` to `/api:3e_TffpA/send_sms` and inherit the gate transparently.

3. **Wrap each direct Twilio call site individually.** 15 files call Twilio's `api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` directly. Each needs a precondition check on `$env.SMS_ENABLED`:
   - `xano-workspace/api/intake/feedback_reply_webhook_POST.xs` (3 call sites — lines 70, 99, 146)
   - `xano-workspace/api/intake/get_tech_for_zip_POST.xs` (3 call sites — lines 37, 72, 183)
   - `xano-workspace/api/intake/handle_negative_followup_POST.xs` (2 call sites — lines 76, 92)
   - `xano-workspace/api/intake/hcp_job_webhook_POST.xs` (1 call site — line 791)
   - `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` (1 call site — line 134)
   - `xano-workspace/api/intake/send_feedback_sms_POST.xs` (1 call site — line 40)
   - `xano-workspace/api/intake/send_waiver_sms_POST.xs` (1 call site — line 63)
   - `xano-workspace/api/intake/start_tech_assist_session_POST.xs` (1 call site — line 326)
   - `xano-workspace/api/intake/tech_assist_chat_POST.xs` (1 call site — line 629)
   - `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` (call sites in TwiML response composition — verify during build)
   - `xano-workspace/task/compute_tech_assist_escalation.xs` (cron — verify call sites)
   - `xano-workspace/task/daily_tech_summary.xs` (cron — verify call sites)
   - `xano-workspace/task/process_feedback_queue.xs` (cron — verify call sites)
   - `xano-workspace/task/scheduling_queue_worker.xs` (cron — verify call sites)
   - `netlify/functions/send-teddy-sms.js` (Netlify side — gate via `process.env.SMS_ENABLED` set in Netlify env, separate from Xano env)

4. **Gating behavior — uniform contract:**
   - When `$env.SMS_ENABLED != "true"`: skip the Twilio API call.
   - LOG to `event_log`: `{action: "sms_gated_skip", recipient: $to, body: $body|substr:0:200, reason: "SMS_ENABLED is " ~ ($env.SMS_ENABLED ?? "unset"), call_site: "<file>:<line>"}`.
   - Return success-shaped response so callers don't error: `{success: true, gated: true, gated_reason: "SMS_ENABLED disabled"}`.
   - Never throw, never break the calling flow.
   - **Inbound SMS untouched.** TwiML response composition still goes through normally. Customers can text in, our outbound responses bounce.

5. **Refactor opportunity (NOT v1 scope, document for later):** Migrate every direct Twilio caller to route through `send_sms_POST.xs` instead. Single gate point, no per-site preconditions. ~2-3 hours of refactor; consolidates the SMS surface. Out of scope for the kill-switch build; bundle with a future "SMS infrastructure consolidation" pass.

**Owner:** Build session. Decision 6 ships in the same workstream as the customer-transparency SMS triggers since both touch `send_sms` plumbing.

---

## Phase 1 inventory results — what the repo DID confirm

For Teddy's reference when he does the manual Vapi dashboard pass:

**Vapi files in repo:**
- `xano-workspace/api/intake/trigger_vapi_inbound_test_POST.xs` — sends an inbound test call. Uses `$env.VAPI_INBOUND_ASSISTANT_ID` + `$env.VAPI_PHONE_ID_TN`. Auth via `$env.VAPI_PRIVATE_KEY` Bearer token.
- `xano-workspace/api/jobs/trigger_vapi_warranty_call_POST.xs` — outbound warranty fallback call. Uses `$env.VAPI_ASSISTANT_ID` (warranty agent). Selects phone `VAPI_PHONE_ID_TN` or `VAPI_PHONE_ID_LA` based on `customer.state`. Passes `assistantOverrides.variableValues` with `{customer_name, job_id, warranty_provider, appliance_type, service_address}`. Updates `jobs.vapi_call_id`, `vapi_call_status="initiated"`, `vapi_called_at`, `triage_status="vapi_called"` after a successful POST.
- `xano-workspace/api/jobs/vapi_warranty_webhook_POST.xs` — receives the post-call webhook. Captures `endedReason`, `transcript`, `recordingUrl`, `duration`, and `analysis.structuredData` (appliance_brand, model, age, problem_description, scheduling_preference, address_confirmed, callback_number, photos_agreed, call_outcome, intake_completed, call_summary). Updates the matching job record by `vapi_call_id`.
- `xano-workspace/task/vapi_warranty_followup_scheduler.xs` — every 10-minute cron. Queries jobs in `warranty_pending`/`warranty_sent` state, age >2h, no prior Vapi contact, no waiver signed. Calls `trigger_vapi_warranty_call` for each.

**Vapi env vars (Xano, inferred from code references):**
- `$env.VAPI_PRIVATE_KEY` — API auth Bearer token.
- `$env.VAPI_ASSISTANT_ID` — warranty fallback agent ID.
- `$env.VAPI_INBOUND_ASSISTANT_ID` — inbound test agent ID.
- `$env.VAPI_PHONE_ID_TN` — TN phone number ID (verify against `+16292607111`).
- `$env.VAPI_PHONE_ID_LA` — LA phone number ID (verify against `+16292477111`).

**Vapi env vars in Netlify production:** none (verified via `netlify env:list --plain --context production | grep -i vapi`). Vapi calls go via Xano, not Netlify functions.

**Known agent identities (from the v1 blueprint, user-supplied):**
- 3 confirmed live: Ant Inbound (`7cc98b0c…`), Ant Warranty Fallback (`0abe54ec…`), Ant Parts Follow-Up (`b71260b4…`).
- 8 unverified: Reminder, Missed Call, Auth Update, Parts ETA, Running Late, Reschedule, After Hours, Warranty Company Inbound.

**Architectural pattern for any new Vapi agent invocation:** mirror `trigger_vapi_warranty_call_POST.xs`. POST `https://api.vapi.ai/call` with `{assistantId, phoneNumberId, customer: {number, name}, assistantOverrides: {variableValues: {...}}}`. The Ant Status Update endpoint will look nearly identical, just with a different `assistantId` env var and different `variableValues` keys.

**Bottom line:** the repo confirms the architectural pattern but cannot enumerate the 8 unverified agents. Teddy's manual dashboard inventory unblocks Decision 2.

---

## Phase 2 inventory results — outbound SMS path scope

Reference for the SMS_ENABLED kill-switch build (Decision 6).

**16 files call Twilio directly.** All use `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` with Basic auth (`SID:AUTH_TOKEN` base64). Each needs an `SMS_ENABLED` precondition gate.

**5 files route through `send_sms_POST.xs`** via internal `api.request`. Wrapping `send_sms_POST.xs` covers all five automatically.

**Total wrap points:** 16 (direct callers) + 1 (the `send_sms` wrapper itself) = 17. Plus the Netlify-side `send-teddy-sms.js` gated via `process.env.SMS_ENABLED`.

Detailed file-and-line inventory in Decision 6 above. The full call-site inventory is committed alongside this doc — read Decision 6 directly for the build scope.

---

## Anything that surfaced during verification needing Teddy's attention

1. **No `SMS_ENABLED` of any name exists.** Phase 2 confirmed. Build is required, not "wire up an existing flag." Decision 6 reflects this.

2. **The 8 unverified Vapi agents are dashboard-only.** Their configs are not in the repo. Teddy needs the 10-minute manual inventory pass before Decision 2 can resolve. Suggested template per agent: `agent_name | agent_id | inbound|outbound | one-line purpose | accepts variable context Y/N`.

3. **`SCHEDULING_QUEUE_ENABLED` is the canonical "Tech Scheduler v2 enabled" gate.** When TCR clears AND Teddy decides to flip it, he's flipping ~5 customer-facing SMS-fanout paths simultaneously. SMS_ENABLED kill-switch should ship BEFORE flipping `SCHEDULING_QUEUE_ENABLED`, so he has a master rollback if any broadcast misfires during the first live day.

4. **`tech_sms_inbound_POST.xs` lives at `xano-workspace/api/scheduling/`, not `intake/`.** Add to mental map. The earlier Tech Scheduler design doc references the intake-side path; the production path is scheduling-side. Verified via grep.

5. **`feedback_reply_webhook_POST.xs` has 3 distinct outbound Twilio call sites** (one per branch: positive / negative / unknown classification). The kill-switch wrap needs all three. Same pattern in `get_tech_for_zip_POST.xs` (3 sites) and `handle_negative_followup_POST.xs` (2 sites). Don't miss the multi-site files.

6. **The "Teddy started review" trigger (Decision 3) and "parts delivered" trigger (Decision 4) both add new schema columns.** Verify Xano admin UI flow before relying on `xano workspace push --include` for the column adds (XanoScript footgun #13 in v1 blueprint).

---

## End of decisions doc

**File:** `docs/system-blueprint-decisions-2026-05-09.md`
**Status of decisions:**
- 1: DEFERRED (own session)
- 2: PARTIALLY DECIDED (awaits Teddy's manual Vapi inventory)
- 3: DECIDED — ready to build
- 4: DECIDED — ready to build
- 5: DECIDED — ready to build (verification action first)
- 6: DECIDED — ready to build (Phase 2 confirmed `SMS_ENABLED` doesn't exist)

**Next session:** Execute Decisions 3, 4, 5, 6 as the customer-transparency SMS workstream. Decision 2 either resolves to "repurpose existing agent" or "build new" once Teddy's Vapi dashboard inventory lands.

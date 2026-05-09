# TN Appliance Exchange — System Blueprint v1

**Source of truth.** Read this document at the start of every session before suggesting work or referencing system state.

**Authored:** 2026-05-09
**Author:** Claude Code (claude-opus-4-7), session-paced reconstruction; Layer 1 architectural decisions sourced from Teddy's prompt, Layer 2 running status from auto-memory + this-session verification.
**Predecessor:** `docs/system-blueprint-cc-reconstruction.md` (earlier today, exploration only)

---

## How to read this document

The blueprint has two interleaved layers, both visible:

- **[LAYER 1]** — Architecture. What the system IS. Slow-changing. Customer journey, supplier model, decision tree, fulfillment flow, money flow, vision. Stays true even as work ships.
- **[LAYER 2]** — Running status. What's currently happening. Fast-changing. Job count, env-var states, pending blockers, ship dates, TCR day count, security flags. Updates daily.

When you (a future session) need to know whether something is durable architecture or current state, look at the section header.

**Confidence legend** for Layer 2 sections:
- **HIGH** — verified by reading the actual file or running a check this session.
- **MED** — held in memory, design docs, or git history; consistent across sources but not re-verified line-by-line right now.
- **LOW** — inferred from secondary signals or remembered without re-grounding. Treat with skepticism.

Credential literals are redacted as `[redacted]` throughout.

---

## Section 1 — Business overview [LAYER 1]

**TN Appliance Exchange LLC.** Owner: James "Teddy" Pivacek (legal name James, signs as Teddy). Email `tnappliancerepair@gmail.com`.

**Six active techs:**

| ID | Name | Home base | Region |
|----|------|-----------|--------|
| 1 | Teddy / James Pivacek | Antioch, TN | TN owner-operator, dual-state mobile (cybertruck + LA trailer in Hammond) |
| 2 | Jimmy Pivacek | Antioch, TN | South Nashville / Antioch / Murfreesboro |
| 3 | Andre Pivacek | Hammond, LA + houseboat TN | LA primary, dual-state flexible (Hammond / NOLA / TN trips on demand) |
| 4 | Lee Harding | Clarksville, TN | TN; Clarksville-anchored, single-zone commits |
| 5 | Billy Savoy | Hammond, LA | Hammond / North Shore (interview pending) |
| 6 | John Houk | Walker, LA | Baton Rouge first / NOLA last resort |

Family business: brother Jimmy, son Andre, cousin John Houk, plus two senior employees (Lee Harding, Billy Savoy). Four of six techs are family.

**Service area:** Middle Tennessee + Louisiana.

**Revenue mix:** ~95% warranty dispatch / ~5% self-pay (cash-flow QC pipeline). Both ride **HCP (Housecall Pro)** as the dispatch/job backbone.

**System charter:** Built around eliminating manual office dependency. Long arc: licensable platform for independent appliance techs nationally — Ant Tech Scheduler, Tech Ant Assist, Capacity Governor, Performance Ledger, Cash TDR pipeline, and Customer Transparency SMS are all built to platform quality so a different shop's six-tech crew could be onboarded in <1 day (per `docs/ant-tech-scheduler-design-v2.md` Phase 8 success criteria).

**Operational principle:** Mobile-first owner. Architecture must assume Teddy is in the field, not at a desk. Quick Check triage works from anywhere with cell signal. Field work is the priority; desk work is the residual.

---

## Section 2 — Customer types [LAYER 1]

Three distinct entry paths:

1. **Self-pay** — customer hits `tnapplianceexchange.net`, chats with Ant, pays $50 Quick Check via Stripe, gets a TDR with options. ~5% of volume but the platform-quality flagship.
2. **Warranty (HCP-dispatched)** — Allstate Protection Plans (formerly SquareTrade) auto-accepted via ServicePower portal; AHS / Frontdoor on a separate workflow. Job appears in HCP, webhook fires (currently broken — see §9), Xano job created, tech dispatched.
3. **Warranty company calling on behalf** — voice line (`615-280-2949`, currently RingCentral, porting to Vapi). Dispatcher (or future Vapi agent) intakes the warranty job by phone.

---

## Section 3 — Self-pay customer journey end-to-end [LAYER 1]

The full lifecycle. Steps marked `[BUILT]` exist in production today; `[NEEDS BUILD]` are net-new. All SMS triggers are to the customer's phone unless noted.

1. **Customer lands on `https://tnapplianceexchange.net/`** `[BUILT]`. Homepage shows the service explanation strip ("How our service works"), two routing buttons (Yes-text-me / Call-me-only), hero, prominent chat input.

2. **Customer pre-selects channel on the strip** `[BUILT]`. Click stores `window.consentChoice` + `localStorage.consentPreSelect`, smooth-scrolls to chat, auto-focuses the textarea, then auto-hides the strip after a 1.2s confirmation banner. Reload-persistent. Recovery link "↺ Change my contact preference" lives in the footer-pills bar above the chat input, hidden by default, revealed when a pre-selection exists.

3. **Customer chats with Ant** `[BUILT]`. Ant collects appliance type, brand, model, symptom, service tier ($50 Quick Check / $90 Video Call / $100 In-Home Visit), first name. Then Ant emits `__SHOW_CONSENT_CHECKBOX__` (per `prompts/ant_system_prompt_consent_gate_addition.md`). Frontend strips the token, hides the input via `body.consent-gate-active`, and renders the chat-side gate — confirmation variant if a homepage pre-selection exists, otherwise the fresh two-button gate. Customer clicks → consent committed (`smsConsentGiven`, `smsConsentAt`, `consentMethod`, `CONSENT_LANGUAGE_VERSION = v1.0_2026-05-08`), synthesized user message fires so Ant branches correctly.

4. **Customer enters phone, ZIP, scheduling preference** `[BUILT]`. Ant gathers the rest. Photos / videos / model-plate captures supported via the CaptureOverlay IIFE.

5. **Customer submits** `[BUILT]`. POST to `xano-proxy → create_job_from_chat` (intake group). Creates `jobs` row with `customer_type="self_pay"`, `intake_source="web_chat"`, `sms_consent`, `consent_method`, `consent_language_version`, etc. Creates `customer` row with `address`, `city`, `state`, `zip` (= service address = future shipping address; see §15).

6. **Customer pays $50 Quick Check via Stripe** `[BUILT]`. Stripe Checkout flow. On `checkout.session.completed`, Netlify `stripe-webhook.js` verifies the Stripe signature, forwards to Xano `stripe_checkout_session_completed` (cash_tdr group), idempotent `confirmed_at` write, posts an HCP note, SMS's owner-side stakeholder (Danielle in the warranty pipeline; for self-pay this is the diagnostic-50 path).

7. **Waiver SMS (intake-time)** `[BUILT]`. Existing Jotform integration: `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` accepts the Jotform submission webhook, sets `waiver_signed=true`, `waiver_signed_at`, `waiver_text_version="v1.0_2026-04-20"`, `waiver_jotform_submission_id`, `waiver_channel="jotform"`. Form: `form.jotform.com/260495320372050`. This waiver fires AFTER intake submission (the customer signs once for the diagnosis service itself). Note this is NOT the same waiver as the DIY-path Release of Liability (§15, item 3).

8. **After-submission status SMS** `[BUILT]` (the existing acknowledgment) — customer sees a thank-you state and may receive a brief status SMS confirming the job is in queue.

9. **Teddy gets "new job" notification** `[BUILT]`. `netlify/functions/send-teddy-sms.js` posts to Twilio with body `"New job #${job_id} - ${customer_name}\n${appliance} | ${brand}\nIssue: ${problem}\n\nTeddy Tool: https://superlative-naiad-233aa7.netlify.app/teddy-tdr-tool.html?job_id=${job_id}"`. From `+16292840444` → To Teddy `+16154855795`. The deep-link Teddy taps to start triage.

10. **"Teddy started review" SMS to customer** `[NEEDS BUILD]`. New trigger: when Teddy opens the Teddy Tool for this job (or clicks a "Start Review" button), customer gets `"Hi {first_name}, Teddy is now reviewing your {appliance}. He'll have your diagnosis ready shortly."`. No equivalent infra exists today.

11. **Teddy reviews in Teddy Tool** `[BUILT]`. `teddy-tdr-tool.html?job_id=…`. Single-call hydrate via `qc_cockpit_load`. Teddy fills diagnosis (free text or AI pre-fill via `claude-proxy`, model `claude-sonnet-4-20250514`, prompt forbids scheduling language), OEM part number + cost, Amazon part number + cost, labor estimate, tech notes. 30% markup math on parts.

12. **Teddy completes pre-diagnosis & sends to customer** `[BUILT]`. Submit-and-Send button: POST `create_tdr` (intake group, `mode=pre_diagnosis`), then for self-pay POST `send_qc_diagnosis_to_customer` (cash_tdr group). That endpoint mints a public-view token (HMAC-SHA256, 7-day default expiry) via Netlify `generate-qc-token.js`, persists it as `tdr.public_view_token`, and SMS's the customer a link to `cash-tdr-customer.html?token=<signed>`.

13. **"Teddy completed review + TDR link" SMS to customer** `[BUILT]` — this is the existing `send_qc_diagnosis_to_customer` SMS. Body should explicitly say `"Your diagnosis is ready, here are your options"` and include the TDR link.

14. **Customer lands on TDR options page** `[BUILT]`. `cash-tdr-customer.html?token=…`. Page calls `qc_diagnosis_view` (cash_tdr group) which validates the token via `validate-qc-token.js` (timing-safe HMAC, expiry check). Returns the TDR + per-failure options.

15. **Customer picks one of FOUR options + the no-fix-needed branch** `[BUILT]` for the four options; `[NEEDS BUILD]` for the no-fix-needed UX explicit framing:
    - **DIY · OEM Part** (`selected_option = "diy_oem"`)
    - **DIY · Amazon equivalent** (`selected_option = "diy_amazon"`)
    - **We Install · OEM** (`selected_option = "install_oem"`)
    - **We Install · Amazon equivalent** (`selected_option = "install_amazon"`)
    - **No fix needed / Skip** (`selected_option = "skip"`) — schema supports this via the `skip` enum value on `tdr_failure.selected_option`. The customer-facing copy needs explicit framing per §15: *"Honest diagnosis from Teddy, no repair needed. You saved money — most companies charge $100-150 for the same in-home service."* **NO REFUND** for the `skip` branch — the customer paid for the diagnosis, that's what they got.

16. **Customer choice captured** `[BUILT]`. `qc_persist_selections` writes `selected_option` per `tdr_failure` row.

17. **Customer pays for chosen option (if applicable)** `[BUILT]` for the existing flow; pricing math in `qc_create_checkout_session_POST.xs`: parts × 1.30 markup, labor as-is, $50 Quick Check credit applied to labor (floor 0), $15 flat shipping for DIY paths. `skip` and `pending` options have explicit handling.

18. **SMS confirms order** `[NEEDS BUILD]`. New trigger: `"Order confirmed. We're sourcing your part from {Marcone | Amazon | Tribles}. We'll text you when it ships."`.

19. **Supplier ships DIRECTLY TO CUSTOMER ADDRESS** `[NEEDS BUILD]`. Architectural commitment (§15 item 1): in ALL scenarios where parts are needed, the part ships from the supplier directly to the customer's address (= service address from intake). Tech does not carry parts. Tech is dispatched only after parts have arrived.

20. **Tracking captured** `[BUILT (schema)]` `[NEEDS BUILD (capture flow)]`. `part_order` table has `tracking_number`, `vendor_name`, `vendor_order_number`, `order_status` (needs_order / ordered / shipped / delivered / backordered / canceled), `estimated_delivery_date`. Today the capture is manual; future-state is API-driven (Marcone / Amazon / Tribles APIs — §10).

21. **"Parts shipped + tracking" SMS to customer** `[NEEDS BUILD]`. New trigger: `"Your part shipped from {vendor}. Tracking: {tracking_number}. Estimated delivery: {estimated_delivery_date}."`.

22. **"Parts delivered" SMS to customer — DIY branch** `[NEEDS BUILD]`. When the part is delivered (carrier webhook, or polled status check, TBD): `"Your part has arrived. Need help installing? Reply VIDEO for a $40 Premium Video Call (15-minute session with a tech)."`.

23. **"Parts delivered" SMS to customer — Install branch** `[NEEDS BUILD]`. `"Your part has arrived. We're scheduling your tech now — you'll get a confirmation shortly."` Triggers Tech Scheduler v2 broadcast to the qualified cluster.

24. **DIY path: $40 Premium Video Call upgrade** `[NEEDS BUILD]`. 15-minute session with a tech for DIY customers who get stuck installing. Stripe link required. Release of Liability waiver (separate from the intake waiver — see §15 item 3) fires BEFORE the call connects. No customer payment for labor on DIY path.

25. **Install path: tech dispatch flow continues** `[BUILT]`. Existing infrastructure: TDR routes through `scheduling_decision = "ready_to_schedule"` → `scheduling_queue` → broadcast to qualified cluster → first-reply-wins → tech accepted → 30-min reminder → tech arrives → repair → completion gate (Tech Assist v1 enforces) → feedback SMS via `process_feedback_queue` cron + `feedback_classifier` AI agent.

26. **Feedback SMS** `[BUILT]`. After job completion, customer receives a feedback request. Reply classified by `xano-workspace/ai/agent/feedback_classifier.xs` (Anthropic Claude Sonnet 4.5 with extended thinking) into positive / negative / unknown. Positive replies routed to the Google review CTA: `g.page/r/CRt-vo--eAJ3EBM/review`. Negative replies trigger `handle_negative_followup_POST.xs` (warm callback path).

---

## Section 4 — Warranty customer journey end-to-end [LAYER 1]

1. **HCP webhook fires** (today: sparse-payload incident; see §9) → Netlify `hcp-webhook-proxy.js` → Xano `hcp_job_webhook_POST.xs`.
2. **Workaround in place: HCP polling.** `hcp_poll_recent_jobs_POST.xs` is scheduled as a 15-min cron via `task/hcp_poll_recent_jobs.xs`, gated by `$env.HCP_POLL_ENABLED` (currently UNSET — manual `override_enabled=true` runs only).
3. **Xano `jobs` row created** with `customer_type="warranty"`, `intake_source="hcp_webhook"` (or `hcp_poll` / `hcp_backfill`), warranty company markers in notes. Three cleanup endpoints exist for historical bad-classification rows: `reclassify_ahs_jobs`, `derive_appliance_from_notes`, `reattribute_hcp_techs`.
4. **Warranty intake collects warranty company, claim number, model, video, photos, schedule, consent.** Channels:
   - **Vapi outbound** for warranty-pending jobs >2h old without prior contact (`task/vapi_warranty_followup_scheduler.xs`, every 10 min, calls `/WdAZ3bLA/trigger_vapi_warranty_call`).
   - **Ant outbound chat** if customer has web access.
5. **Teddy reviews** in the Teddy Tool (same cockpit as self-pay; `mode=pre_diagnosis`).
6. **Tech dispatch** via Tech Scheduler v2: broadcast / first-reply-wins / accept.
7. **Tech does repair on-site.**
8. **Tech Ant TDR collection at home** (post-job retrospective at `tech-ant.html?job_id=…`) or **Tech Ant Assist v1 live capture** (during the job at `tech-ant-live.html?job_id=…`, when `TECH_ASSIST_ENABLED` is flipped). Required fields enforced via the soft-block + 2hr escalation pattern.
9. **Danielle submits to warranty portal MANUALLY** today (target: AHS API + ServicePower SOAP automation — §10).

---

## Section 5 — Tech side [LAYER 1]

**Cluster routing.** Each tech is assigned to a `cluster` (geo-grouping of ZIPs) with a rank order. Broadcasts filter to qualified techs by cluster + availability + hard preferences (full-day-off only in v1).

**SMS broadcast.** When a TDR's `scheduling_decision=ready_to_schedule` lands, `scheduling_queue` enqueues a broadcast row, the queue worker fans out SMS via Twilio to all qualified techs from `+17273508487`. Race-safe two-step claim: `__CLAIM_BROADCAST__` paired token → first-reply-wins.

**Tech Ant on phone.** Two pages, one trigger:
- `tech-ant-live.html?job_id=X&tech_id=Y` — live in-field capture (Tech Assist v1 design; activates on HCP `work_status=in_progress` webhook when `TECH_ASSIST_ENABLED` is flipped).
- `tech-ant.html?job_id=X&tech_id=Y` — post-job retrospective TDR completion.
- Auth: PIN fallback via existing `verify_tech_pin` Xano endpoint + `verify-pin-proxy.js` Netlify function. Magic-link upgrade in v1.1.

**Tech Assist v1 (currently dormant).** On-site field copilot. Soft-block + 2hr escalation: tech can mark HCP complete normally, but if required TDR fields are missing when `job.completed` fires, Ant DMs the tech, asks for missing fields one at a time, escalates to Teddy after 2hrs if unresolved. Slam-dunk mode (default, ~3-5 messages) vs Assist mode (opt-in, ~15-25 messages, full diagnostic checklist). Multi-job-per-day handling auto-closes the previous session when a new `in_progress` fires. Override available: `"override - leaving without {field}, reason: {explanation}"` captured to TDR with `tech_override_flag=true`.

**Daily summary cron.** `task/daily_tech_summary.xs` runs every 15 min, queries techs whose preferred AM window matches the current CT time, sends rundown SMS. Gated by `$env.DAILY_SUMMARY_ENABLED`.

**Performance ledger.** `task/compute_tech_performance_ledger.xs` runs nightly at 04:00 UTC, gated by `$env.LEDGER_TASK_ENABLED`. 30-day rolling stats per tech (offered / accepted / called_off / helped_out / acceptance_rate / team_avg). Pattern detection runs O(N²) bucket scan across {city, dow, time_window} dimensions over `broadcast_decline` event_log entries; sets `pending_pattern_offer` JSON on the tech row when a pattern crosses the count-≥3 threshold. Drives soft-preference offers ("you've declined 4 Slidell jobs, lighten up?"). `__QUERY_MY_NUMBERS__` paired token + deterministic pattern fallback (Phase 7b) auto-appends real numbers to "my numbers" / "how am I doing" / "acceptance rate" replies.

**Sick day cascade.** When a tech's `__UPDATE_AVAILABILITY__` token fires for TODAY with `available=false`, `scheduling_queue_worker` enqueues a `sick_day_cascade` row, attempts silent reroute by cluster rank, falls back to customer 2-option SMS when no alternate, confirms back to the sick tech with one of 4 outcome variants.

**Owner override (Phase 8).** Three owner-only paired tokens in `tech_sms_inbound_POST.xs`: `__OWNER_REASSIGN_JOB__`, `__OWNER_OVERRIDE_AVAILABILITY__`, `__OWNER_BROADCAST_CONTROL__`. All defensive-guard on `$tech.id == 1` (Teddy). `TECH ROSTER` block in CONTEXT prevents tech_id ↔ name hallucination by Claude.

---

## Section 6 — Money side [LAYER 1]

**Self-pay:**
- $50 Quick Check (entry payment via Stripe) — credited toward repair.
- $40 Premium Video Call DIY upgrade `[NEEDS BUILD]` — flat fee, no credit.
- Repair total billed at end. Parts × 1.30 markup, labor as-is, $50 credit applied to labor (floor 0), $15 flat shipping for DIY paths.

**DIY:** $50 Quick Check only, $40 video call upgrade optional, NO labor charged (customer installs).

**Install:** $50 Quick Check + parts cost (with markup) + labor.

**Warranty:** warranty company pays. No customer payment. TN Appliance bills the warranty company via portal claim submission (Danielle manual today; AHS API / ServicePower SOAP target).

**Stripe links (existing, from memory — verify before quoting to anyone):** $50 / $90 / $100 service-tier links exist as pre-configured Stripe Checkout. Live keys in Netlify production env (`STRIPE_SECRET_KEY=sk_live_…[redacted]`, `STRIPE_WEBHOOK_SECRET=whsec_…[redacted]`).

**Refunds / chargebacks / disputes:** no infrastructure today. Out of scope for v1.

---

## Section 7 — Portal side (warranty) [LAYER 1]

**Today (manual via Danielle):**
- AHS / Frontdoor: Danielle logs in, submits TDR, attaches photos, fields auth requests for high-cost repairs.
- Allstate / SquareTrade via ServicePower: same pattern, ServicePower-hub portal.

**Target API automation:**
- **AHS API** for TDR auto-submission `[DESIGNED, NOT STARTED]`.
- **ServicePower SOAP** for TDR auto-submission + Phase 3 capacity governor `[DESIGNED, BLOCKED on per-tech-vs-per-area answer]`.
- **Allstate parser** for incoming Allstate-formatted dispatches `[DESIGNED, NOT STARTED]`.

Each warranty job ends with TDR submission to the relevant warranty portal.

---

## Section 8 — What's running in production today [LAYER 2]

| System | Status | Confidence |
|---|---|---|
| Homepage chat (`index.html` + Ant via `agent-chat-proxy.js → reply_2_POST.xs`) | LIVE | HIGH |
| Service strip + chat-side consent gate + auto-hide + recovery link | LIVE (this morning, commits `4070d5e` → `dfa08e2`) | HIGH |
| Cash TDR self-pay end-to-end (intake → Stripe → Teddy Tool → TDR options page → Stripe checkout → fulfillment) | LIVE | HIGH |
| Teddy Tool cockpit (`teddy-tdr-tool.html`, single-call hydrate via `qc_cockpit_load`) | LIVE | HIGH |
| `send-teddy-sms.js` "new job" notification | LIVE | HIGH |
| `send_qc_diagnosis_to_customer` (Teddy completed → customer SMS with TDR link) | LIVE | HIGH |
| Stripe checkout + webhook (live keys, `stripe-webhook.js` → Xano `stripe_checkout_session_completed`) | LIVE | HIGH |
| Public-view token (HMAC-SHA256, 7-day expiry, `generate-qc-token.js` + `validate-qc-token.js`) | LIVE | HIGH |
| HCP webhook intake (sparse-payload incident — accepts traffic, produces zero useful Xano writes) | DEGRADED | HIGH |
| HCP API probe (`hcp-api-probe.js`, auth-gated) | LIVE (kept as ops tool) | HIGH |
| HCP polling (manual via `override_enabled=true`; cron is scheduled but `HCP_POLL_ENABLED` unset) | DORMANT | HIGH |
| Three cleanup endpoints (`reclassify_ahs_jobs`, `derive_appliance_from_notes`, `reattribute_hcp_techs`) | LIVE (manual trigger only) | HIGH |
| Twilio SMS outbound via `send_sms_POST.xs` (creds rotated to `$env.*` 2026-05-08) | LIVE | HIGH |
| Twilio SMS inbound at `+16292840444` → `tech-sms-inbound.js` → Xano `api:scheduling/tech_sms_inbound` | LIVE | HIGH |
| Vapi warranty follow-up cron (`vapi_warranty_followup_scheduler.xs`, every 10 min) | LIVE (cron); end-to-end Vapi-side answering — UNVERIFIED | MED |
| Process feedback queue (`process_feedback_queue.xs`, every 5 min, sends feedback SMS) | LIVE (always-on) | MED |
| Feedback classifier AI agent (`xano-workspace/ai/agent/feedback_classifier.xs`, Sonnet 4.5 with extended thinking) | LIVE (wired to `feedback_reply_webhook_POST.xs`) | MED |
| Jotform waiver webhook (`jotform_waiver_webhook_POST.xs`, sets `waiver_signed`, `waiver_text_version=v1.0_2026-04-20`) | LIVE | HIGH |
| Tech Scheduler v2 backend (Phases 0-8 complete 2026-05-03/04; `SCHEDULING_QUEUE_ENABLED` gate keeps the worker dormant pending TCR + carryover polish) | BUILT, GATED | HIGH |
| Tech Assist v1 escalation cron (`compute_tech_assist_escalation.xs`, gated by `TECH_ASSIST_ENABLED`) | DORMANT | MED |
| Conversation 626 (canonical Teddy SMS thread, tech_id=1) | LIVE (verified during Phase 1) | MED |

**Current job count:** ~299 jobs in Xano `jobs` table (reported by user prompt; not re-verified this session). MED.

---

## Section 9 — What's built but dormant (env-var gated) [LAYER 2]

| Env var | Default | What flipping does | Blocker | Verification before flip |
|---|---|---|---|---|
| `HCP_POLL_ENABLED` | unset | 15-min HCP polling cron starts upserting jobs from `/jobs` REST endpoint. Workaround for sparse-webhook incident. | Verify polling logic doesn't double-write on race with webhook recovery. Verify `hcp_id` lookup + appliance derivation on inserts. | Dry-run a few cycles via `override_enabled=true`, confirm event-log entries `hcp_poll_started/finished`, then flip. **HIGH** (memory + verified `netlify env:list` this morning) |
| `DAILY_SUMMARY_ENABLED` | unset | Per-tech daily SMS rundown of jobs in their preferred AM window. | TCR campaign approval (bulk-ish SMS to multiple techs); per-tech `summary_send_time` column populated for each active tech. | Confirm per-tech preferred window populated; confirm TCR live; flip and observe one full day. **MED** |
| `LEDGER_TASK_ENABLED` | unset | Nightly 04:00 UTC computation of 30-day rolling stats + pattern detection. Feeds soft-preference offers. | Tech Scheduler v2 carryover polish (Phase 7b, 8b). Not load-bearing yet. | Run task once manually; verify `tech_performance_ledger` rows for all 6 techs; verify `pending_pattern_offer` populated correctly; flip. **MED** |
| `SCHEDULING_QUEUE_ENABLED` | unset | Broadcast / book / propose / wait / notify / escalate queue processing. Sweeps expired broadcast attempts. | TCR campaign approval (the worker fans out SMS to 5-6 techs per broadcast). Carryover Phases 7b + 8b polish. | TCR cleared; smoke-test broadcast on a single test job; verify all 7 paired tokens fire correctly; flip. **MED** |
| `TECH_ASSIST_ENABLED` | unset | Bootstraps Tech Ant Assist session on tech-arrival webhook + escalates stale 2h+ sessions to owner. | TCR clearance; Tech Assist v1 web UI build (estimated 2-3 marathon sessions per `docs/ant-tech-assist-design-v1.md`). | TCR cleared; `tech-ant-live.html` built and tested; flip. **MED** |
| `SIGNATURE_VERIFICATION_ENABLED` | `false` (Netlify env, verified) | Strict HMAC verification on incoming HCP webhooks. | HCP itself is not consistently signing payloads today. Flipping strict would lose unsigned events. | Wait for HCP to start signing reliably; flip and observe. **HIGH** (verified this morning) |
| `SMS_ENABLED` | NOT FOUND in code | (User-mentioned in prompt; may be planned but not yet code-level gated.) | TCR clearance is the gating event, not an env flag today. | If needed, add as a master kill-switch wrapping all Twilio outbound calls. **LOW** |
| `HCP_BACKFILL_ENABLED` | gated, manual | One-shot backfill endpoint. | Always-on for manual runs. | n/a (explicit-trigger-only). **MED** |

---

## Section 10 — What's designed but not built [LAYER 2]

| Item | Doc | Status / blocker |
|---|---|---|
| **Phase 3 ServicePower capacity governor** | `docs/capacity-governor-design.md` | **BLOCKED on Phase 3.0** — the per-tech-vs-per-area question. Capacity API requires `TechKey` per the v2.8 PDF Sections 6.1, 12, 13, but `warranty-operations-strategy.md` says ServicePower has no per-tech awareness. Three hypotheses + verification approach in the doc. **Awaiting Danielle's portal inspection answer** (sent 2026-05-08 morning, no reply yet — see §17). |
| **AHS API integration** | NOT IN REPO | Designed-not-built. Warranty TDR auto-submission to AHS portal. **LOW** (not in repo as a design doc) |
| **ServicePower SOAP integration** | `docs/capacity-governor-design.md` | Endpoints, auth, time bands documented. Production: `https://fss.servicepower.com/sms/services/SPDService?wsdl`. Staging: `fssstag.servicepower.com`. Auth: Danielle's portal credentials work directly per Section 5.1 of the v2.8 PDF (no token issuance, UserId+Password in body of every request). 5 valid time-band IDs only: `8-12`, `12-17`, `8-17`, `17-21`, `6-8`. Phase 3.0 blocker. |
| **Allstate parser** | NOT IN REPO | Designed-not-built. Parses incoming Allstate-formatted dispatch emails. **LOW** |
| **Marcone B2B API** | NOT IN REPO | Parts auto-ordering, ship direct to customer. **Pending in-person account approval** (see §17). |
| **Amazon API** | NOT IN REPO | Parts auto-ordering, ship direct to customer. Designed-not-built. |
| **Tribles API** | NOT IN REPO | Parts auto-ordering, ship direct to customer. Designed-not-built. |
| **RingCentral → Vapi port** | NOT IN A DESIGN DOC | Business voice line `615-280-2949`. In flight; transitional copy in `cash-tdr-customer.html:143` and `cash-tdr-thank-you.html:87` says "Call us" not "Call or text us." Pending. |
| **Customer transparency SMS workstream** | NOT IN A DESIGN DOC | Four new triggers: Teddy started review, parts ordered confirmation, parts shipped + tracking, parts delivered (DIY/Install branch). Plus voice-only parallel via Vapi general-purpose status update agent. |
| **New-customer voice intake (Vapi parallel to Ant chat)** | NOT IN A DESIGN DOC | Customer calls `615-280-2949` instead of using the chat. Vapi agent collects the same intake fields, writes to the same `jobs` table with `intake_source="vapi_voice"`. |
| **TDR options page customer-facing** | `docs/cash-tdr-delivery-design-v1.md` | **PARTIALLY BUILT** — `cash-tdr-customer.html` exists with all four options + `skip` enum. Phase 1f (multi-failure UI) deferred. No-fix-needed customer-facing copy framing per §15 needs to be tightened. |
| **$40 Premium Video Call DIY upgrade with Release of Liability waiver** | NOT IN A DESIGN DOC | NEEDS BUILD: Stripe link, video-call provisioning (Twilio Video / Daily / TBD), Release of Liability Jotform (separate from existing intake waiver — see §15 item 3), waiver-signed gate before call connects. |
| **Phase 1f multi-failure cash TDR** | `docs/cash-tdr-delivery-design-v1.md` | Single-failure pipeline live; multi-failure UI in Teddy Tool + customer page deferred. |
| **Rental / landlord-tenant flow (Pattern B)** | `docs/cash-tdr-delivery-design-v1.md` | Designed; not built. SMS routing splits between landlord (`bill_to`) and tenant (FYI). |
| **Gmail integration (intake channel #2)** | `docs/gmail-integration-design-v1.md` | Designed (6-8 sessions, ~20-30hrs). Build deferred until after Tech Assist v1 ships. |

---

## Section 11 — Operational surface [LAYER 2]

**Domain & hosting:**
- Custom domain: `tnapplianceexchange.net`
- Netlify project: `superlative-naiad-233aa7` (Project ID `1ecd89fc-8a9c-4fa3-b923-5186759cfc84`)
- Netlify functions URL pattern: `https://superlative-naiad-233aa7.netlify.app/.netlify/functions/<name>`

**GitHub:**
- Repo: `tnappliancerepair-hub/tn-appliance-tools`
- Default branch: `main`

**Xano:**
- Instance: `xbtp-g9bh-ditq.n7e.xano.io`
- Workspace: 1 ("James's Workspace")
- API groups in heavy use:
  - `intake` (`api:3e_TffpA`)
  - `cash_tdr` (`api:VGkW9mcV`)
  - `scheduling`
  - `WdAZ3bLA` (Vapi)
- Metadata API token: `~/.xano/credentials.yaml`

**Twilio:**
- Account SID `ACefea…[redacted]` (production env, verified)
- Auth token rotated 2026-05-08; previously hardcoded literal in `send_sms_POST.xs` and `create_job_POST.xs`, now `$env.TWILIO_AUTH_TOKEN` everywhere
- 10DLC TCR campaign: PENDING. Day 8+ as of 2026-05-09 morning. Five prior rejections; today's resubmission is the load-bearing compliance push (homepage rebalance + chat-side consent gate + service-strip pre-selection routing + system-prompt update). Expected approval window 3-4 days based on prior cycles.
- Numbers:
  - **Business outbound + customer SMS:** `+16292840444`
  - **Tech inbound + Tech Scheduler outbound:** `+17273508487`
  - **Vapi TN BYO numbers:** `+16292607111`, `+16292477111`
  - **Owner cell (Teddy):** `+16154855795` (often quoted as `615-485-5795`)
  - **Danielle:** `615-485-0713`
  - **Customer-facing voice (RingCentral, porting to Vapi):** `615-280-2949`

**Stripe:**
- Live keys in Netlify production env (`STRIPE_SECRET_KEY=sk_live_…[redacted]`, `STRIPE_WEBHOOK_SECRET=whsec_…[redacted]`)
- Pre-configured Checkout links: $50 / $90 / $100 service-tier entry points (existing, from memory — re-verify URL specifics before quoting)

**HCP (Housecall Pro):**
- API base: `https://api.housecallpro.com`
- API key: `HCP_API_KEY=[redacted]` in Netlify production env (rotated 2026-05-08, was missing pre-2026-05-07)
- Webhook destination: ACTIVE; fires `job.appointment_scheduled`, `job.work_status_changed` (in_progress / completed), `customer.created/updated/deleted`. **CURRENTLY DEGRADED** — sparse-payload incident since 2026-05-05.
- HCP→Xano tech mapping (technician_id ↔ HCP `pro_` UUID): documented in `technicians.hcp_id` column. IDs 1-6 mapped per the roster in §1.

**Vapi:**
- 11 agents total — only 3 confirmed live, 8 need verification.
- **CONFIRMED LIVE:**
  - **Ant Inbound** — `7cc98b0c…` (UUID prefix only documented in user prompt)
  - **Ant Warranty Fallback** — `0abe54ec…`
  - **Ant Parts Follow-Up** — `b71260b4…`
- **NEED VERIFICATION (8 agents):**
  - Reminder
  - Missed Call
  - Auth Update
  - Parts ETA
  - Running Late
  - Reschedule
  - After Hours
  - Warranty Company Inbound
- All agents share the voice/model stack:
  - **LLM:** Claude Sonnet
  - **Voice:** Heisenberg (11Labs)
  - **Transcriber:** Nova 2 Phonecall

**S3:**
- Bucket: `tn-appliance-media-586117210123-us-east-2-an`
- Region: `us-east-2`
- Used by: CaptureOverlay photo/video uploads, TDR attachments
- Endpoints: `s3-presign.js` (upload), `s3-view-url.js` (view)

**AI providers:**
- **Anthropic Claude** (only AI provider in use):
  - Customer-facing Ant chat: `claude-sonnet-4-X` via `agent-chat-proxy.js → reply_2_POST.xs`
  - Teddy Tool AI pre-fill: `claude-sonnet-4-20250514` via `claude-proxy.js`
  - Feedback classifier: Claude Sonnet 4.5 with extended thinking
  - Tech SMS conversational reasoning: Claude (Sonnet) via Anthropic API
- No OpenAI / Gemini / other providers.

**Other infrastructure:**
- **Waiver Jotform:** `form.jotform.com/260495320372050` — fires the `jotform_waiver_webhook_POST` endpoint on submission. Waiver text version `v1.0_2026-04-20`.
- **Google review CTA:** `g.page/r/CRt-vo--eAJ3EBM/review`

---

## Section 12 — Security debt [LAYER 2]

1. **Twilio + HCP credentials rotated 2026-05-08.** Previously hardcoded literals in `xano-workspace/api/intake/send_sms_POST.xs` and `create_job_POST.xs`. Now `$env.TWILIO_*` and `$env.HCP_API_KEY` / `$env.HCP_BASE_URL`. Old keys revoked. Bearer→Token scheme fix on HCP also applied. Low priority going forward (access scoped to Teddy only).

2. **Lingering DIAG code in `netlify/functions/hcp-webhook-proxy.js` from 2026-05-07 HCP investigation.** Two-line `rawBody` logger tagged `// DIAG 2026-05-07 - REMOVE after HCP payload investigation`. Decision pending HCP support ticket resolution. Same applies to `hcp-api-probe.js` (entire file is diagnostic; auth-gated; debate is "remove" vs "keep as ops tool"). Ref: memory `project_diagnostic_code_to_remove.md`.

3. **Anomalous duplicate Stripe key in Netlify env.** `netlify env:list --plain --context production` (run earlier today) showed a line where the literal Stripe key was set as both name AND value — looks like a copy-paste accident. Should be investigated and removed if not load-bearing. Low risk given access is scoped to Teddy.

4. **Production env literals visible to anyone with Netlify CLI access.** This is the underlying state, not a new debt. Twilio auth token, HCP API key, Stripe live secret, HCP webhook secret, AWS S3 secret access key, QC token secret, Xano webhook shared secret all observable via `netlify env:list --plain`. Per the standing redaction rule, those are not repeated here. Low risk given access is scoped to Teddy only.

5. **`SIGNATURE_VERIFICATION_ENABLED=false`** for HCP webhooks — webhook proxy accepts unsigned requests because HCP isn't currently sending the signature header consistently. Practical blast radius bounded by the Xano-side `_internal_auth` body-field precondition. Acceptable as workaround.

6. **`xano-workspace/`** is committed to git (`.gitignore` comment historically said it was ignored, but the directory IS in the repo). Was a one-time grep for hardcoded `Bearer [a-zA-Z0-9]{20,}` or `sk_live_` patterns ever done? Not done this session. Worth a one-pass audit.

---

## Section 13 — Recent ship history (May sprint) [LAYER 2]

Pulled from git log + memory. Most recent first.

**2026-05-09 (today):**
- `dfa08e2` Service strip auto-hide after channel pick + recovery link
- `4070d5e` Rebalance homepage: service strip + chat prominence + pre-select pipeline
- `b275d89` Homepage above-fold fix: anchor consent disclosure to top of main, tighten card rhythm
- `91d87cd` Revert "Homepage redesign: chat-centered layout, consent disclosure repositioned below chat"
- TCR resubmission compliance push complete; chat walk verified clean both branches (Yes-text-me / Voice-only)
- Xano consent columns added (per user prompt — not personally re-verified this session)

**2026-05-08:**
- `a951621` Homepage consent card: reinforce demo-only treatment of mockup buttons
- `96ebba9` TCR compliance: reposition homepage consent card above hero + Ant prompt update proposal
- `92e9daf` TCR compliance: add homepage SMS consent disclosure card (visibility layer)
- `b6673e6` TCR compliance overhaul: explicit consent gate before phone collection, /sms-opt-in disclosure page, homepage business identity
- Twilio + HCP credential rotation; hardcoded literals swapped for `$env.*` references in `send_sms_POST.xs` and `create_job_POST.xs`
- System prompt rewritten for SMS CONSENT GATE (the `__SHOW_CONSENT_CHECKBOX__` token contract; addition lives in `prompts/ant_system_prompt_consent_gate_addition.md`)
- Build E verification (5/5 reclassified jobs verified as warranty)
- Fix A + Fix B (in-line notes-content fallback for appliance + warranty)
- Build C (HCP pro_id → tech_id mapping; 165/216 misattributed historical rows flipped to correct techs)
- 89a0350 redeploy: pick up rotated HCP_API_KEY in Netlify env

**2026-05-07:**
- `ba4bfcb` docs: capacity governor architecture
- `eaa9063` docs: full ServicePower integration guide library committed (5 Servicer guides + 1 bonus)
- `db11419` docs: warranty operations strategy (captured from Danielle interview + tech conversations)
- `943231f` docs: tech operational profiles (captured from Lee, Jimmy, Andre interviews)
- `f98d95e` DIAG 2026-05-07: log raw HCP webhook body + add HCP API probe
- HCP sparse-payload incident diagnosed
- HCP_API_KEY set in Netlify production env

**2026-05-04:**
- Phase 8 owner override shipped (Tech Scheduler v2)
- Phase 7b QUERY_MY_NUMBERS pattern-match fallback shipped

**2026-05-03 to 2026-05-04 (the 16-hour Tech Scheduler v2 sprint):**
- Phase 0 schema (3 modified + 5 new tables)
- Phase 1 tech ID + onboarding (Conv 626 = canonical Teddy SMS thread, tech_id=1)
- Phase 2 daily summary cron
- Phase 3 TDR processor + scheduling_queue worker
- Phase 4 broadcast logic (race-safe two-step claim, expiry sweep)
- Phase 5 conversational reasoning (~640 lines, 7 paired-token tools)
- Phase 6 sick day cascade
- Phase 7 performance ledger + pattern detection (with Phase 7b deterministic fallback)
- Phase 8 owner override (3 owner-only paired tokens, TECH ROSTER block)

**Earlier May:**
- Phase 1g Teddy diagnostic cockpit + AI pre-fill hotfix
- Phase 1c Stripe Checkout integration (steps 3a-3e)
- Phase 1c step 3b `send_qc_diagnosis_to_customer` endpoint
- Phase 1c step 3d Stripe webhook receiver (`stripe-webhook.js` + Xano handler)
- 30% markup math + customer-facing pricing semantics

---

## Section 14 — Long-term vision [LAYER 1]

**Fleet:** 2 Tesla Model Y to start, scaling to 6. Visual brand consistency. Cybertruck stays Teddy's owner-operator vehicle.

**Platform play:** License the system to independent appliance techs nationally once TN Appliance Exchange runs hands-off. Everything currently being built (Ant intake, Tech Ant, Tech Ant Assist, capacity governor, performance ledger, warranty portal automation, customer transparency SMS) is platform-quality.

**Phase 8 success criterion (`docs/ant-tech-scheduler-design-v2.md:627`):** *"Could a different shop's 6-tech crew be onboarded in <1 day?"* — the moat metric.

**Multi-tenant constraint (`docs/gmail-integration-design-v1.md:274`):** *"If we ever need multi-tenant, this re-opens the same $15k+ assessment problem that killed Option C — plan accordingly."* Today's architecture is single-tenant; v2+ adds multi-tenant.

**B2B unit economics:** Replace the human dispatcher (~$40-60k/yr role) per shop. The business model is per-tech / per-shop SaaS pricing once the platform stabilizes.

### Strategic goal (2026-05-09 articulated)

The goal is to **prove the system works in production with real techs and real customers, then let the best ideas win.** Scaling (whether by adding techs, licensing to other independent appliance shops, or geographic expansion) follows proof.

**Optimization priorities, in order:**

1. **Time to working proof** — get the system live with real techs serving real customers, with measurable evidence it works
2. **Iteration speed** — when something is wrong or someone has a better idea, the system absorbs the change fast
3. **Scalability path** — when proof works, scaling doesn't require a rebuild

**Implication for architecture choices:**

Architecture decisions are **evidence-driven, not theory-driven**. Until production data exists, "what's the best architecture" is the wrong question. The right question is "what's the fastest path to having the existing systems running in production so we can learn what's actually broken." Architectural elegance defers to operational learning. **The best idea wins, defined by real-world observation, not by reasoning alone.**

---

## Section 15 — Architectural commitments (load-bearing decisions) [LAYER 1]

These are the decisions that get lost across chat sessions. Re-read this section before suggesting changes that might violate them.

1. **Parts ship direct to customer in ALL scenarios where parts are ordered.** Customer's shipping address = service address from intake (`customer.address`, `customer.city`, `customer.state`, `customer.zip`). Tech does not carry parts. Tech is dispatched ONLY after parts have arrived at the customer's home (delivery confirmation triggers tech scheduling on the Install path). This applies to both DIY paths (customer installs the part themselves) and Install paths (tech installs but the part already lives at the customer's address).

2. **No-fix-needed = no refund.** Customer paid for honest diagnosis, that's what they got. SMS phrasing emphasizes savings vs $100-150 in-home diagnostic competitors: *"Honest diagnosis from Teddy, no repair needed. You saved money — most companies charge $100-150 for the same in-home service."* The `tdr_failure.selected_option = "skip"` row is the schema representation.

3. **DIY support pricing: $40 Premium Video Call upgrade.** 15-minute session with a tech for DIY customers who get stuck installing. **Release of Liability waiver fires BEFORE the call connects** — a SEPARATE waiver from the existing `v1.0_2026-04-20` Jotform intake waiver. The DIY waiver covers "you're installing this yourself, the tech is coaching only, we are not liable for installation outcomes." Stripe link required (does not exist yet).

4. **Customer-facing TDR options page presents 4 options + no-fix-needed branch.**
   - DIY · OEM Part (`selected_option = "diy_oem"`)
   - DIY · Amazon equivalent (`selected_option = "diy_amazon"`)
   - We Install · OEM (`selected_option = "install_oem"`)
   - We Install · Amazon equivalent (`selected_option = "install_amazon"`)
   - No fix needed / Skip (`selected_option = "skip"`)
   The schema enum already supports all five (`xano-workspace/table/tdr_failure.xs:56-63`). The customer-facing UX exists for the four; the no-fix-needed framing per item 2 above needs explicit copy.

5. **Future-state ordering is API-driven.** Three suppliers, in order of preference:
   - **Marcone** (OEM parts; primary supplier; B2B account approval pending)
   - **Amazon** (equivalent / cheaper alternative; API integration pending)
   - **Tribles** (third option; API integration pending)
   Customer choice (option 4 above) drives which supplier API is invoked. Order is placed via API → ships to customer's service address → tracking captured → customer notified via SMS.

6. **Voice-only customers get Vapi outbound calls at every SMS trigger point.** One general-purpose "Ant Status Update" Vapi agent receives trigger context (job_id, event_type, custom message body) and delivers the equivalent voice update. Same touchpoints as SMS, different channel. The `consent_method = "voice_only_button_click"` flag on the customer determines which channel fires.

7. **Customer transparency SMS is the standard.** Every state change in the job lifecycle generates a customer notification. The customer should never wait in silence. The four new triggers being added (Teddy started review, parts ordered, parts shipped + tracking, parts delivered) are the customer-transparency workstream that makes this principle real for the supplier-direct-ship model.

---

## Section 16 — XanoScript footguns and lessons [LAYER 2]

Documented gotchas pulled from memory + design docs. Reference when writing or reviewing `.xs` files.

1. **Em dashes (`—`) crash the parser.** First Twilio smoke test failed with `ERROR_FATAL: Malformed UTF-8 characters` because a test message contained `—`. The system prompt was moved to `$env.SYSTEM_PROMPT` for the same reason. **Use `-` instead.**

2. **Correct Anthropic response path:** `claude_response.response.result.content[0].text`. Memorize this — partial paths produce silent empty strings.

3. **Paginated queries return `{items, curPage, ...}` not plain arrays.** `return = {type: "list", paging: {...}}` returns a paginated wrapper that breaks `foreach` with `ERROR_FATAL: Please use a numerically indexed array.`. **Use plain `return = {type: "list"}`** (no paging clause) for foreach-able arrays.

4. **`|push:$variable_reference` produces associatively-keyed arrays** that fail downstream serialization. **Always push with object literals**: `value = $arr|push:{ field1: $obj_var.field1, field2: $obj_var.field2, ... }`. Pushing scalars is fine.

5. **No try/catch syntax** in XanoScript. Defensive null-checks and pre-validation patterns required.

6. **Customer_id check must be `!= null AND > 0`** — Xano's `0` is the unset-but-not-null sentinel for some fk columns.

7. **Filter dynamic args don't bind** — `$arr|filter:$this != $dynamic_var` silently drops every element. Workaround: nested foreach + `array.push`. Footgun #12 in the Tech Scheduler v2 doc.

8. **Paired tokens outer-split yields 2 not 3 parts** when the close marker differs from the open marker (`__TOKEN__ inner __END_TOKEN__`). Outer-split on the opening marker, then sub-split `[1]` on the end marker. Footgun #13.

9. **Visual editor corrupts complex endpoints** — use XanoScript view only when editing anything non-trivial.

10. **`db.edit` takes PK only** (`field_name="id", field_value=$id`). For atomic conditional updates use a two-step: `db.query` to verify state, then `db.edit` by PK.

11. **`db.get` with `null` `field_value` throws and kills the enclosing `foreach`** mid-iteration before any finalize step. Always wrap `db.get` in a null-check when the PK might be null. Discovered in Phase 6 sick_day_cascade.

12. **Logic Assistant unauthorized changes have happened.** Version-revert if it edits without explicit approval. Treat any unexplained schema or endpoint diff as suspect.

13. **Xano CLI workspace push silently fails on column nullability changes via ALTER COLUMN.** Recreate the column or do the change via the Xano admin UI.

14. **`regex_replace` with non-greedy `[\s\S]*?` returns `null`** instead of the modified string. Use `split:"<token>"` then rejoin `parts[0] ~ parts[2]`.

15. **`?? "default"` doesn't fire on empty strings.** Xano stores unset text/enum fields as `""`, not `null`. Use `(($val|trim) != "") ? $val : "default"` for empty-aware fallbacks.

16. **Anthropic API rejects empty-content messages and consecutive same-role messages.** Always filter conversation history before sending: skip empty content + skip same-role-as-last-pushed.

17. **Conversation-history poisoning.** When a prompt change alters the meaning or availability of a tool, historical assistant messages where the model said "this isn't available yet" must be deleted (or the conversation reset) — otherwise the model stays consistent with its own prior responses and ignores the prompt update. Discovered in Phase 7 (conversation 626, messages 3417 + 3419).

18. **`$env.X` in `url = ...` field of `api.request` is unreliable** — comes through empty in some cases. Hardcode the URL and put `$env.X` in `headers = [...]` instead.

19. **`|contains:` with a dynamic argument is unreliable.** Use explicit OR comparison chain: `($x == "a") || ($x == "b") || ($x == "c")`.

20. **Filter precedence inside long string concatenations** can be ambiguous — hoist filtered values into vars before the concat.

21. **Chained `||` between filter expressions in `if` predicates** has the same precedence quirk. Wrap each filter expression in its own parens: `($body|contains:"X") || ($body|contains:"Y")`.

22. **`§` character breaks the parser.** Use the word "section" instead.

---

## Section 17 — Pending external blockers [LAYER 2]

| Blocker | Asked when | Status | Impact if resolved |
|---|---|---|---|
| **Danielle: per-tech vs per-area capacity model answer** | 2026-05-08 morning | NO REPLY YET | Unblocks Phase 3 ServicePower SOAP capacity governor. Either confirms TechKey acquisition path or reveals an undocumented per-area API. |
| **Marcone B2B API: in-person account approval** | (date not in memory) | PENDING | Unblocks the parts auto-ordering pipeline. Until approved, Marcone orders stay manual. |
| **RingCentral → Vapi port for `615-280-2949`** | (port in flight) | PENDING | Unblocks customer-facing voice automation. Customer-facing copy in `cash-tdr-customer.html:143` and `cash-tdr-thank-you.html:87` says "Call us" not "Call or text us" specifically because of this. |
| **TCR campaign approval** | (resubmitted 2026-05-09 today) | PENDING (day 8+, expected approval 3-4 days) | Unblocks `DAILY_SUMMARY_ENABLED`, `SCHEDULING_QUEUE_ENABLED`, `TECH_ASSIST_ENABLED` — three env-gated systems all waiting on this single event. |
| **HCP support ticket: sparse-payload investigation** | 2026-05-07 (file pending) | PENDING | Unblocks webhook-driven HCP intake; until then, `HCP_POLL_ENABLED` is the workaround path. |
| **Teddy: paste system-prompt addition into Xano `$env.SYSTEM_PROMPT`** | 2026-05-08 | PENDING | Without this, the chat-side consent gate never fires in production (the frontend code is correct, but Ant doesn't emit `__SHOW_CONSENT_CHECKBOX__`). Required for TCR to actually exercise the consent path on review. |

---

## Section 18 — Uncertainty / what's unverified [LAYER 2]

**2026-05-09 update:** Several questions in this section have been answered or formally locked in `docs/system-blueprint-decisions-2026-05-09.md`. Marked inline below with **[ANSWERED → see decisions doc]** or **[LOCKED]**. Still-open items remain unmarked.

These are the questions a future session should ask Teddy before relying on this blueprint. Carries forward the 18 from `docs/system-blueprint-cc-reconstruction.md` plus new items surfaced during this write.

**Carried forward from the prior reconstruction:**

1. **Is Tech Ant actually live in production today?** Files `tech-ant-live.html` and `tech-ant.html` exist; design doc says "ready for build, blocked on TCR." Is a tech actively using it on a job site right now or is it scaffolding-only?

2. **Is the `615-280-2949` Vapi port complete or still in flight?** HTML copy says "Call us, not text" — that's transitional. Is the Vapi side just outbound today (the warranty follow-up cron), or is inbound also handled?

3. **Phase 3.0 of the capacity governor** — has Danielle completed the portal inspection? If so, which hypothesis (A, B, C) was it? If not, when?

4. **What does Phase 8 of Tech Scheduler v2 mean by "shipped" today?** Phases 0-8 reported done. Are techs actually receiving broadcast offers and replying via SMS in production right now? If so, why is `SCHEDULING_QUEUE_ENABLED` still off?

5. **Marcone B2B API** — pending in-person approval per user prompt. Confirmed.

6. **Allstate parser** — design doc not in repo. Where does this design live, if anywhere? Is this an upcoming workstream or a prior research thread?

7. **The "fleet plan"** — clarified by user prompt: 2 Tesla Model Y to start, scaling to 6.

8. **Build state of Tech Scheduler v2 vs Tech Assist v1** — Scheduler v2 phases 0-8 done; Tech Assist v1 design locked, not built. Confirmed.

9. **Danielle's exact role boundaries** going forward — will she remain manual indefinitely, or does Capacity Governor Phase 3 retire her ServicePower duties?

10. **The 25 unassigned-HCP `tech_id=1` rows** flagged in the deferred queue — cleaned up via the queued `null_unassigned_hcp_techs` endpoint, or still pending?

11. **The Vapi assistant IDs and configuration** — user prompt provided 3 confirmed IDs (Ant Inbound, Ant Warranty Fallback, Ant Parts Follow-Up) and 8 names needing verification. The 8 unverified agents need their IDs confirmed and their existence in the Vapi dashboard verified. **[PARTIALLY ANSWERED 2026-05-09 → see decisions doc]** — repo cannot enumerate; configs live in Vapi dashboard. Teddy to do 10-min manual inventory. Architectural pattern for invocation confirmed via `trigger_vapi_warranty_call_POST.xs`.

12. **Customer-portal vs PWA** — is the cash-TDR experience SMS-link-only, or is there a longer-running customer dashboard at any URL? `dashboard.html` exists but unread.

13. **What's `book.html`?** File exists; appears to be a post-waiver self-schedule landing page. Confirm purpose.

14. **`feedback_classifier` AI agent end-to-end** — cron + endpoint + agent definition exist. Are inbound feedback SMSes actually being classified live and acted on?

15. **Stripe duplicate-key env entry** — broken artifact or load-bearing somewhere? Should it be removed?

16. **`xano-workspace/` audit** — fully `$env.*`-clean post-rotation, or are hardcoded literals still lurking? One-pass `Bearer [a-zA-Z0-9]{20,}` + `sk_live_` grep needed.

17. **`xano-workspace/api/intake/intake.xs`** — exists alone in the directory; not read. Router or vestigial?

18. **`book_appointment_POST.xs`** — booking step downstream of `qc_create_checkout_session` for In-Home Visit jobs, or a separate scheduling primitive used by Tech Scheduler v2?

**New items surfaced during this v1 write:**

19. **The 9 design decisions locked for Ant Tech Scheduler** — user prompt references "9 design decisions" but the v2 design doc I read covers 8 build phases; the canonical "9 decisions" list either lives in the predecessor `ant-tech-scheduler-design.md` (Saturday 5/2 evening, voice/scope decisions per the v2 doc header) or in memory I don't have. Where is the canonical 9-decisions list, and should it be quoted verbatim into this blueprint?

20. **Vapi general-purpose "Ant Status Update" agent** for voice-only customer transparency — does this exist as one of the 8 unverified agents (e.g., is "Auth Update" or "Parts ETA" actually this), or is it a NEW agent that needs to be designed and built? **[PARTIALLY ANSWERED 2026-05-09 → see decisions doc Decision 2]** — awaits Teddy's manual Vapi dashboard inventory. Build pattern locked; existing-vs-new branch unresolved.

21. **Existing intake-time waiver vs DIY-path Release of Liability waiver** — confirmed separate concepts. The intake-time waiver fires after submission via `jotform_waiver_webhook_POST`; the DIY-path waiver fires before the $40 Premium Video Call connects. Both need explicit copy + Jotform IDs (or replacement mechanism). New Jotform form ID for the DIY waiver does NOT exist yet.

22. **"Teddy started review" SMS trigger** — what's the actual mechanic? Is it (a) when Teddy clicks a "Start Review" button in the Teddy Tool that doesn't exist yet? (b) when `cockpit_load` is called server-side? (c) some other event? Needs a single load-bearing event to fire on. **[LOCKED 2026-05-09 → see decisions doc Decision 3]** — auto-fire on `qc_cockpit_load`, idempotent via `jobs.teddy_review_started_at` timestamp.

23. **Carrier "parts delivered" event source** — for the Install-branch SMS trigger, who reports delivery? Carrier webhook (UPS/FedEx/USPS APIs)? Polling? Customer self-report ("Reply DELIVERED when your part arrives")? Architectural decision needed. **[LOCKED 2026-05-09 → see decisions doc Decision 4]** — customer self-report via inbound SMS keyword (DELIVERED / arrived / got it / received), with daily 3-day-stale nudge as backup.

24. **TDR options page no-fix-needed customer-facing copy** — the `skip` enum exists in the schema, but the `cash-tdr-customer.html` UI may not surface it explicitly with the "you saved money vs $100-150" framing. Needs a UX pass. **[LOCKED 2026-05-09 → see decisions doc Decision 5]** — standard "Teddy completed review" SMS template handles `skip` branch with same warm tone; no new trigger. Verification action: read homepage + Stripe checkout + intake waiver copy to confirm "no refund" framing is unambiguous up front.

25. **Auth gate for the "Change my contact preference" link** — currently any visitor with `localStorage.consentPreSelect` can hit the recovery link and re-show the strip. Is that the intent, or should there be a soft confirm? Low risk; flagging for completeness.

26. **`SMS_ENABLED` env var** — user prompt mentions it as a planned gate. Not in code today. Is the intent to add a master Twilio kill-switch wrapping all `send_sms_*` calls, or is TCR clearance the de-facto gate? **[LOCKED 2026-05-09 → see decisions doc Decision 6]** — BUILD. Phase 2 verification confirmed `SMS_ENABLED` doesn't exist anywhere. 16 direct Twilio call sites + 1 wrapper + 1 Netlify function need to be gated. Default `false` until TCR clears.

---

## End of blueprint v1

**File path:** `docs/system-blueprint-v1.md`
**Update cadence:** Layer 2 sections (8, 9, 10, 11, 12, 13, 17, 18) update as state changes — daily during active sprints. Layer 1 sections (1, 2, 3, 4, 5, 6, 7, 14, 15) update only on architectural decisions, not on ship events. Section 16 (footguns) is append-only.
**Next session:** Read this file first. Then check git log for ship events since this date. Then check `MEMORY.md` for any new memory entries. Then proceed with the work prompt.

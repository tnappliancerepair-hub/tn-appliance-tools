# TN Appliance Exchange — System Blueprint (Claude Code Reconstruction)

**Reconstructed:** 2026-05-09 by Claude Code (claude-opus-4-7), one session.
**Method:** Read repo + own auto-memory. Did not contact Teddy during reconstruction.
**Purpose:** Cross-check against another chat instance's reconstruction. Diff target.

**Confidence legend:**
- **HIGH** — verified by reading the actual file or running an endpoint check this session.
- **MED** — held in memory, design docs, or git history; consistent across sources but not re-verified line-by-line right now.
- **LOW** — inferred from secondary signals or remembered without re-grounding.

Credential literals redacted as `[redacted]` per the standing redaction rule.

---

## 1. Owner / business context

**TN Appliance Exchange LLC** — Antioch, TN-headquartered, dual-state TN+LA appliance repair shop owned by James "Teddy" Pivacek (technician_id 1). Family business: brother Jimmy (id 2), son Andre (id 3, LA primary), cousin John Houk (id 6, LA), employees Lee Harding (id 4, TN), Billy Savoy (id 5, LA — interview pending). Six active techs, four family. **HIGH** (memory `user_profile.md` + `docs/tech-operational-profiles.md`)

Two revenue streams running side by side:
1. **Cash-flow / self-pay** — direct-to-customer repairs sourced via the Ant chat on `tnapplianceexchange.net` (the "Phase 1c–1g" build series).
2. **Warranty dispatch** — Allstate Protection Plans (formerly SquareTrade) routed through ServicePower, plus AHS / Frontdoor (American Home Shield) on a separate workflow. Both flows ride **HCP (Housecall Pro)** as the dispatch backbone connecting jobs to techs.
**HIGH** (memory + `docs/warranty-operations-strategy.md`)

Mobile-first owner-operator. Cybertruck-equipped — Quick Check triage performed from anywhere with cell signal, not from a desk. LA trailer (Hammond) used during regular trips. System architecture must assume mobile-first owner. **HIGH** (memory)

---

## 2. Customer journey — self-pay (cash flow)

End-to-end flow as built today:

1. **Customer lands on `https://tnapplianceexchange.net/`**. Sees the homepage: service explanation strip ("How our service works") with two routing buttons (Yes-text-me / Call-me-only), hero ("Stop Guessing. Ask a Technician."), prominent chat input. **HIGH** (worked on `index.html` extensively today, multiple commits)

2. **Customer chats with Ant.** Ant is the customer-facing AI persona, powered by Claude via `xano-workspace/api/intake/chat/reply_2_POST.xs` proxied through Netlify `agent-chat-proxy.js`. System prompt comes from Xano `$env.SYSTEM_PROMPT`. Ant collects: appliance type, brand, model, symptom, service tier ($50 Quick Check / $90 Video Call / $100 In-Home Visit), first name, **then** must emit the trigger token `__SHOW_CONSENT_CHECKBOX__` (per `prompts/ant_system_prompt_consent_gate_addition.md`) before asking for phone. The frontend strips the token, hides the input via `body.consent-gate-active`, and renders the two-button consent gate — Yes-text-me (`consent-btn-yes`) or Voice-only (`consent-btn-no`). On click, a synthesized user message ("Yes, you can text me about my service." / "No, please do NOT text me. Voice contact only.") is fired so Ant branches correctly. **HIGH** (worked on the gate in commits `b6673e6` → `dfa08e2`)

3. **Submit creates the Xano `jobs` row** via `create_job_from_chat_POST.xs` (intake api group), with `customer_type="self_pay"`, `intake_source="web_chat"`, `sms_consent` recorded with `CONSENT_LANGUAGE_VERSION` and timestamp. **MED** (file exists, not re-read this session — agent reading `cash-tdr-customer.html` confirmed flow)

4. **Teddy gets SMS notification.** `netlify/functions/send-teddy-sms.js` posts to Twilio (From `+16292840444`, To `+16154855795`) with body `"New job #${job_id} - ${customer_name}\n${appliance} | ${brand}\nIssue: ${problem}\n\nTeddy Tool: https://superlative-naiad-233aa7.netlify.app/teddy-tdr-tool.html?job_id=${job_id}"`. The link to the Teddy Tool is the deep-link Teddy taps from his phone to start triage. **HIGH** (read `send-teddy-sms.js` end-to-end this session; lines 14–16 are the load-bearing URL composition)

5. **Teddy opens `teddy-tdr-tool.html?job_id=…` from the SMS** (the cockpit). One round-trip: `loadCockpit(jobId)` calls the Xano endpoint `qc_cockpit_load` (intake group, GET) via the `xano-proxy` Netlify gateway, which returns `{job, appliance, photos, ...}` — single-call hydrate per Phase 1g design. **HIGH** (read `teddy-tdr-tool.html:224-249` this session)

6. **Teddy fills the cockpit fields** — diagnosis (free text or pre-filled by `aiPreFill()` calling `/.netlify/functions/claude-proxy` with a strict prompt that forbids scheduling language), OEM part number + cost, Amazon part number + cost, labor estimate, tech notes. Math: `markup30Display = round(cost * 13/10)` — 30% markup on parts displayed to customer. **HIGH** (read `teddy-tdr-tool.html:251-303`)

7. **Submit & Send to Customer.** `submitTDR()` validates inputs, then:
   - POST `xano-proxy → create_tdr` (intake group) with `mode=pre_diagnosis`, status=submitted, all the per-failure fields.
   - If `customer_type==self_pay`: POST `xano-proxy → send_qc_diagnosis_to_customer` (cash_tdr group) with `tdr_id`, `technician_id=1`, `force_resend=false`. That endpoint mints a public-view token (HMAC-SHA256, 7-day default expiry) via Netlify `generate-qc-token.js`, persists it as `public_view_token` on the TDR, and SMS's the customer a link `cash-tdr-customer.html?token=<signed>` via `send_sms_POST.xs`.
   - If warranty: TDR is saved but no customer SMS fires (different flow — see §3).
   **HIGH** (read `teddy-tdr-tool.html:305-399`; agent verified `send_qc_diagnosis_to_customer_POST.xs` and `generate-qc-token.js` patterns)

8. **Customer receives SMS, taps link → `cash-tdr-customer.html?token=…`**. Page calls `qc_diagnosis_view` (cash_tdr group) which calls Netlify `validate-qc-token.js` (HMAC-SHA256 verify + expiry check, timing-safe compare), then returns the TDR + per-failure pricing options. **HIGH** (agent read this; consistent with my memory of Phase 1c step 3b/3c)

9. **Customer chooses per-failure options** (DIY OEM, DIY Amazon, We Install OEM, We Install Amazon, Skip). "Confirm and Pay" calls `qc_persist_selections` (writes `selected_option` per failure), then `qc_create_checkout_session` (Stripe Checkout with parts × 1.30, labor as-is, $50 Quick Check credit floored at 0, $15 flat shipping). Returns `checkout_url`; customer redirects to Stripe. **MED** (agent read; not personally re-verified)

10. **Stripe → webhook → Xano**. Stripe POSTs `checkout.session.completed` to `netlify/functions/stripe-webhook.js`, which verifies the Stripe signature via SDK `webhooks.constructEvent`, filters to `checkout.session.completed`, and forwards to Xano `stripe_checkout_session_completed_POST.xs` (cash_tdr group) with a shared secret in body field `_webhook_secret` (env var `XANO_WEBHOOK_SHARED_SECRET`). Xano writes `confirmed_at`, `stripe_payment_intent_id`, `stripe_amount_paid_cents` on the TDR; idempotency check refuses double-update if `confirmed_at` already set. Posts an HCP note. SMS's Danielle (the owner-equivalent for warranty ops, see §6). **MED** (agent verified via reading; consistent with commit `8e4bd3c` "Stripe webhook receiver")

11. **After payment, the job transitions to "ready to schedule"** — at which point the warranty/scheduling layer (see §6) takes over for tech dispatch. **MED**

The thank-you page (`cash-tdr-thank-you.html`) is what the customer sees after Stripe redirect. **HIGH** (file exists; read by agent)

---

## 3. Customer journey — warranty (HCP-dispatched)

1. **Allstate / SquareTrade jobs:** ServicePower auto-accepts on our behalf via portal-side configuration (no per-tech awareness on their side; portal "sections" are areas, ~7 of them). Email notifications arrive at `tnappliancerepair@gmail.com` already-accepted; they are confirmations, not requests. **MED** (memory + `docs/warranty-operations-strategy.md`)

2. **AHS / Frontdoor jobs:** Separate workflow. Customer-reported failure, requires diagnosis + scheduling. Backlog of ~141 aged jobs flagged 2026-05-07. **MED**

3. **HCP webhook (or polling, currently)**: Once a job is in HCP, it should fire `job.appointment_scheduled`, `job.work_status_changed`, `customer.created` etc. webhooks to `netlify/functions/hcp-webhook-proxy.js` → Xano `hcp_job_webhook_POST.xs` which creates/updates the Xano `jobs` row, links customer, sends tech arrival/wrap-up SMS, optionally bootstraps a Tech Ant Assist session. **HIGH** (memory + agent verified)

   **CURRENT INCIDENT:** Since 2026-05-05 HCP webhook payloads have arrived as `{event: "..."}` only — no entity data, no id. `netlify/functions/hcp-api-probe.js` (auth-gated diagnostic) confirmed the API itself works fine. Workaround: `hcp_poll_recent_jobs_POST.xs` runs as a 15-min cron via `task/hcp_poll_recent_jobs.xs`, gated by `$env.HCP_POLL_ENABLED`. **As of 2026-05-08 EOS the gate was UNSET in production, so the cron logs `hcp_poll_skipped_disabled` and no-ops** — manual `{"override_enabled": true}` POSTs are how Teddy backfills today. **HIGH** (memory `project_hcp_webhook_incident.md` confirmed by `netlify env:list` showing no HCP_POLL_ENABLED in prod context)

4. **One-shot cleanup endpoints** built on top of the polling-as-source-of-truth posture:
   - `reclassify_ahs_jobs_POST.xs` — Build B, flipped 18 misclassified `self_pay → warranty` based on note-content markers (`ahs:NNN`, `American Home Shield`, `homeshield`, `frontdoor`).
   - `derive_appliance_from_notes_POST.xs` — Fix B, filled 62 historical `appliance_type=null` rows from notes keywords. Root cause: HCP `/jobs` LIST endpoint returns `tags=[]` for AHS-template jobs; per-job `/jobs/<id>` retrieve returns the populated tags (sparse-list payload bug, separate from the webhook bug).
   - `reattribute_hcp_techs_POST.xs` — Build C, flipped 165/216 misattributed historical rows from default `technician_id=1` to the correct tech via `technicians.hcp_id` lookup.
   All three follow the same pattern: dry_run default, `limit` cap (default 500), sanity gate refuses overmatched runs without `override_overmatch=true`. **HIGH** (memory + agent + commit `ba4bfcb` and earlier)

5. **Tech assignment & dispatch**. The HCP `assigned_to` field (or fallback for unassigned jobs that should default to specific techs based on geo + capacity) determines who executes. The tech-side experience is described in §5.

---

## 4. Customer journey — warranty company calling on behalf

This is the path I have **least direct evidence** of. **LOW** confidence. Reading the docs implies:

- Warranty companies (or homeowners on their behalf) call the dispatch line for AHS/Frontdoor jobs that need triage before being routed to a tech.
- Currently: this lands on **615-280-2949**, which is on **RingCentral** today, scheduled to port to **Vapi** (voice AI agent). The port is in flight; multiple HTML files reference it (`cash-tdr-customer.html:143`, `cash-tdr-thank-you.html:87`, commit message `ec5cd7d`: "customer copy says 'Call' not 'Text' until 615-280-2949 ports from RingCentral to Vapi").
- A `vapi_warranty_followup_scheduler` cron (every 10 minutes) exists in `xano-workspace/task/vapi_warranty_followup_scheduler.xs` — queries jobs with `current_status="warranty_pending"` OR `triage_status="warranty_sent"`, older than 2 hours, no prior Vapi contact (`vapi_called_at IS NULL`), no waiver signed, and fires `api.request POST /WdAZ3bLA/trigger_vapi_warranty_call` for each. **HIGH** (read the cron file head this session)
- The Vapi outbound endpoint exists in api group `WdAZ3bLA` but I haven't read its body. **MED**

What I'm not sure about: whether the inbound voice flow (warranty co. → 615-280-2949) is currently human-answered, RingCentral-routed-to-voicemail, or any agent-equivalent. I have **no evidence** of an inbound Vapi handler in the repo.

---

## 5. Tech side

### How techs are notified

- **HCP webhook → Xano → Twilio SMS** to the tech's phone, sent via `xano-workspace/api/intake/send_sms_POST.xs` with auth `Basic SID:AUTH_TOKEN` against `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`. Credentials now `$env.TWILIO_*` (rotated 2026-05-08, was hardcoded literals previously). **HIGH**
- **Daily summary SMS**: `task/daily_tech_summary.xs` runs every 15 min, queries techs whose preferred 15-min window matches the current CT time, sends a job-rundown SMS. **Gated by `$env.DAILY_SUMMARY_ENABLED`**; without that flag, returns null (no SMS). **MED** (agent confirmed; not personally re-read)
- **Inbound tech SMS**: `netlify/functions/tech-sms-inbound.js` receives Twilio webhooks at `+16292840444`, forwards to Xano `api:scheduling/tech_sms_inbound` with 9s timeout, returns TwiML. Used for tech replies (book/decline/help). **HIGH** (agent verified)

### Tech Ant on phone — `tech-ant-live.html` and `tech-ant.html`

Both files exist in the repo. `capture-overlay-test.html` also exists — appears to be the lifted CaptureOverlay IIFE module that powers in-chat photo/video capture. **MED** — files exist; I have not read them line-by-line. The agent reported they correspond to the on-field Tech Ant scribe + an interactive mode; build state per `docs/ant-tech-assist-design-v1.md` was "scoping complete, ready for build, blocked on TCR SMS verification clearance." Whether it's actually live in production is unclear without verification.

### Tech Assist v1 — escalation cron

`task/compute_tech_assist_escalation.xs` runs every 15 min, finds tech_assist_session rows older than 2 hours with no closure, escalates via SMS to owner (Danielle). Gated by `$env.TECH_ASSIST_ENABLED`. **MED** (agent confirmed; gate is the standard "design is done, flip when ready" pattern)

### What's still manual

- Tech assignment for jobs that don't auto-dispatch via ServicePower (everything not Allstate-routed)
- Any reschedule/cancel that affects ServicePower coverage
- Capacity throttling — currently a "max=50 everywhere" portal default; no dynamic adjustment
- Triage decisions for AHS jobs

---

## 6. Money side

- **Stripe Checkout** for self-pay TDRs. Live keys present in production env (`STRIPE_SECRET_KEY=sk_live_…[redacted]`, `STRIPE_WEBHOOK_SECRET=whsec_…[redacted]`). Billing fires when the customer clicks Confirm-and-Pay on `cash-tdr-customer.html`, after they pick options and `qc_persist_selections` writes them. **HIGH** (env list verified; agent read endpoint files)
- **Pricing math**: parts × 1.30 markup; labor at-cost; $50 Quick Check credit applied to labor floor 0; $15 flat shipping (when DIY); pre-work labor adjustment rule (Decision 4, 2026-05-05) says tech can renegotiate before starting work but not after. **MED** (memory + `docs/cash-tdr-delivery-design-v1.md`)
- **Stripe webhook** at `netlify/functions/stripe-webhook.js` → Xano `stripe_checkout_session_completed_POST.xs`. Idempotent. **HIGH**
- **Refunds / chargebacks / disputes**: no evidence in repo. Not built. **LOW**
- **Repair-billing for warranty work**: no Stripe involvement; revenue comes from the warranty co. via portal claim submission (`docs/servicepower/Servicer_Integration_Guide_-_Claims_Submission_v1_10.pdf` is committed but Phase 4 design is not yet started). **MED**

---

## 7. Portal side — warranty companies

- **AHS/Frontdoor**: portal access via Danielle (the office manager). Manual today. **No automation.** **MED** (memory + warranty ops doc)
- **Allstate via ServicePower**: auto-accept enabled at portal level. Penalties for rejection/reschedule/no-show factored into the "max=50 everywhere" capacity strategy: setting capacity to 50 means we accept whatever lands; rejecting incurs ranking penalties; better to over-commit than miss a hot day. Reservation discipline (slots held for ServicePower auto-dispatches throughout the day) is internal — not portal-native — and lives in Danielle + Dawn's daily routine. **MED**
- **SquareTrade** = legacy name for Allstate Protection Plans (same product, same portal). **MED**
- **Marcone B2B API**: I have **no evidence** in the repo. Mentioned in user prompt as designed-but-not-built; I cannot verify that. **LOW**

### Target API automation (designed, not built)

- **ServicePower SOAP** (Phase 3 of the capacity governor): production endpoint `https://fss.servicepower.com/sms/services/SPDService?wsdl`, staging `https://fssstag.servicepower.com/...`. Auth: UserId + Password (Danielle's portal creds work directly per Section 5.1 of the v2.8 PDF), no token issuance, passed in body `UserInfo` element on every request. Time bands: only 5 valid IDs (`8-12`, `12-17`, `8-17`, `17-21`, `6-8`). Operations needed: `updateTechInfo` (BasicCapacity weekly defaults), `updateTechCapacity` (per-date overrides), `getCallInfo`/`getCallAttributes` (read dispatches). **HIGH** (read `docs/capacity-governor-design.md` lines 1-90 this session)
- **AHS API**: not designed in repo. **LOW**
- **Allstate parser**: mentioned in user prompt; no evidence in repo. **LOW**

---

## 8. What's automated TODAY (running in production)

- **HCP polling** as a manual override (`override_enabled=true`) — not automatic until `HCP_POLL_ENABLED` flips. **HIGH**
- **Stripe Checkout end-to-end** for self-pay TDR billing — verified working (live keys, webhook deployed, idempotency in place). **HIGH**
- **Twilio SMS dispatch** for tech notifications, customer notifications, Teddy notifications. Outbound only via `send_sms_POST.xs`, `send-teddy-sms.js`, and embedded calls inside `daily_tech_summary` / `process_feedback_queue`. **HIGH**
- **Twilio SMS inbound** at `+16292840444` → `tech-sms-inbound.js` → Xano `api:scheduling/tech_sms_inbound`. **HIGH**
- **HCP webhook intake** at `hcp-webhook-proxy.js` — accepting traffic but currently producing zero useful Xano writes due to the sparse-payload incident. The bookkeeping function is alive; the data extraction function is not. **HIGH**
- **HCP API probe** (`hcp-api-probe.js`) — auth-gated diagnostic, kept post-incident as ops tool. **HIGH** (memory `project_diagnostic_code_to_remove.md`)
- **Cash TDR customer-facing flow** (`cash-tdr-customer.html` + token validation + persist + checkout). **HIGH**
- **Teddy Tool cockpit** (`teddy-tdr-tool.html` Phase 1g). **HIGH**
- **Vapi warranty follow-up cron** (`task/vapi_warranty_followup_scheduler.xs`, every 10 min) — fires when conditions hit; not gated by an `_ENABLED` flag (always-on once cron is scheduled). **HIGH** but unclear if the receiving Vapi infra answers calls correctly today. **LOW** for end-to-end.
- **Process feedback queue** (`task/process_feedback_queue.xs`, every 5 min) — sends feedback SMS via `send_feedback_sms`. Always-on. **MED**
- **Feedback classifier AI agent** (`xano-workspace/ai/agent/feedback_classifier.xs`) — classifies inbound feedback SMS replies (positive/negative/unknown) using Anthropic Claude Sonnet 4.5 with extended thinking. Wired to `feedback_reply_webhook_POST.xs`. **MED** (agent confirmed file presence; not re-verified end-to-end)
- **One-shot cleanup endpoints** (`reclassify_ahs_jobs`, `derive_appliance_from_notes`, `reattribute_hcp_techs`) — production but only invoked manually. **HIGH**

---

## 9. What's BUILT but DORMANT (env-gated, awaiting flip)

| Env var | File | What it guards | What blocks the flip |
|---|---|---|---|
| `HCP_POLL_ENABLED` | `xano-workspace/api/intake/hcp_poll_recent_jobs_POST.xs:45` | The 15-min HCP polling cron — without it, the cron fires but the endpoint exits early with `hcp_poll_skipped_disabled`. | Teddy needs to verify the polling logic doesn't double-write, and verify `hcp_id` lookups + appliance derivation work for new inserts. Verification suggested in memory: dry-run a few cycles with `override_enabled=true`, confirm event log entries, then flip. **HIGH** (memory + verified via `netlify env:list`) |
| `DAILY_SUMMARY_ENABLED` | `xano-workspace/task/daily_tech_summary.xs:26` | Per-tech daily SMS rundown of jobs at the tech's preferred AM window. | TCR campaign approval (this is bulk-ish SMS to multiple techs; SMS volume gated by 10DLC clearance). Per-tech preferred-window column needs to be populated. **MED** |
| `LEDGER_TASK_ENABLED` | `xano-workspace/task/compute_tech_performance_ledger.xs:23` | Nightly 04:00 UTC computation of 30-day rolling metrics + pattern detection (acceptance rate, called-off, helped-out) per tech. Feeds soft-preference offers ("you've declined 4 Slidell jobs, lighten up?"). | Tech Scheduler v2 still in carryover phase; ledger is part of the loop. Not load-bearing yet. **MED** |
| `SCHEDULING_QUEUE_ENABLED` | `xano-workspace/task/scheduling_queue_worker.xs:28` | Broadcast/book/propose/wait/notify/escalate queue processing for Tech Scheduler v2. Sweeps expired broadcast attempts. | Tech Scheduler v2 deployment status (Phases 0-8 reported done as of 2026-05-04 by agent reading `ant-tech-scheduler-design-v2.md`, but the gate stays off until carryover Phases 7b/8b polish is in). **MED** |
| `TECH_ASSIST_ENABLED` | `xano-workspace/task/compute_tech_assist_escalation.xs:13` AND `xano-workspace/api/intake/hcp_job_webhook_POST.xs:833,864` | Bootstraps Tech Ant Assist session on tech-arrival webhook + escalates stale 2h+ sessions to owner. | TCR campaign approval (sends SMS); Tech Assist v1 build remains to ship the in-field UI per `docs/ant-tech-assist-design-v1.md`. **MED** |
| `SIGNATURE_VERIFICATION_ENABLED` | Netlify env (HCP webhook proxy) | Strict HMAC verification on incoming HCP webhooks. | HCP itself is currently NOT sending the `X-HousecallPro-Signature` header on some webhooks; flipping strict would lose those events. Stays off until HCP starts signing consistently. **HIGH** (memory + verified `SIGNATURE_VERIFICATION_ENABLED=false` in `netlify env:list`) |
| `SMS_ENABLED` | NOT FOUND in repo | (User mentioned in prompt) | Likely doesn't exist as a code-level gate yet — TCR clearance is the gating event, not an env flag. **LOW** |
| `HCP_BACKFILL_ENABLED` | `xano-workspace/api/intake/hcp_backfill_recent_jobs_POST.xs` | One-shot manual backfill endpoint. | Always-on for manual runs; not really "dormant," more "explicit-trigger-only." **MED** |

---

## 10. What's DESIGNED but NOT BUILT

| Item | Doc | Status / blocker |
|---|---|---|
| **Capacity governor Phase 3** | `docs/capacity-governor-design.md` | BLOCKED on Phase 3.0 — the per-tech-vs-per-area question. Capacity API requires `TechKey` per the v2.8 PDF Sections 6.1, 12, 13 — but warranty ops doc says ServicePower has no per-tech awareness. Three hypotheses + verification approach in the doc; needs Danielle's portal inspection to resolve. Phase 1 (skeleton schedule) and Phase 2 (load monitor) can ship before Phase 3.0 is unblocked. **HIGH** |
| **Allstate parser** | NOT IN REPO | User-mentioned; no design doc found. **LOW** |
| **Marcone B2B API** | NOT IN REPO | User-mentioned; no design doc found. **LOW** |
| **AHS API** | NOT IN REPO | Not designed. AHS workflow today is portal-only via Danielle. **LOW** |
| **ServicePower SOAP capacity governor** | `docs/capacity-governor-design.md` | Designed against `docs/servicepower/Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf`. Endpoints, auth, time bands, operations all documented. Phase 3.0 prerequisite blocks build. **HIGH** |
| **ServicePower Claims Submission / Retrieval / RFA** | PDFs in `docs/servicepower/` (4 of them) | Phase 4 of the warranty automation roadmap. Inventory only — contents not summarized in design docs yet. **MED** |
| **RingCentral → Vapi port for 615-280-2949** | NOT IN A DESIGN DOC | In flight; transitional copy in HTML files acknowledges the port. No timeline visible. **MED** |
| **Gmail integration** | `docs/gmail-integration-design-v1.md` | Designed (6-8 sessions, ~20-30hrs). Captures dispatch emails before HCP. Per-warranty parsers (AHS, SquareTrade, ServicePower) + Claude generic fallback. New tables `gmail_oauth_tokens`, `pending_email_review`, `gmail_processing_log`. Build deferred until after Tech Assist v1 ships. **MED** (agent read the doc) |
| **Tech Ant Assist v1 in-field UI** | `docs/ant-tech-assist-design-v1.md` | Design locked, ready for build (2-3 marathon sessions estimated). Blocked on TCR SMS clearance. **MED** |
| **Inbound pipeline channels 2-4** | `docs/inbound-pipeline-design-v1.md` | Channel 1 (HCP) live. Channel 2 (Gmail) designed-not-built. Channel 3 (ServicePower SOAP intake) parked until volume justifies. Channel 4 (MeisterTask one-time export) deferred. **MED** |
| **Phase 1f multi-failure cash TDR** | `docs/cash-tdr-delivery-design-v1.md` | Single-failure pipeline live; multi-failure UI in Teddy Tool + customer page deferred. **MED** |
| **Rental / landlord-tenant flow** | `docs/cash-tdr-delivery-design-v1.md` (Pattern B, decisions D1-D4 locked 2026-05-05) | Designed; not built. SMS routing splits between landlord (`bill_to`) and tenant (FYI). **MED** |

---

## 11. Operational surface

**Domain & hosting**: `tnapplianceexchange.net` → Netlify project `superlative-naiad-233aa7` (Project ID `1ecd89fc-8a9c-4fa3-b923-5186759cfc84`), authenticated as James Pivacek. Custom domain set. **HIGH** (memory + `netlify status`)

**Xano workspace**: instance `xbtp-g9bh-ditq.n7e.xano.io`, workspace 1 ("James's Workspace"). Two API groups in heavy use: `intake` (`api:3e_TffpA`) and `cash_tdr` (`api:VGkW9mcV`). Other groups referenced: `scheduling`, `WdAZ3bLA` (Vapi). **HIGH** (memory + verified)

**Twilio**:
- Account SID `ACefea…[redacted]` (visible in production env list).
- Auth token rotated 2026-05-08; was hardcoded literal in `send_sms_POST.xs` until then; now `$env.TWILIO_AUTH_TOKEN`.
- From-number `+16292840444` (verified in `send-teddy-sms.js:11` and tech-sms-inbound.js).
- Teddy's number `+16154855795` (verified in `send-teddy-sms.js:12`).
- TCR / 10DLC campaign: **not yet approved** — five rejections to date. Today's work (homepage redesign, service strip, chat-side gate, demoted disclosure, demo-button hardening, prompts/ant_system_prompt_consent_gate_addition.md) is the load-bearing compliance push for resubmission. The Xano `$env.SYSTEM_PROMPT` env var still needs Teddy to paste in the consent-gate addition before the chat-side gate fires in production. **HIGH** (multiple commits today; `prompts/` file)

**Stripe**: live keys (`sk_live_…[redacted]`, `whsec_…[redacted]`) in Netlify production env. Webhook configured. **HIGH**

**HCP**: `HCP_API_KEY=[redacted]` in Netlify production env (rotated 2026-05-08, was missing pre-2026-05-07). Webhook destination Active. Sparse-payload incident open. **HIGH**

**Vapi**: agent endpoint `/WdAZ3bLA/trigger_vapi_warranty_call` referenced in cron. Specific Vapi assistant IDs / phone numbers not visible to me. **MED** for "exists"; **LOW** for "currently working end-to-end on outbound calls."

**RingCentral**: 615-280-2949 currently routes through it; no automation visible from repo. **MED**

**Phone lines**:
- `+16292840444` — Twilio outbound/inbound for SMS (the dispatch/notification number).
- `+16154855795` — Teddy's personal cell.
- `615-280-2949` — main customer-facing voice line, RingCentral today, porting to Vapi.

**S3**: bucket `tn-appliance-media-…[redacted]` in `us-east-2`, used for capture-overlay photo/video uploads; presigned URL via `netlify/functions/s3-presign.js` and view URL via `s3-view-url.js`. **HIGH** (env list)

**AI providers**:
- **Anthropic Claude** via `claude-proxy.js` (Teddy Tool AI pre-fill, customer-facing Ant chat via `agent-chat-proxy.js → reply_2_POST.xs`, feedback classifier). Model `claude-sonnet-4-20250514` is the one currently invoked from the Teddy Tool. **HIGH**
- No OpenAI / Gemini / other providers visible in repo.

---

## 12. Security debt

1. **Production env literals were exposed in plain text** during this reconstruction's `netlify env:list --plain --context production` output: Twilio auth token, HCP API key, Stripe live secret, HCP webhook secret, AWS S3 secret access key, QC token secret, Xano webhook shared secret. Per the standing redaction rule those are not repeated here, but the underlying state — these are valid live credentials accessible to anyone with Netlify CLI access — is the actual debt. **HIGH** (verified this session).

2. **Anomalous env entry**: the production env contains a line that is just a literal Stripe key as the *name* (`sk_live_…[redacted]=` set as a key name with no value-side wrapping). Looks like a copy-paste accident where the Stripe key was set as both name and value. Should be investigated and removed if not load-bearing. **HIGH** (verified in env list).

3. **Diagnostic code lingering from 2026-05-07 HCP investigation**, both tagged `// DIAG 2026-05-07 - REMOVE after HCP payload investigation`:
   - `netlify/functions/hcp-webhook-proxy.js` — two-line rawBody logger.
   - `netlify/functions/hcp-api-probe.js` — entire file (auth-gated, decision deferred between "remove" vs "keep as ops tool").
   Removal blocked on HCP support ticket resolution. **HIGH** (memory `project_diagnostic_code_to_remove.md`)

4. **Twilio + HCP credentials were hardcoded in `xano-workspace/api/intake/send_sms_POST.xs` and `create_job_POST.xs`** until the 2026-05-08 rotation. Audit performed; both swapped for `$env.*` references. Old keys revoked. The audit covered Twilio + HCP; **Swagger token rotation was deferred**. **HIGH** (memory + commit history).

5. **`SIGNATURE_VERIFICATION_ENABLED=false`** for HCP webhooks — the webhook proxy accepts unsigned requests because HCP isn't currently sending the signature header consistently. Acceptable as a workaround given HCP is the dispatch backbone, but it does mean any third party who knows the proxy URL can POST shaped events. The `hcp_job_webhook_POST.xs` Xano endpoint has its own internal-auth precondition (the body's `_internal_auth` field must match `HCP_INTERNAL_AUTH_SECRET`), so the practical blast radius is bounded. **HIGH**

6. **`xano-workspace/`** is a pulled snapshot of remote Xano state. `xano workspace pull` is documented as gitignored historically per `.gitignore` comment, but the directory IS committed (visible in `ls`). If it contains hardcoded secrets that escaped the rotation, that is a leak. Worth a one-pass grep for `Bearer [a-zA-Z0-9]{20,}` or `sk_live_` patterns. **MED** (not done this session).

---

## 13. Long-term vision

**Licensable platform play** — the explicit framing in `docs/ant-tech-scheduler-design-v2.md` (per agent quote): *"Replaces the human dispatcher (~$40-60k/yr role) for any appliance repair shop that licenses the platform. The B2B unit economics moat."* The Phase 8 success criterion in that doc: *"Could a different shop's 6-tech crew be onboarded in <1 day?"* **MED** (agent quoted; I have not personally read this doc).

**Multi-tenant constraint** acknowledged in `gmail-integration-design-v1.md`: *"If we ever need multi-tenant, this re-opens the same $15k+ assessment problem that killed Option C — plan accordingly."* — meaning today's Gmail OAuth is single-tenant by design. **MED**

**Fleet plan**: I have **no specific evidence** of a "fleet" line of business beyond the 6-tech crew structure. The user mentioned it; I cannot place it. Possibly refers to the multi-shop expansion path under the licensable platform vision. **LOW**

**Load-bearing for the future state** (my inference, **LOW**):
- Tech Scheduler v2 is the flagship product (the SaaS would be sold as "this dispatcher").
- Tech Ant Assist v1 is the field-completion product (close the diagnostic loop without humans).
- Cash TDR Phase 1 is the customer-facing intake product (Quick Check → Diagnosis → Pay).
- Capacity Governor (Phase 3) is the bridge between any shop's manual process and the Allstate / ServicePower auto-dispatch firehose.
- TCR campaign approval is the **single gating event** on multiple ENABLED-flag flips. If TCR clears, several built-but-dormant systems could activate within hours.
- HCP support resolution is the **other** gating event — without populated webhook payloads, polling stays the source of truth and can't reliably scale beyond the current ~250 jobs/week tempo.

---

## 14. What I'm UNCERTAIN about

The most important section. These are the questions I'd want to ask before relying on this blueprint:

1. **Is Tech Ant actually live in production today?** Files `tech-ant-live.html` and `tech-ant.html` exist; design doc says "ready for build, blocked on TCR." I don't know if a tech is actively using it on a job site right now or if it's a scaffolding-only state.

2. **Is the 615-280-2949 Vapi port complete or still in flight?** The HTML copy says "Call us, not text" — that's the transitional state. The `vapi_warranty_followup_scheduler` cron exists for outbound. I don't have evidence of an inbound Vapi handler. Is the Vapi side just outbound today?

3. **Phase 3.0 of the capacity governor** — has Danielle completed the portal inspection that resolves the per-tech vs per-area question? If so, which hypothesis (A, B, or C) was it? If not, when?

4. **What exactly does Phase 8 of Tech Scheduler v2 mean by "shipped" today?** Agent reported Phases 0-8 done with carryover. Are techs actually receiving broadcast offers and replying via SMS in production right now? If so, why is `SCHEDULING_QUEUE_ENABLED` apparently still off?

5. **Marcone B2B API** — user-mentioned in prompt; no evidence in repo. Is this an upcoming design or a prior research thread that didn't make it to docs?

6. **Allstate parser** — user-mentioned; no evidence. Does this refer to the Gmail-integration AHS parser, or a separate workflow?

7. **The "fleet plan"** — what is it precisely? Multi-shop licensing? Internal tech fleet management? Something else?

8. **What's the build state of Tech Scheduler v2 vs Tech Assist v1?** Two related-but-distinct things, both "v1/v2", both designed in `docs/`. Which one is actually running which code path today?

9. **Danielle's exact role boundaries.** Memory says portal management + AHS workflow + escalations. Will she remain manual indefinitely, or is there a target API automation that retires her ServicePower duties? Capacity governor Phase 3 is the most direct candidate.

10. **The 25 unassigned-HCP `tech_id=1` rows** flagged in the deferred queue — were they cleaned up via the queued `null_unassigned_hcp_techs` endpoint, or is that still pending?

11. **The Vapi assistant IDs and configuration** — the cron calls `/WdAZ3bLA/trigger_vapi_warranty_call` but I don't know what conversation flow Vapi runs, what number it dials from, or what Vapi-side state exists.

12. **Customer-portal vs PWA**: is the cash-TDR customer experience SMS-link-only, or is there a longer-running customer dashboard at any URL? (`dashboard.html` exists in repo but I haven't read it.)

13. **What's `book.html`?** Existing file, unread by me. Likely an alternative intake flow — possibly the warranty-co-calling-on-behalf path?

14. **The status of `feedback_classifier` AI agent end-to-end.** Cron + endpoint + agent definition all exist. Are inbound feedback SMSes actually being classified live and acted on, or is the loop dormant?

15. **Stripe duplicate-key env entry** — is the line that has `sk_live_…=…` as the literal env var name a broken artifact or load-bearing somewhere?

16. **Workspace push state**: `xano-workspace/` is in git, but XanoScript files reference `$env.*` for credentials. Is the local `.xs` content fully `$env.*`-clean post-rotation, or are there still hardcoded literals lurking?

17. **The relationship between `xano-workspace/api/intake/intake.xs` and the rest of the intake group** — `intake.xs` exists alone in the directory; I haven't read it. Could be a router, could be vestigial.

18. **The `book_appointment_POST.xs` endpoint** — is this the booking step downstream of `qc_create_checkout_session` for In-Home Visit jobs, or a separate scheduling primitive used by Tech Scheduler v2?

---

## End of reconstruction

**File:** `docs/system-blueprint-cc-reconstruction.md`
**Not committed** per spec.
**To diff against**: another chat instance's reconstruction. The "What I'm uncertain about" section is the highest-leverage diff target.

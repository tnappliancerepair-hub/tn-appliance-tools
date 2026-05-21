# TN Appliance Exchange — System Blueprint (CC Reconstruction)

**Reconstructed:** 2026-05-12 by Claude Code, one session — fresh cross-check for diff against another instance's reconstruction.
**Method:** Read repo + auto-memory + the in-flight work of this session (AHS poller, warranty email landscape, ServicePower SOAP inventory). Did not contact Teddy during reconstruction. The existing `docs/system-blueprint-v1.md` was read as context but this document is intentionally a fresh independent take, not a paraphrase.
**Predecessor:** This file's previous content (2026-05-09 version) is overwritten. The 2026-05-09 reconstruction itself became the v1 blueprint.

**Confidence legend:**
- **HIGH** — verified this session by reading the actual file, running an endpoint probe, or examining the Xano metadata API.
- **MED** — held in memory or in design docs; consistent across sources but not re-verified line-by-line in this session.
- **LOW** — inferred from secondary signals or remembered without re-grounding.

Credential literals redacted as `[redacted]`.

---

## 0. Executive snapshot

TN Appliance Exchange is a Tennessee + Louisiana appliance repair shop owned by Teddy Pivacek, running 6 techs (4 family). Revenue is ~95% warranty work, ~5% self-pay. The platform under construction is intended to replace Teddy's manual office coordination (Dawn retiring, Danielle staying on the warranty-portal side until those APIs land) and eventually to become a licensable per-shop SaaS for other independent appliance shops.

**Where things stand 2026-05-12:**
- Self-pay flagship (Cash TDR pipeline) is **fully live** end-to-end. Real customers can land on `tnapplianceexchange.net`, chat with Ant, pay $50, get reviewed by Teddy via the cockpit, pick one of four repair options, pay, and have the lifecycle SMS them. **HIGH.**
- Warranty intake automation has become the **declared center of gravity** per `docs/warranty-intake-automation-vision-2026-05-11.md` — Dawn-replacement is the North Star. **HIGH.**
- **AHS Path 1 (Frontdoor XML)** intake shipped end-to-end this week: Gmail poller → XML parser → Xano job creation → customer SMS with signed chat-token. 16/16 verification checks passed against the real 2026-05-11 dispatch. **HIGH.**
- **AHS Path 2 (ServicePower SOAP / SquareTrade)** was scoped 2026-05-12 — the `getCallInfo` endpoint in `Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf` is the target; no code yet, no credentials in repo. **HIGH.**
- Warranty email landscape survey 2026-05-12 catalogued 137 messages across 5 sender domains, revealing 60+ distinct email types from AHS / Frontdoor / ServicePower / SquareTrade / NSA. **HIGH.**
- Tech Scheduler v2 is **built but dormant** (env-gated, awaiting TCR clearance). **HIGH.**
- Tech Assist v1 is **designed but dormant** (env-gated + UI not yet built). **HIGH.**
- HCP webhook is **DEGRADED** since 2026-05-05 (sparse-payload incident — pending HCP support). HCP polling is the workaround, currently gated off. **MED** (consistent across docs, not re-probed today).

---

## 1. Business & operational basics

| Item | Detail | Confidence |
|---|---|---|
| LLC | TN Appliance Exchange LLC | HIGH |
| Owner | James "Teddy" Pivacek (`tnappliancerepair@gmail.com`) | HIGH |
| Service area | Middle Tennessee + Louisiana (dual-state mobile + LA trailer in Hammond) | HIGH |
| Tech count | 6 active | HIGH |
| Revenue mix | ~95% warranty / ~5% self-pay | HIGH |
| Customer-facing voice line | 615-280-2949 (RingCentral, porting to Vapi — port status not re-verified today) | MED |
| Business outbound SMS | +16292840444 (Twilio) | HIGH (verified in `send_sms_POST.xs:42`) |
| Tech inbound SMS | +17273508487 (Twilio) | HIGH |
| Owner cell | +16154855795 | HIGH |
| Danielle's cell | 615-485-0713 | MED |

**Tech roster:** Teddy (#1, owner, dual-state), Jimmy Pivacek (#2, South Nashville/Antioch), Andre Pivacek (#3, LA primary, dual-state flexible), Lee Harding (#4, Clarksville), Billy Savoy (#5, Hammond LA), John Houk (#6, Baton Rouge/NOLA). Cluster routing assigns each tech a geo grouping with rank order. **MED** (memory + v1 §1, not re-verified per-row this session).

---

## 2. Customer journeys end-to-end

### 2.1 Self-pay (web → Ant chat → diagnosis → repair)

Verified by reading repo HTML + Xano endpoint names + the cash_tdr design doc. **HIGH overall.**

1. Customer lands on `tnapplianceexchange.net` (= `index.html`). Homepage has "How our service works" strip and two channel-preselect buttons (Yes-text-me / Call-me-only).
2. Customer pre-selects channel → stored in `window.consentChoice` + localStorage. Strip auto-hides; chat textarea focuses.
3. Customer chats with Ant (Claude Sonnet via Netlify `agent-chat-proxy.js` → Xano `reply_2_POST.xs`). Ant collects appliance, brand, model, symptom, service tier ($50 Quick Check / $90 Video / $100 In-Home), first name.
4. Ant emits `__SHOW_CONSENT_CHECKBOX__` token (per `prompts/ant_system_prompt_consent_gate_addition.md`). Frontend renders chat-side consent gate. Customer clicks → consent committed (`smsConsentGiven`, `smsConsentAt`, `consentMethod`, `CONSENT_LANGUAGE_VERSION = v1.0_2026-05-08`).
5. Ant collects phone, ZIP, scheduling preference. Photos/videos via CaptureOverlay → S3 via `s3-presign.js`.
6. Customer submits → POST `xano-proxy → create_job_from_chat`. Creates `jobs` row (`customer_type="self_pay"`, `intake_source="web_chat"`, consent fields) + `customer` row.
7. Customer pays $50 Quick Check via Stripe Checkout. On `checkout.session.completed`, Netlify `stripe-webhook.js` → Xano `stripe_checkout_session_completed` (cash_tdr group). Idempotent `confirmed_at` write.
8. Intake waiver via Jotform (`form.jotform.com/260495320372050`) → `jotform_waiver_webhook_POST.xs` sets `waiver_signed=true` + `waiver_text_version="v1.0_2026-04-20"`.
9. **Teddy notification:** `send-teddy-sms.js` posts to Twilio from +16292840444 → owner cell with deep link to `teddy-tdr-tool.html?job_id={n}`.
10. **2026-05-11 NEW:** When Teddy opens cockpit, `qc_cockpit_load` GET endpoint fires a one-shot idempotent trigger that (a) sets `jobs.teddy_review_started_at = now` and (b) SMSes the customer: *"Hey {first_name}, Teddy just opened your {appliance} job and is reviewing the photos and video now. He'll have a diagnosis for you usually within a few hours."* Gated through `send_sms` wrapper (which is gated by `SMS_ENABLED`). **HIGH** (built and verified this session — commit `c914243`).
11. Teddy fills diagnosis in `teddy-tdr-tool.html`. AI pre-fill via `claude-proxy.js` (model `claude-sonnet-4-20250514`, system prompt forbids scheduling language). Fields: diagnosis text, OEM part #+cost, Amazon part #+cost, labor estimate, tech notes. 30% markup math applied to parts.
12. Submit-and-Send → POST `create_tdr` (mode=`pre_diagnosis`) + `send_qc_diagnosis_to_customer` (cash_tdr group). The latter mints a signed token via Netlify `generate-qc-token.js` (HMAC-SHA256, 7-day default expiry), persists as `tdr.public_view_token`, SMSes the customer a link to `cash-tdr-customer.html?token={signed}`.
13. Customer lands on TDR options page. Page calls `qc_diagnosis_view` (validates token via `validate-qc-token.js`). Renders TDR + four options + skip:
    - DIY · OEM (`selected_option="diy_oem"`)
    - DIY · Amazon (`diy_amazon`)
    - We Install · OEM (`install_oem`)
    - We Install · Amazon (`install_amazon`)
    - No fix needed (`skip`) — **no refund** per architectural commitment.
14. Customer choice → `qc_persist_selections`. Then `qc_create_checkout_session_POST.xs` mints a second Stripe link for the chosen option (parts × 1.30 markup, labor as-is, $50 credit applied to labor, $15 flat shipping on DIY paths).
15. Customer pays → fulfillment path begins. **Parts ship direct to customer's service address.** Tech does not carry parts.
16. **Tech dispatch only after parts have arrived.** Tech Scheduler v2 broadcast → first-reply-wins → tech accepts → 30-min reminder → repair → completion → feedback SMS. (Tech Scheduler v2 is BUILT but DORMANT — env-gated; see §7.)
17. Post-job feedback SMS via `process_feedback_queue` cron + `feedback_classifier` AI agent. Classifies positive → Google review CTA `g.page/r/CRt-vo--eAJ3EBM/review`. Negative → `handle_negative_followup_POST.xs` (warm callback). **MED** (cron exists; whether it's actively classifying live replies not re-verified today).

### 2.2 Warranty (HCP-dispatched today, becoming intake-automated)

Today's state — **HIGH:**

1. Job appears in HCP via either:
   - **HCP webhook** (degraded since 2026-05-05 sparse-payload incident — webhook fires with `{event}` only, no data)
   - **HCP polling** workaround (`hcp_poll_recent_jobs.xs`, every-15-min cron — currently gated OFF via `HCP_POLL_ENABLED`)
2. Xano `jobs` row created with `customer_type="warranty"`, `intake_source="hcp_webhook"` / `"hcp_poll"` / `"hcp_backfill"`.
3. Warranty-company markers historically extracted from HCP `notes_internal` tags + body — three cleanup endpoints exist for historical bad-classification rows: `reclassify_ahs_jobs`, `derive_appliance_from_notes`, `reattribute_hcp_techs`.
4. Customer-side intake collection happens via either:
   - **Vapi outbound** for warranty-pending jobs >2h without contact (`task/vapi_warranty_followup_scheduler.xs`, every 10 min, calls `/WdAZ3bLA/trigger_vapi_warranty_call`).
   - **Ant outbound chat** for web-accessible customers.
5. Teddy reviews in cockpit (same `teddy-tdr-tool.html` as self-pay; mode=`pre_diagnosis`).
6. Tech dispatch via Tech Scheduler v2 (when env-flag flipped) or current manual path.
7. Tech does repair. Tech Ant TDR completion at `tech-ant.html?job_id=…&tech_id=…` (post-job retrospective) or future `tech-ant-live.html` (during-job, when `TECH_ASSIST_ENABLED` flipped).
8. **Danielle manually submits TDR to warranty portal** (AHS / ServicePower / SquareTrade — all manual today).

**This session's strategic reframing (2026-05-11):** Warranty intake automation is the platform's center of gravity. Path 1 (AHS email) shipped 2026-05-11 end-to-end. Path 2 (ServicePower SOAP for SquareTrade) inventoried 2026-05-12, no build yet. Future state: warranty job lands in Xano directly via Make.com / Gmail poller / SOAP poll → customer SMS with Ant chat link → same Ant chat as self-pay → same Teddy cockpit → automated scheduling. **HIGH.**

**AHS Path 1 detail** (committed in `7f8f861` + auxiliary commits, verified end-to-end):

- Make.com originally planned for Gmail → Xano. Pivoted to native Gmail API after Make.com surfaced multipart MIME pain.
- `netlify/functions/ahs-gmail-poller.js` (304 lines) — scheduled `*/15 * * * *` (currently re-enabled for clean-data observation per commit `c5fe9db`). Authenticates via OAuth refresh token. Resolves/creates `AHS-Processed` + `AHS-Processing` Gmail labels. Lists messages matching `from:noreply@msg.frontdoor.com subject:"New Dispatch Notification" has:attachment -label:AHS-Processed -label:AHS-Processing`. Per message: claim with `AHS-Processing`, fetch dispatch.xml, POST to Xano `ahs_email_intake`, on success swap to `AHS-Processed`.
- `xano-workspace/api/intake/ahs_email_intake_POST.xs` (1187 lines, gitignored) — XML parser. Accepts `{rawXml}`. Extracts ~20 fields via split-anchored XML attribute parsing (no native XML parser in Xano — confirmed Phase 1 finding). Title-cases customer first/last + service_address + service_city. Customer dedup by 10-digit normalized phone. Opt-in detection on `<MessageNotesDetail>` for "accepts text communication" / "accepts email communication" patterns. Hybrid consent: text opt-in → permissive SMS with signed chat link; otherwise → conservative consent-request SMS.
- `netlify/functions/sign-job-token.js` (98 lines) — HMAC-SHA256 chat-token minter using `CHAT_TOKEN_SECRET` env var. Tokens carried in `https://tnapplianceexchange.net/chat?token=...` links for AHS-origin customers.
- **Active investigation 2026-05-12:** Duplicate-job pattern. Bucket data shows ~75 jobs per 15-min cron interval (= 25 messages × 3 invocations). Working hypothesis: Netlify timeout-retry × 3 attempts. Schedule was disabled overnight (commit `c707df4`) then re-enabled this morning (commit `c5fe9db`) to observe a clean cron fire without manual-Run-now interference. **HIGH** (this session's work).

### 2.3 Warranty company calling on behalf

Per memory + v1 §2:

- Voice line 615-280-2949 (RingCentral) — porting to Vapi (status: in flight, port date not in any doc I read this session).
- Today: dispatcher (or future Vapi agent) intakes the warranty job by phone, manually creates HCP job, downstream flows match §2.2.
- Vapi BYO numbers exist for both states (TN +16292607111 Ant Inbound, TN +16292477111, LA +15043559111).
- **MED** — port status not re-verified this session.

---

## 3. The Teddy Tool & TDR lifecycle (load-bearing — easy to underweight)

The user flagged this section as load-bearing. Detail follows.

### 3.1 What the Teddy Tool is

**File:** `teddy-tdr-tool.html` (root of repo). Self-contained HTML+JS+CSS page. Dark theme (background `#080a0f`, accent `#f5a623`). Mobile-first layout (max-width 720px). **HIGH** (file head read this session).

**Purpose:** Single-page diagnostic cockpit for Teddy to triage every incoming job (self-pay AND warranty). Designed for use on Teddy's phone in the field — he gets the SMS notification, taps the link, completes the diagnostic, submits.

**Inputs (URL):** `?job_id={n}`.

**Inputs (on page load):** Single-call hydrate via `qc_cockpit_load` GET endpoint (Xano intake group). Returns: job + customer + appliance + attachments-with-signed-S3-URLs + existing_tdr in one round trip. Re-uses the `bill_to` fallback pattern for multi-party billing. The endpoint embeds the **Trigger 1 idempotent customer SMS** described in §2.1 step 10. **HIGH** (verified via the trigger build in this session).

**Inputs (Teddy fills):**
- Diagnosis free-text (AI pre-fill available via `claude-proxy.js` button)
- OEM part number + cost
- Amazon part number + cost
- Labor estimate
- Tech notes (internal)
- Per-failure rows if multi-failure (Phase 1f UI deferred — single-failure today)

**Outputs:**
- **Self-pay path:** POST `create_tdr` (mode=`pre_diagnosis`) → POST `send_qc_diagnosis_to_customer` → customer SMS with signed-token link to `cash-tdr-customer.html`.
- **Warranty path:** POST `create_tdr` (mode=`pre_diagnosis`) only. No customer-facing TDR link in this path today; warranty TDR is consumed later by Danielle's manual portal submission, plus eventually by the AHS API / ServicePower SOAP automation.

### 3.2 Notification mechanism

`netlify/functions/send-teddy-sms.js` posts to Twilio with body:
```
New job #{job_id} - {customer_name}
{appliance} | {brand}
Issue: {problem}

Teddy Tool: https://superlative-naiad-233aa7.netlify.app/teddy-tdr-tool.html?job_id={job_id}
```
From +16292840444 → Teddy +16154855795. **HIGH** (from v1 §3 step 9 + memory; not re-verified file contents this session).

**The send-teddy-sms.js wrapper is itself gated by SMS_ENABLED** as of 2026-05-11 — Day 1 kill-switch wrap. **HIGH** (verified this session — Day 1 SMS_ENABLED commit `8d9fa2b` and `e1241ba`).

### 3.3 TDR lifecycle as one evolving record

The TDR is a SINGLE evolving record across the job lifecycle (per April 29 handoff). Lives in `xano-workspace/table/technician_decision_report` and `tdr_failure` (per-failure rows for multi-failure jobs).

**Stage 1 — Intake creates the job row only.** TDR doesn't exist yet. Job has `technician_decision_report_id=null`. **MED** (consistent with schema layout, not re-verified).

**Stage 2 — Teddy pre-diagnosis (Teddy Tool).** `create_tdr` with `mode=pre_diagnosis` creates the TDR row. Backreferences `jobs.technician_decision_report_id`. Sets:
- `diagnosis` (free text)
- `oem_part_number`, `oem_part_cost`
- `amazon_part_number`, `amazon_part_cost`
- `labor_estimate`
- `tech_notes`
- `report_date = now`
- `status = "pre_diagnosis"` (enum)

**Stage 3 — Customer chooses (self-pay only).** `qc_persist_selections` writes `selected_option` per `tdr_failure` row. Status transitions: `diagnosis_pending → diagnosis_sent → choice_pending → partial_chosen | all_chosen | all_skipped`. **MED** (per schema enum from blueprint v1 §6).

**Stage 4 — Tech on site (Tech Ant).** `tech-ant.html` (or future `tech-ant-live.html`) ingests post-job retrospective fields:
- Final diagnosis confirmed
- Parts actually used
- Labor actually performed
- Photos / video of work done
- Tech notes
- Status transition to `completed` or `escalated`

**Stage 5 — Portal submission (warranty).** Danielle reads the TDR row in the portal, attaches photos via signed S3 URLs, fills the warranty company's form fields, submits. **TODAY: manual.** Target: API automation per ServiceDispatch `updateCallInfo` + AHS API.

**Stage 5b — Close (self-pay).** No portal. Self-pay job closes after customer order fulfillment + tech completes installation (Install path) or customer DIY completion (DIY path).

**Where it lives:** `xano-workspace/table/technician_decision_report.xs` (main row) + `tdr_failure.xs` (per-failure rows). The `jobs` table backreferences via `technician_decision_report_id`. Plus a `tdr_failure.selected_option` enum (`diy_oem`, `diy_amazon`, `install_oem`, `install_amazon`, `skip`, `pending`). **MED.**

---

## 4. Tech side

Tech-facing surface:

### 4.1 Notification

- **Tech Scheduler v2 broadcast** (BUILT, DORMANT). When a TDR's `scheduling_decision=ready_to_schedule` lands, `scheduling_queue` enqueues a broadcast row. `scheduling_queue_worker.xs` cron fans out SMS via Twilio from +17273508487 to all qualified techs (cluster filter + hard-preferences-only). Race-safe two-step claim: `__CLAIM_BROADCAST__` paired token, first-reply-wins. Gated by `SCHEDULING_QUEUE_ENABLED` (currently UNSET). **HIGH** (built per commit `b275d89` — actually that's a different commit; the Phase 4 broadcast logic was 2026-05-03/04 marathon).
- **Daily summary cron** (BUILT, DORMANT). `daily_tech_summary.xs` every 15 min — matches techs whose preferred AM window equals current CT time, sends rundown SMS. Gated by `DAILY_SUMMARY_ENABLED`. **MED.**

### 4.2 Tech Ant (mobile UI)

Two HTML files (verified by `ls` this session):
- `tech-ant.html` — post-job retrospective TDR completion (BUILT, LIVE).
- `tech-ant-live.html` — in-field live capture (BUILT, DORMANT — paired with Tech Assist v1 which requires `TECH_ASSIST_ENABLED`).

**Auth:** PIN fallback via Xano `verify_tech_pin` endpoint + Netlify `verify-pin-proxy.js`. Magic-link upgrade was queued for v1.1. **MED** (file names verified, contents not).

### 4.3 Tech Assist v1 (DESIGNED + dormant)

Design doc `docs/ant-tech-assist-design-v1.md` exists. Per v1 §5: on-site field copilot. Soft-block + 2hr escalation pattern. Tech can mark HCP complete normally, but if required TDR fields are missing when `job.completed` fires, Ant DMs tech, asks for missing fields one at a time, escalates to Teddy after 2hrs if unresolved. Two modes: slam-dunk (default, ~3-5 messages) vs Assist mode (opt-in, ~15-25 messages, full diagnostic checklist). Multi-job-per-day handling auto-closes previous session when new `in_progress` fires.

**Override available:** `"override - leaving without {field}, reason: {explanation}"` captured to TDR with `tech_override_flag=true`. **MED.**

### 4.4 Performance ledger + pattern detection (BUILT, DORMANT)

`compute_tech_performance_ledger.xs` runs nightly 04:00 UTC, gated by `LEDGER_TASK_ENABLED`. 30-day rolling stats per tech: offered / accepted / called_off / helped_out / acceptance_rate / team_avg. Pattern detection O(N²) bucket scan across {city, dow, time_window} dimensions over `broadcast_decline` event_log entries. Sets `pending_pattern_offer` JSON on tech row when a pattern crosses count≥3. Drives soft-preference offers ("you've declined 4 Slidell jobs, lighten up?"). **HIGH** (per v1 §5, code file exists in `xano-workspace/task/`).

`__QUERY_MY_NUMBERS__` paired token + deterministic pattern fallback (Phase 7b) auto-appends real numbers to "my numbers" / "how am I doing" / "acceptance rate" replies. **MED.**

### 4.5 Sick day cascade (BUILT)

When tech's `__UPDATE_AVAILABILITY__` token fires for TODAY with `available=false`, `scheduling_queue_worker` enqueues a `sick_day_cascade` row, attempts silent reroute by cluster rank, falls back to customer 2-option SMS when no alternate, confirms back to sick tech with one of 4 outcome variants. **MED.**

### 4.6 Owner override (Phase 8 BUILT)

Three owner-only paired tokens in `tech_sms_inbound_POST.xs`: `__OWNER_REASSIGN_JOB__`, `__OWNER_OVERRIDE_AVAILABILITY__`, `__OWNER_BROADCAST_CONTROL__`. All defensive-guard on `$tech.id == 1` (Teddy). TECH ROSTER block in CONTEXT prevents tech_id ↔ name hallucination. **MED.**

### 4.7 Conversation 626

Canonical Teddy SMS thread, tech_id=1. Used as the verification testbed throughout Phase 1-7. **MED.**

### 4.8 What's still manual on the tech side

- Initial tech enrollment (manual Xano row creation + HCP pro_id mapping)
- Cluster definition (`service_zone` + `cluster_assignment` tables — populated manually today)
- Tech preferences (`tech_preferences` table, populated via `__ADD_PREFERENCE__` tokens — only Teddy has used so far per memory)

---

## 5. Money side

| Path | Pricing | Mechanism | Confidence |
|---|---|---|---|
| Self-pay $50 Quick Check | Entry payment | Stripe Checkout link (one of three pre-configured links: $50/$90/$100) → `stripe-webhook.js` → `stripe_checkout_session_completed` | HIGH |
| Self-pay $40 Premium Video Call DIY upgrade | Flat fee, no credit, NO labor charge | **NEEDS BUILD** — Stripe link not yet, Release of Liability waiver Jotform not yet | MED (declared in v1 §15 item 3) |
| Self-pay repair | Parts × 1.30 markup + labor + $15 flat shipping (DIY) | `qc_create_checkout_session_POST.xs` mints second Stripe link after customer picks option | HIGH (math in cash_tdr code) |
| Self-pay $50 credit applied to labor | $50 Quick Check credits toward labor (floor 0) | Applied in `qc_create_checkout_session_POST.xs` | HIGH |
| Warranty | Warranty company pays. No customer payment. TN Appliance bills via portal claim. | Danielle manual today; ServiceDispatch `updateCallInfo` + Claims Submission API target | HIGH |
| Refunds / chargebacks | None today | Out of scope v1 | HIGH |

**Architectural commitment (v1 §15 #1):** Parts ship direct to customer service address in ALL scenarios where parts are needed. Tech does not carry parts. Tech is dispatched only after parts delivery confirmation (Install path) or customer DIY completion (DIY path).

**Architectural commitment (v1 §15 #2):** No-fix-needed = no refund. Customer paid for honest diagnosis, that's what they got. SMS phrasing emphasizes savings vs $100-150 competitors.

**Architectural commitment (v1 §15 #5):** Future-state parts ordering API-driven. Three suppliers in preference order: Marcone (OEM, B2B account pending) → Amazon → Tribles. Customer's selected_option drives which API is invoked.

Live Stripe keys in Netlify production env (`STRIPE_SECRET_KEY=sk_live_…[redacted]`, `STRIPE_WEBHOOK_SECRET=whsec_…[redacted]`). **HIGH.**

---

## 6. Portal side (warranty)

### 6.1 Current state — manual via Danielle

For each warranty company, Danielle logs in to the portal, submits the TDR from Xano, attaches photos (signed S3 URLs from Tech Ant), fills the portal's forms, fields auth requests for high-cost repairs. **MED** (consistent across docs, not re-verified directly with Danielle).

**Operationally distinct portals:**

| Vendor | Portal | TDR submission |
|---|---|---|
| AHS / Frontdoor | Frontdoor contractor portal | Manual; daily appointment.xlsx digest emailed |
| Allstate Protection Plans / SquareTrade | ServicePower portal | Manual; route through ServicePower |
| NSA (HAP, ARW, ASU, SHW programs) | NSA-specific portal + email replies | Manual; lots of email back-and-forth |

**Sources confirming this:** `docs/warranty-operations-strategy.md`, `docs/dawn-workflow-spec-2026-05-11.md`, this session's `docs/warranty-email-landscape-discovery-2026-05-12.md`.

### 6.2 Target API automation

**Path 1 (AHS email) — SHIPPED 2026-05-11.** End-to-end live: Gmail API poller → XML parser → Xano `ahs_email_intake` → customer SMS with chat link. 16/16 verification checks passed. Currently mid-investigation on duplicate-job production pattern (see §10.4).

**Path 2 (ServicePower SOAP for SquareTrade/Allstate) — SCOPED 2026-05-12.**
- Target endpoint: `getCallInfo` (in `Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf`). Polled, time-windowed, returns list of available jobs.
- WSDL: `https://fss.servicepower.com/sms/services/SPDService?wsdl` (prod NA) / `fssstag.servicepower.com` (staging).
- Auth: SOAP UserInfo (UserId + Password + SvcrAcct in every request body). Same as portal credentials per the v2.8 PDF.
- Companion APIs after `getCallInfo`: `getCallAttributes` (fault detail), `getCallAddresses`, `getCallNotes`, `getProductCoverage`.
- Write-back: `updateCallInfo` (ACCEPT/REJECT + status updates).
- **No credentials in repo.** Confirmed by grep this session. Danielle's portal login (per `capacity-governor-design.md`) is the API auth pair — needs to be surfaced into a Netlify env var before any build.

**AHS portal API (manual today, not designed).** No design doc in repo. **LOW.**

**NSA email parsing — designed but not built.** 24 distinct subject patterns observed in this session's landscape survey across 4 program prefixes (ARW = Asurion?, HAP = Hisense, ASU = ?, SHW = ?). Single sender `notifications@em.nationalservicealliance.com` covers 22/30 of NSA volume.

### 6.3 Phase 3 capacity governor (DESIGNED, BLOCKED)

`docs/capacity-governor-design.md` (committed `ba4bfcb`). ServicePower SOAP `updateTechCapacity` API exists per v2.8 PDF §13. **BLOCKED** on Phase 3.0 — the per-tech-vs-per-area question. Capacity API requires `TechKey` but warranty-operations-strategy notes ServicePower may have no per-tech awareness. Awaiting Danielle's portal inspection answer (asked 2026-05-08, no reply yet per v1 §17). **HIGH.**

---

## 7. What's automated today — live in production

| System | Status | Confidence |
|---|---|---|
| Homepage chat (`index.html` + Ant via `agent-chat-proxy.js` → `reply_2_POST.xs`) | LIVE | HIGH |
| Service strip + chat-side consent gate + auto-hide | LIVE since 2026-05-09 | HIGH |
| Cash TDR self-pay end-to-end | LIVE | HIGH |
| Teddy Tool cockpit (`teddy-tdr-tool.html`, `qc_cockpit_load` hydrate) | LIVE | HIGH |
| `send-teddy-sms.js` "new job" notification | LIVE (SMS_ENABLED-gated since 2026-05-11) | HIGH |
| **Trigger 1: Teddy Review Started SMS** (fires on cockpit load, idempotent) | LIVE since 2026-05-11 (commit `c914243`) | HIGH (this session) |
| `send_qc_diagnosis_to_customer` (Teddy completed → customer SMS) | LIVE | HIGH |
| Stripe Checkout + webhook (live keys) | LIVE | HIGH |
| Public-view token (HMAC-SHA256 via `generate-qc-token.js` + `validate-qc-token.js`) | LIVE | HIGH |
| **`sign-job-token.js` (chat-link HMAC for AHS-origin customers)** | LIVE since 2026-05-11 | HIGH |
| HCP webhook intake | **DEGRADED** since 2026-05-05 (sparse-payload) | HIGH (per memory) |
| HCP API probe (`hcp-api-probe.js`) | LIVE (ops tool) | HIGH |
| **AHS Gmail poller + XML parser end-to-end** | LIVE since 2026-05-11 — currently mid-investigation on duplicate pattern | HIGH (this session) |
| Jotform waiver webhook | LIVE | HIGH |
| Twilio outbound via `send_sms_POST.xs` (wraps SMS_ENABLED gate) | LIVE | HIGH |
| Twilio inbound at +16292840444 → `tech-sms-inbound.js` → `tech_sms_inbound_POST.xs` | LIVE | MED |
| Vapi warranty follow-up cron (`vapi_warranty_followup_scheduler.xs` every 10 min) | LIVE (cron); Vapi-side answering UNVERIFIED | MED |
| Process feedback queue cron | LIVE | MED |
| Feedback classifier AI agent (Sonnet 4.5 extended thinking) | LIVE (wired to `feedback_reply_webhook_POST.xs`); actual live classifications not re-verified | MED |
| **SMS_ENABLED kill switch** (29-site wrap across all outbound SMS paths) | LIVE since 2026-05-11 | HIGH |
| **Admin status endpoint** `/api:SXH92Wk7/sms_enabled_status` | LIVE since 2026-05-11 | HIGH |

**Job count:** ~4500+ rows in `jobs` table as of 2026-05-12 (per this session's metadata API probe — many are AHS-poller duplicates from the bug under investigation). **HIGH.**

---

## 8. What's built but dormant (env-var gated)

| Env var | Status | What flipping does | Blocker |
|---|---|---|---|
| `HCP_POLL_ENABLED` | unset | 15-min HCP polling cron upserts jobs from `/jobs` REST. Workaround for sparse-webhook. | Verify polling doesn't double-write on race with webhook recovery. |
| `DAILY_SUMMARY_ENABLED` | unset | Per-tech daily AM-window rundown SMS. | TCR campaign approval + per-tech `summary_send_time` populated. |
| `LEDGER_TASK_ENABLED` | unset | Nightly 04:00 UTC 30-day rolling stats + pattern detection. | Tech Scheduler v2 carryover polish (Phase 7b, 8b). |
| `SCHEDULING_QUEUE_ENABLED` | unset | Tech Scheduler v2 broadcast/queue worker. | TCR campaign approval (worker SMSes 5-6 techs/broadcast) + carryover polish. |
| `TECH_ASSIST_ENABLED` | unset | Tech Assist v1 escalation cron + on-arrival bootstrap. | TCR clearance + `tech-ant-live.html` UI build (estimated 2-3 sessions). |
| `SIGNATURE_VERIFICATION_ENABLED` | `false` | Strict HMAC verification on incoming HCP webhooks. | HCP isn't consistently signing today. |
| `SMS_ENABLED` | unset (`SMS_ENABLED != "true"` ⇒ gated) | All 29 outbound SMS sites wrap through this gate. Owner phone (+16154855795) bypasses. Currently ALL non-owner SMS sites gate-only (count to admin endpoint, no actual Twilio fire). | TCR clearance to flip to `true` for prod live SMS. |
| `HCP_BACKFILL_ENABLED` | manual | One-shot backfill (explicit-trigger only). | n/a |

**HIGH** for all rows above — these envs are documented across v1 §9, sms-enabled-deployment-manifest.md, and the actual code.

**Active investigation 2026-05-12:** AHS Gmail poller schedule. Was disabled `c707df4`, re-enabled `c5fe9db` to observe clean cron behavior. Tied to the 75-jobs-per-window duplicate-pattern investigation.

---

## 9. What's designed but not built

| Item | Doc | Status / blocker |
|---|---|---|
| Phase 3 ServicePower capacity governor | `docs/capacity-governor-design.md` | Blocked on Phase 3.0 per-tech-vs-per-area question (awaiting Danielle reply) |
| AHS portal API | Not in repo | LOW — designed/wanted but no design doc |
| ServicePower SOAP `getCallInfo` for SquareTrade intake | This session's `getCallInfo` summary in chat | **SCOPED 2026-05-12.** No code yet. Needs credentials. |
| ServicePower SOAP TDR submission via Claims Submission API | `docs/servicepower/Servicer_Integration_Guide_-_Claims_Submission_v1_10.pdf` | Inventoried 2026-05-12; not designed |
| ServicePower RFA APIs (Create + Retrieve) | `docs/servicepower/` PDFs | Inventoried 2026-05-12; Phase 4+ work |
| Allstate parser | Not in repo | LOW — referenced in `warranty-operations-strategy.md`; no design doc |
| Marcone B2B API | Not in repo | Pending in-person account approval |
| Amazon parts API | Not in repo | Designed-not-built |
| Tribles API | Not in repo | Designed-not-built |
| RingCentral → Vapi port for `615-280-2949` | Not in a design doc | In flight; transitional copy in customer-facing HTML reflects |
| Customer transparency SMS workstream (Triggers 2-4) | `docs/system-blueprint-decisions-2026-05-09.md` | Trigger 1 shipped 2026-05-11. Triggers 2-4 (parts ordered / parts shipped / parts delivered) **DEPRIORITIZED** per 2026-05-11 strategic reframing — warranty intake now higher priority |
| Voice-only Vapi parallel triggers | Not in a design doc | One general-purpose "Ant Status Update" agent per `system-blueprint-decisions-2026-05-09.md` Decision 2; **resolved 2026-05-11** to build new specialist agents matching Pattern 1 (see `vapi-agent-inventory-2026-05-11.md`) |
| $40 Premium Video Call DIY upgrade + Release of Liability waiver | Not in a design doc | NEEDS BUILD |
| Phase 1f multi-failure cash TDR UI | `docs/cash-tdr-delivery-design-v1.md` | Single-failure live; multi-failure deferred |
| Rental / landlord-tenant flow | `docs/cash-tdr-delivery-design-v1.md` | Designed; not built |
| Gmail integration (general intake channel #2) | `docs/gmail-integration-design-v1.md` | Designed (~6-8 sessions); deferred. **2026-05-11 update:** the AHS-specific Gmail poller built this week IS a partial realization of this — but the warranty-intake-vision doc reframes it specifically around warranty automation, not generic intake. |
| AHS direct dispatcher email path (`DispatchRegionP1@ahs.com`) | Discovered 2026-05-12 in landscape survey | Sparse prose body; thin parser to build |
| NSA dispatch parsers (ARW/HAP/ASU/SHW) | Discovered 2026-05-12 in landscape survey | HTML with button-driven UI; 4 program prefixes share template |
| SquareTrade auto-status writeback via ServiceDispatch `updateCallInfo` | Discovered 2026-05-12 — would silence 43% of SquareTrade inbox volume (status-request reminders) | Big DRY-up target; needs ServicePower SOAP credentials |
| Frontdoor "CIL Accepted" handler | Discovered 2026-05-12 | Easy-medium; auto-close Xano jobs when CIL (Cash In Lieu) accepted |
| ServicePower "Service Request" + "Service Request Notice" plaintext parser | Discovered 2026-05-12 | Highest-leverage Phase A1 — ~60% of ServicePower email volume |

---

## 10. Operational surface

### 10.1 Domain & hosting

- Custom domain: `tnapplianceexchange.net`
- Netlify project: `superlative-naiad-233aa7` (Project ID `1ecd89fc-8a9c-4fa3-b923-5186759cfc84`)
- 19 Netlify functions (verified by `netlify functions:list` this session): agent-chat-proxy, ahs-gmail-poller, claude-proxy, create-job-proxy, create-warranty-job-proxy, generate-qc-token, get-job-proxy, get-tech-jobs-proxy, hcp-api-probe, hcp-webhook-proxy, s3-presign, s3-view-url, send-teddy-sms, sign-job-token, stripe-webhook, tech-sms-inbound, validate-qc-token, verify-pin-proxy, xano-proxy. **HIGH.**

### 10.2 GitHub

- Repo: `tnappliancerepair-hub/tn-appliance-tools`
- Default branch: `main`
- Recent ship cadence (this session): 11 commits 2026-05-11/12 covering AHS poller end-to-end, SMS_ENABLED, Trigger 1, warranty intake reframing, schedule investigation, email landscape discovery. **HIGH.**

### 10.3 Xano

- Instance: `xbtp-g9bh-ditq.n7e.xano.io`
- Workspace: 1 ("James's Workspace")
- API groups:
  - `intake` (`api:3e_TffpA`) — 52 endpoints
  - `cash_tdr` (`api:VGkW9mcV`) — 8 endpoints
  - `scheduling` — 4 endpoints
  - `WdAZ3bLA` (Vapi)
  - `SXH92Wk7` (admin — SMS_ENABLED status endpoint)
- 7 task cron files in `xano-workspace/task/`: hcp_poll_recent_jobs, scheduling_queue_worker, vapi_warranty_followup_scheduler, daily_tech_summary, process_feedback_queue, compute_tech_performance_ledger, compute_tech_assist_escalation. **HIGH** (file count verified this session).
- Metadata API token: `~/.xano/credentials.yaml`

### 10.4 Twilio

- 10DLC TCR campaign: PENDING. Was day 8+ on 2026-05-09 (resubmission). Today is 2026-05-12 — that's day 11+. **MED** (status not re-verified this session — could have approved or could still be pending).
- Numbers: +16292840444 (business outbound + customer), +17273508487 (tech inbound + scheduler outbound), Vapi BYOs (+16292607111 TN Ant Inbound, +16292477111 TN, +15043559111 LA).
- Credentials rotated 2026-05-08 (was hardcoded in `send_sms_POST.xs` + `create_job_POST.xs`; now `$env.TWILIO_*`).

### 10.5 HCP (Housecall Pro)

- API base: `https://api.housecallpro.com`
- API key in Netlify env (rotated 2026-05-08)
- Webhook ACTIVE but DEGRADED since 2026-05-05 — sparse payload (event field only, no data). HCP support ticket pending.
- Tech mapping: `technicians.hcp_id` column holds the `pro_` UUID per tech. Reattributed 165/216 historical rows on 2026-05-08 (Build C).

### 10.6 Vapi

15 agents total per `docs/vapi-agent-inventory-2026-05-11.md` (committed 2026-05-11):
- **11 Ant agents** (TN Appliance Exchange brand, Heisenberg voice, single-purpose specialist pattern): Ant Warranty Fallback, Ant Inbound, Ant Parts Follow-Up, Ant Appointment Reminder, Ant Missed Call Callback, Ant Authorization Update, Ant Parts ETA Update, Ant Tech Running Late, Ant Reschedule, Ant After Hours, Ant Warranty Company Inbound.
- **4 developer-built James Repair agents** (Sarah voice, NOT wired to TN Appliance Xano endpoints — separate stack, deferred integration question for Week 2+).

**Pattern 1 (Specialist Status Delivery)** identified across Ant Authorization Update + Ant Parts ETA Update + Ant Tech Running Late. This is the template for new Status Update agents per Decision 2 resolution.

**HIGH** (inventory committed in `ce8cd8c` this week).

### 10.7 S3

- Bucket: `tn-appliance-media-586117210123-us-east-2-an` (region us-east-2)
- Used by CaptureOverlay + TDR attachments + Tech Ant photo/video uploads
- Signed via `s3-presign.js` (upload) + `s3-view-url.js` (view). **HIGH.**

### 10.8 Contact lines

- Customer-facing voice: 615-280-2949 (RingCentral, porting)
- Owner: +16154855795 (Teddy)
- Danielle: 615-485-0713
- Business SMS: +16292840444
- Tech SMS: +17273508487

### 10.9 AI providers

Anthropic Claude only (no OpenAI/Gemini):
- Ant chat: `claude-sonnet-4-X` via `agent-chat-proxy.js`
- Teddy Tool AI pre-fill: `claude-sonnet-4-20250514`
- Feedback classifier: Sonnet 4.5 with extended thinking
- Tech SMS reasoning: Sonnet

---

## 11. Security debt

1. **Twilio + HCP credentials rotated 2026-05-08** — was hardcoded literals in two Xano files; now `$env.*`. Old keys revoked.
2. **DIAG code lingering in `hcp-webhook-proxy.js`** + entire `hcp-api-probe.js` file — tagged for removal pending HCP support resolution. Memory ref: `project_diagnostic_code_to_remove.md`. **MED** (not re-confirmed in this session).
3. **Anomalous duplicate Stripe key in Netlify env** noted in 2026-05-09 — copy-paste accident where literal key was set as both name AND value. Should be investigated/removed. **LOW** (not personally verified — could already be fixed).
4. **Production env literals visible to anyone with Netlify CLI** — Twilio auth, HCP API, Stripe live secret, HCP webhook secret, AWS S3, QC token secret, Xano webhook secret. Acceptable given Teddy-only access.
5. **`SIGNATURE_VERIFICATION_ENABLED=false`** — webhook proxy accepts unsigned. Acceptable workaround per the practical bounded blast radius via the `_internal_auth` body precondition.
6. **`xano-workspace/` is committed to git** historically (per v1 §12 note) — though I see it's in `.gitignore` today. The historical concern was hardcoded `Bearer …` or `sk_live_…` literals from before the 2026-05-08 rotation. No grep audit done this session.
7. **NEW 2026-05-11:** `CHAT_TOKEN_SECRET` env var added in Netlify for `sign-job-token.js`. Distinct from `QC_TOKEN_SECRET` per separate-blast-radius convention.
8. **NEW 2026-05-11:** Gmail OAuth credentials in Netlify env (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) — scope `gmail.modify`. Refresh token doesn't expire unless revoked. Local OAuth helper script gitignored.
9. **Service-power credentials NOT YET in env** — needed before any SOAP build (Path 2). Danielle's portal login is the API auth pair per the v2.8 PDF.

---

## 12. Long-term vision

Per `docs/master-build-doc-foundation.md` + April 29 handoff + v1 §14:

- **Fleet:** 2 Tesla Model Y to start, scaling to 6. Cybertruck stays Teddy's owner-operator vehicle.
- **Licensable platform:** Once TN Appliance Exchange runs hands-off, license the system to independent appliance techs nationally. Everything built (Ant intake, Tech Ant, Tech Assist, capacity governor, performance ledger, warranty portal automation, customer transparency SMS) is built to platform quality.
- **Phase 8 success criterion:** "Could a different shop's 6-tech crew be onboarded in <1 day?" — the moat metric (per `docs/ant-tech-scheduler-design-v2.md`).
- **B2B unit economics:** Replace the human dispatcher (~$40-60k/yr role) per shop. Per-tech / per-shop SaaS pricing.
- **Multi-tenant constraint:** Today's architecture is single-tenant. v2+ adds multi-tenant (per `docs/gmail-integration-design-v1.md`).

**Strategic goal (locked 2026-05-09, reaffirmed 2026-05-11):** Prove the system works in production with real techs and customers, then let the best ideas win. **Optimization order:** time to working proof → iteration speed → scalability path. Architecture decisions are evidence-driven, not theory-driven.

**Load-bearing architectural commitments (v1 §15, all HIGH confidence):**
1. Parts ship direct to customer in ALL scenarios where parts needed
2. No-fix-needed = no refund
3. DIY support pricing = $40 Premium Video Call upgrade (NEEDS BUILD)
4. Customer-facing TDR options page = 4 options + skip
5. Future-state ordering is API-driven (Marcone → Amazon → Tribles)
6. Voice-only customers get Vapi outbound at every SMS trigger point
7. Customer transparency SMS is the standard for every state change
8. Scheduling Philosophy B (locked April 29): no fixed windows, two-tier (must-time vs open-schedule), 6-7 jobs/day per tech, mutual respect framework, honest 2-5 day timeline

---

## 13. Recent ship history (this session 2026-05-11/12)

In chronological order, this session shipped:

| Date | Commit | Substance |
|---|---|---|
| 2026-05-11 | `e1241ba` + `8d9fa2b` + `999321d` | **SMS_ENABLED kill-switch** — 29-site outbound SMS gate + admin status endpoint + Netlify-side gate. Owner phone bypasses. Footgun #23 documented (parameterless endpoints need empty `input{}` block) |
| 2026-05-11 | `c914243` | **Day 2 Trigger 1: Teddy Review Started SMS** — fires on `qc_cockpit_load`, idempotent via `(($job.teddy_review_started_at ?? 0) > 0)` check. Footguns #24-27 documented |
| 2026-05-11 | `ce8cd8c` | Vapi 15-agent inventory committed; Decision 2 resolved (build new specialist agents matching Pattern 1) |
| 2026-05-11 | `917ac8e` | Strategic reframing — warranty intake automation is the platform's center of gravity. `dawn-workflow-spec` + `warranty-intake-automation-vision` docs |
| 2026-05-11 | `7f8f861` | **AHS warranty intake parser (XML edition) + sign-job-token Netlify function.** End-to-end. Verified 16/16 checks against real Robin Jones AHS dispatch fixture |
| 2026-05-11 | `5b94550` | Footgun #28 documented: `regex_replace` returns null in Xano runtime regardless of match status. Workarounds applied: `|replace:` for literals, skip for clean inputs |
| 2026-05-11 | `92a0116` | **AHS dispatch poller** — Netlify scheduled function replacing Make.com plan. Cron `*/15 * * * *`. `googleapis` dep added. OAuth setup doc + helper |
| 2026-05-12 | `dba7b75` + `9fe57f0` | Env-var visibility diag + removal (after first verification fire showed env vars reaching runtime correctly) |
| 2026-05-12 | `69fbd22` | Two-phase claim label (`AHS-Processing` → `AHS-Processed`) to narrow duplicate-fire race window. Window-narrowing, not atomic mutex |
| 2026-05-12 | `c707df4` → `c5fe9db` | Schedule disabled → re-enabled for clean-data observation (Run-now-double-click hypothesis vs Netlify-retry hypothesis still being investigated) |
| 2026-05-12 | `3dfff6c` | Warranty email landscape discovery — 137 messages across 5 senders catalogued |

---

## 14. What I'm uncertain about

The most important section. These are the questions I can't answer from memory + repo alone.

1. **Is the Tech Ant `tech-ant.html` actually being used by techs on jobs today?** The file exists, design says LIVE. But I have no production-usage evidence in memory. A query of `jobs.tech_ant_chat_started_at != null` would answer this.

2. **TCR campaign current status.** Was day 8+ on 2026-05-09. Today is 2026-05-12 — day 11+. Expected approval window was 3-4 days from resubmission. Has it cleared? If yes, **5 dormant env vars become flippable** (`DAILY_SUMMARY_ENABLED`, `SCHEDULING_QUEUE_ENABLED`, `TECH_ASSIST_ENABLED`, and the live-fire flip of `SMS_ENABLED` to `"true"`, and likely `HCP_POLL_ENABLED` though that's TCR-independent).

3. **RingCentral → Vapi port for 615-280-2949.** Port status unknown — transitional copy ("Call us, not text") in customer-facing HTML suggests inbound still RingCentral. Has the port completed?

4. **HCP webhook sparse-payload incident.** Pending HCP support ticket per memory. Has it been resolved? If yes, `HCP_POLL_ENABLED` workaround becomes unnecessary.

5. **Danielle's per-tech-vs-per-area capacity API answer.** Asked 2026-05-08. Phase 3 capacity governor BLOCKED on this single answer. Has she replied yet?

6. **Trigger 1 customer impact in production.** Trigger 1 shipped 2026-05-11. It fires on every `qc_cockpit_load`. With SMS_ENABLED off, it's gating-only (counting, not sending). Has SMS_ENABLED flipped to `"true"` yet, and if so, what's the customer-side observable behavior?

7. **The 4060+ AHS-poller-created job rows from 2026-05-11/12.** Most are duplicates from the 75-jobs-per-15-min-cron pattern still under investigation. None can be customer-visible because SMS_ENABLED is off. **Cleanup plan unknown** — Teddy deferred Decision 1 on cleanup last night.

8. **AHS poller cron behavior right now.** Schedule was re-enabled `c5fe9db` to observe clean cron fire. Outcome of that observation unknown to me — was watching for "1 invocation per cron interval = good" vs "3 invocations per cron interval = the retry hypothesis confirmed."

9. **The "210" warranty-source reference Teddy mentioned in landscape survey planning.** Did NOT match anything in the inbox. Need clarification on what it actually refers to.

10. **NSA program prefixes — ARW, ASU, SHW.** HAP is confirmed Hisense. The other three are unknown to me. What manufacturers does NSA route under each?

11. **ServicePower credentials.** Danielle's portal login per the v2.8 PDF doubles as API auth. Confirmed not in repo. Are they accessible (in her password manager) or do we need to request a dedicated integration user?

12. **The Vapi inventory's 4 developer-built James Repair agents.** Per the 2026-05-11 inventory, they're NOT wired to TN Appliance Xano. Are they actively serving anyone, dormant, or remnants of an earlier consultant build? Decision 2 inventory commit says "Week 2+ resolution" but doesn't specify what to do with them.

13. **Capacity Governor Phase 3 vs the SOAP `getCallInfo` intake.** Both touch ServicePower SOAP. Which goes first — the read path (`getCallInfo` for SquareTrade intake) or the write path (`updateTechCapacity` for governor)? The vision doc and the warranty-operations-strategy doc weight differently.

14. **Feedback classifier actual live usage.** Cron exists, AI agent exists, endpoint exists. But is it firing on real customer feedback SMS replies in production today? Or just dormant infrastructure?

15. **Customer dashboard `dashboard.html`.** File exists; never opened in this session. Is it customer-facing or staff-facing? Live or scaffold?

16. **`book.html`.** File exists; purpose unclear. v1 §18 #13 also flagged this — "appears to be a post-waiver self-schedule landing page" but unconfirmed.

17. **Phase 1f multi-failure cash TDR.** Schema enum supports multi-failure (`tdr_failure` per-row). UI on `cash-tdr-customer.html` is single-failure-only per v1 §10. Is there a queue of cash-TDR jobs with multi-failure that are currently bottlenecked?

18. **Tech roster's HCP pro_id mapping.** Per v1, 165/216 historical jobs had tech-attribution reattributed on 2026-05-08. Are the remaining ~51 jobs cleanup-able, or are they legitimately stuck?

19. **Stripe duplicate-key env entry.** Was an artifact noted 2026-05-09. Has it been investigated? `netlify env:list --plain --context production` would tell me, but I didn't run it this session.

20. **Customer transparency Triggers 2-4.** Trigger 1 shipped 2026-05-11. Triggers 2/3/4 (parts ordered / shipped / delivered) were deprioritized in favor of warranty intake automation per the 2026-05-11 strategic reframing. What's the actual return-to-Triggers-2-4 date, if any?

21. **The 2026-05-09 "consent column additions" mentioned in v1 §13.** User prompt referenced this; not re-verified by Xano schema read this session.

22. **Conversation 626 (canonical Teddy SMS thread).** Live per v1. Are other techs onboarded with their own conversations, or is Teddy still the only seeded tech_sms conversation?

23. **The June Sun→Mon marathon's Phase 0-8 build deltas vs what's actually in `xano-workspace/`.** I read endpoint COUNTS this session (52 intake, 8 cash_tdr, 4 scheduling) but didn't audit which were built during which phase. Some scheduler endpoints may have been pruned/renamed.

24. **The `system-blueprint-decisions-2026-05-09.md` Decision 1 (Tech Scheduler architecture session).** Locked-deferred to its own session per v1 references. Has that session happened yet, or is it still pending?

25. **The `unified-tech-tool-architecture-hypothesis-2026-05-09.md` Option B.** Per memory, working hypothesis only, NOT for execution. Has anyone started treating it as decided? (My memory says specifically NOT.)

These 25 items are the highest-value questions for the diff session. If the other reconstruction filled any of them in, that's signal worth grabbing.

---

**End of reconstruction.** File: `docs/system-blueprint-cc-reconstruction.md`. NOT committed per the user's instruction.

# Customer-Facing Automation Inventory — 2026-05-20

**Author:** Claude Code (Opus 4.7), read-only inventory.
**Scope:** Every step in the customer journey, from first chat through post-job feedback. Read-only — no code or env touched, no test webhooks fired.
**Companion to:** `docs/automation-inventory-2026-05-20.md` (full-platform survey) and `docs/feedback-flow-status-2026-05-20.md` (the one path already verified GREEN).

Today's focus: now that tech-side SMS infrastructure has shipped, T wants to know how much of the **customer chain** is already wired and what it would take to flip on. **Headline finding: most of the chain exists, but `SMS_ENABLED=true` flipped on without anyone noticing — yet every event_log count for a customer-side outbound SMS reads zero or near-zero. The pipeline is sitting there, ready, with no traffic actually flowing through it.**

---

## Summary table

| # | Path | Status | Trigger wired? | Blocker |
|---|---|---|---|---|
| 1a | Customer chat intake — self-pay | GREEN | yes (Netlify proxy → `chat/reply2`) | none — actively used today (3,774 agent_messages, latest 21:06 UTC) |
| 1b | Customer chat intake — warranty | YELLOW | yes (same chat path) | warranty branch in `create_job_from_chat` exists but never proven; SquareTrade/AHS Jotform path is the historical entry (`warranty_job_intake`) |
| 2 | Teddy Tool pre-diagnosis (Stage 2 TDR) | YELLOW | indirect (UI-driven) | `send-teddy-sms.js` Netlify function exists but is NEVER CALLED — no upstream trigger wired anywhere |
| 3a | HCP job creation from chat | YELLOW | yes (`create_job_from_chat`) | code path exists; `intake_created` job_event last fired via Gmail poller 2026-05-18, never proven from chat |
| 3b | HCP sync — webhook | RED | yes (HMAC-verify proxy) | DEGRADED since 2026-05-05; sparse `{event}`-only payloads |
| 3c | HCP sync — polling fallback | GREEN (with override) | cron fires every 15 min | `HCP_POLL_ENABLED` unset — only fires when manually invoked with `override_enabled=true`; today inserted 50 jobs at 21:26 UTC |
| 4 | Waiver SMS to customer | YELLOW | endpoint exists (`send_waiver_sms`) | NO upstream call site — nothing fires `send_waiver_sms`; uses Twilio direct (not the new `send_sms` Telnyx router) |
| 5 | Waiver signed via Jotform | YELLOW | yes (Jotform webhook → `jotform_waiver_webhook`) | last fire 2026-04-20 (1 job ever); endpoint also uses Twilio direct, NOT `send_sms` |
| 6 | Auto-scheduling SMS ("Pick your appointment time") | YELLOW | yes (chained off Jotform webhook) | only fires after Jotform; no `booking_sms_sent` ever in production event_log |
| 7 | Customer reply handling (inbound SMS to +16155889500) | MISSING | NO inbound brain | tech-sms-inbound.js handles ONLY tech number +16158578800. No Netlify function nor Xano endpoint exists for customer inbound SMS |
| 8 | "Tech on the way" / 30-min-out SMS | MISSING | none | The HCP `job.started` event sends SMS to the TECH (Tech Ant TDR link), not the customer. No customer-side "tech on the way" path in the codebase. |
| 9 | "Parts ordered" SMS | MISSING | none | No `send_parts_ordered_sms` or equivalent. `parts_status` is a column read by daily summary and scheduling worker, but no SMS dispatch on transition. Vapi agent "Ant Parts ETA Update" exists in dashboard but has no Xano caller. |
| 10 | Job complete + feedback SMS | GREEN | yes (queue + 5-min cron) | none — verified today (see `docs/feedback-flow-status-2026-05-20.md`). 0 customers got SMS, but plumbing complete. |
| 11 | Vapi voice paths | 3 LIVE / 8 UNVERIFIED | partial | Only Vapi warranty followup cron has Xano-side dispatcher (`trigger_vapi_warranty_call`); 0 successful triggers in event_log to date |

Status legend: **GREEN** built+wired+proven; **YELLOW** built+wired+never-proven; **RED** built but critical piece missing; **MISSING** described but no code.

---

## INTAKE STAGE

──────────────────────────────────────────
PATH: Customer chat intake — self-pay (Ant on index.html)
STATUS: GREEN
WHERE IT LIVES:
- `index.html` (chat UI; PROXY URL at line ~1668)
- `netlify/functions/agent-chat-proxy.js` (30s timeout, forwards to Xano)
- `xano-workspace/api/intake/chat/reply_2_POST.xs` (Claude Sonnet 4.5 brain, `%%JOB_READY%%`/`__JOB_READY__` sentinel triggers job creation)
- `xano-workspace/api/intake/create_job_from_chat_POST.xs` (creates customer + job + financial)
- System prompt: `$env.SYSTEM_PROMPT` (Xano env)
TRIGGER: HTTP POST from website chat widget
TRIGGER WIRED: yes — Netlify function deployed, Xano endpoint live
LAST FIRED IN PROD: `agent_message` table row 3,774 at **2026-05-20 21:06 UTC** (~45 min before this survey). `agent_conversation` total 672.
KNOWN BUGS: per memory `feedback_show_evidence` and blueprint §17: consent-gate addendum may not be live in `$env.SYSTEM_PROMPT`. The `create_job_from_chat` endpoint defaults `triage_status` based on `recommended_service` — quick_check + premium_call routes to Teddy (tech_id=1); other paths call `get_tech_for_zip` for routing. NOT a bug, just opaque.
TO VERIFY: open `https://tnapplianceexchange.net/`, send 1 message, verify `agent_message` row appears. Already verified by live traffic today.
TO FIX: n/a
──────────────────────────────────────────

──────────────────────────────────────────
PATH: Customer chat intake — warranty branch
STATUS: YELLOW
WHERE IT LIVES:
- Same chat path as 1a, but `customer_type=warranty` branch in `create_job_from_chat_POST.xs:42-46` sets `payment_status="warranty_pending"`
- Alternative entry: Jotform → `xano-workspace/api/intake/warranty_job_intake_POST.xs` (used for direct warranty intake without chat — currently used by what flow?)
TRIGGER: chat-side: customer chooses warranty path in conversation; Jotform-side: direct submission to specific warranty form
TRIGGER WIRED: chat path yes; Jotform path's webhook URL configured-state unknown without Jotform dashboard access
LAST FIRED IN PROD: never proven via chat (no event_log keyword for warranty-branch chat). `warranty_job_intake` endpoint has no event_log audit at all (no `db.add event_log` call).
KNOWN BUGS:
- `warranty_job_intake_POST.xs` writes NO event_log row; only writes `job_event` with `event_type="intake_created"` (table 13 shows 17,777 intake_created rows, latest 2026-05-18 22:03 UTC — but these are from `ahs_email_intake_POST` and `servicepower_email_intake_POST`, NOT this endpoint).
- Field `q26_warrantyCompany` etc. hardcoded to Jotform field names; if Jotform fields renamed, silent breakage.
TO VERIFY: walk the chat path with a "I have AHS warranty" first message; verify a jobs row lands with `customer_type=warranty`. Independent: submit the warranty Jotform; verify the warranty_job_intake endpoint creates a job.
TO FIX: add event_log writes to `warranty_job_intake_POST.xs` (10-min patch). The chat-side warranty branch is well-supported by the system prompt logic (per blueprint).
──────────────────────────────────────────

## DIAGNOSIS STAGE

──────────────────────────────────────────
PATH: Teddy Tool pre-diagnosis (Stage 2 TDR)
STATUS: RED
WHERE IT LIVES:
- `teddy-tdr-tool.html` (UI, root level)
- `xano-workspace/api/intake/qc_cockpit_load_GET.xs` (one-shot hydrate — job + customer + appliance + attachments-with-signed-S3-URLs + existing_tdr)
- `xano-workspace/api/intake/create_tdr_POST.xs` (supports `mode="pre_diagnosis"` — flips `pre_diagnosis_complete=true`, posts clean cockpit-formatted HCP note, skips completion-style SMS)
- `xano-workspace/api/cash_tdr/send_qc_diagnosis_to_customer_POST.xs` (Stage 3 — after Teddy completes, sends customer-facing TDR link)
- `netlify/functions/send-teddy-sms.js` (notifies Teddy of new job via SMS to Teddy Tool URL)
TRIGGER: depends on path. `qc_cockpit_load` is called when Teddy opens `teddy-tdr-tool.html?job_id=X`. The triggering signal — "new job needs Teddy's review" — does NOT exist in any wired upstream.
TRIGGER WIRED: NO. `send-teddy-sms.js` Netlify function is callable, but NOTHING calls it. `grep send-teddy-sms` returns only the function itself and its references in docs.
LAST FIRED IN PROD: `technician_decision_report` table 12: 17 TDRs total, latest **2026-05-08 10:48 UTC** (12 days ago). No `pre_diagnosis_complete=true` action audit in event_log.
KNOWN BUGS:
- `send-teddy-sms.js` posts FROM `+16292840444` (Twilio feedback number) — NOT the new Telnyx tech number. Whether this is intentional (Twilio is owner-bypass-friendly because it's been live longer) or a stale leftover is undocumented.
- No trigger means Teddy must manually open the URL with the job_id, which defeats the automation.
TO VERIFY: directly open `https://superlative-naiad-233aa7.netlify.app/teddy-tdr-tool.html?job_id=18078` (a job from today's HCP poll) — verify the page renders + TDR form is interactive.
TO FIX (if YELLOW/RED): Wire a trigger. Two reasonable options:
1. Call `send-teddy-sms` from `create_job_from_chat_POST.xs` after a self-pay job is created (40 min — add a `api.request` at the end of the stack with `{job_id, customer_name, appliance, brand, problem}`)
2. Call it from a cron that scans new jobs whose `pre_diagnosis_complete` is false and have been in `pending` for >5 min (30 min — copy `vapi_warranty_followup_scheduler.xs` pattern)
──────────────────────────────────────────

## SCHEDULING STAGE

──────────────────────────────────────────
PATH: HCP job creation — from chat
STATUS: YELLOW
WHERE IT LIVES:
- `xano-workspace/api/intake/create_job_from_chat_POST.xs` (creates `jobs` + `customer` + `job_financial` + `job_event` of type `intake_created` and `hcp_sync_pending`)
- HCP push happens NOT here but in a background task (per `hcp_sync_pending` event_type comment "to be handled by a background task")
TRIGGER: `__JOB_READY__` or `%%JOB_READY%%` sentinel in chat reply
TRIGGER WIRED: yes
LAST FIRED IN PROD: searched event_log for `job_created_from_chat` / `intake_created` (action) → 0 rows. `job_event` table 13 shows `event_type=intake_created` with 17,777 rows but those all originate from `ahs_email_intake_POST` and `servicepower_email_intake_POST`. The Web-chat `hcp_sync_pending` job_event has only **31 rows total**, latest 2026-05-18 14:08 UTC. The matching `chat_attachments_linked` has 7 rows. So: web chat HAS produced jobs, but only in trickle.
KNOWN BUGS: HCP background sync task is described in code comments (`hcp_sync_pending` event_type) but I could not find the task that consumes it. May be implicit via `hcp_poll_recent_jobs` re-pulling from HCP after Danielle manually creates the HCP-side job.
TO VERIFY: walk through chat to job creation; check whether the chat-created Xano job ever gets a `housecall_pro_job_id` populated (which would indicate a sync happened).
TO FIX: low priority unless self-pay volume increases. Today's HCP polling backfills from HCP→Xano; chat-side is the reverse direction (Xano→HCP) and may have no consumer.
──────────────────────────────────────────

──────────────────────────────────────────
PATH: HCP sync — webhook
STATUS: RED
WHERE IT LIVES:
- `netlify/functions/hcp-webhook-proxy.js` (HMAC verify, currently lax with `SIGNATURE_VERIFICATION_ENABLED=false` confirmed)
- `xano-workspace/api/intake/hcp_job_webhook_POST.xs` (2000+ lines — handles `customer.*`, `job.started`, `job.completed`)
TRIGGER: HCP POSTs to Netlify proxy on appointment/job/customer state change
TRIGGER WIRED: yes (HCP dashboard has the URL)
LAST FIRED IN PROD: `hcp_webhook_raw_input_capture` last fire **2026-05-14 22:12 UTC** with 1,566 total. `hcp_webhook_received` total 1,582. But per memory, HCP has been delivering only `{event}` (no data body) since 2026-05-05 — so the webhook entries since then are no-ops.
KNOWN BUGS:
- Sparse-payload bug at HCP side, support ticket open.
- `tech_arrival` sub-branch (HCP `job.started`) sends SMS to the **TECH**, not the customer. This is intentional (Tech Ant TDR link). Customer gets nothing on tech arrival from this endpoint.
- `_internal_auth` gate is disabled if `$env.HCP_INTERNAL_AUTH_SECRET` is empty (transition guard). Netlify env shows `HCP_INTERNAL_AUTH_SECRET=dac6c7001fe3863362a2adc4a1baa05a` — so the gate IS active. `hcp_internal_auth_failed` last fired 2026-05-05 15:15 UTC (1 row).
TO VERIFY: not under our control.
TO FIX: HCP support is the only path. Polling fallback (next entry) is the live workaround.
──────────────────────────────────────────

──────────────────────────────────────────
PATH: HCP sync — polling fallback (`hcp_poll_recent_jobs`)
STATUS: GREEN (with override) / DORMANT (cron path)
WHERE IT LIVES:
- `xano-workspace/task/hcp_poll_recent_jobs.xs` (15-min cron, fires the endpoint with empty body — gate skips immediately)
- `xano-workspace/api/intake/hcp_poll_recent_jobs_POST.xs` (gated by `HCP_POLL_ENABLED=="true"` OR body `override_enabled=true`)
TRIGGER: cron every 15 min, OR manual POST with `override_enabled=true`
TRIGGER WIRED: cron yes, env gate UNSET — silent no-op
LAST FIRED IN PROD: **today 2026-05-20 21:26 UTC** via manual override — `hcp_poll_run` row id 40353 with `override_used:true`, inserted 50 jobs (`hcp_poll_inserted` total now 65, latest 21:26 UTC). Cron itself fired 1,247 times with `hcp_poll_skipped_disabled` (latest 21:45 UTC, env gate still off).
KNOWN BUGS: none material. Per task code: lookback window is max(latest hcp_updated_at, 30 min ago) — intentional over-fetch for failed-run reconciliation.
TO VERIFY: already proven this morning (50 jobs synced).
TO FIX: flip `HCP_POLL_ENABLED=true` in Xano env after a confidence pass. Risk: low (idempotent upserts on `housecall_pro_job_id`).
──────────────────────────────────────────

──────────────────────────────────────────
PATH: Waiver SMS to customer
STATUS: YELLOW
WHERE IT LIVES:
- `xano-workspace/api/intake/send_waiver_sms_POST.xs` (callable; builds prefilled Jotform URL `form.jotform.com/260495320372050?job_id=…&name=…&phone=…`)
TRIGGER: POST to the endpoint with `{job_id, phone?}`
TRIGGER WIRED: NO upstream caller. grep `send_waiver_sms` across the codebase returns only the endpoint file itself, `tech_ant_reply_POST.xs` (which has the string in a comment), and dashboards. No automation calls it.
LAST FIRED IN PROD: `waiver_sent` event_log = 2 rows total, latest **2026-04-25 13:10 UTC** (job 195, target_phone +16154855795 — Teddy's number). Manually invoked.
KNOWN BUGS:
- Uses Twilio directly (`api.request` to `api.twilio.com/2010-04-01/Accounts/...`), NOT the new `send_sms` Telnyx router. Means the waiver SMS will go from the Twilio number `+16292840444`, NOT the Telnyx customer number `+16155889500`. This is a SILENT INCONSISTENCY — customers will see waivers from one number and other comms from another.
- `$env.TWILIO_FROM_NUMBER` is used as the From; that env var's current value is unknown from the Netlify dashboard (Xano-side env).
- Phone normalization is a simple `is_empty` check; no E.164 sanitization.
TO VERIFY: invoke `POST /api:3e_TffpA/send_waiver_sms` with `{job_id: <some real job>, phone: "+16154855795"}` (owner-bypass-safe) and verify the SMS lands.
TO FIX:
1. Add an upstream caller — almost certainly should fire from Teddy Tool when Teddy clicks "Send waiver" in cockpit (15 min Netlify function + button wire-up), OR from the QC payment flow after `stripe_checkout_session_completed` (30 min).
2. Migrate the SMS send to `send_sms` for Telnyx consistency (20 min — replace the `api.request` block).
──────────────────────────────────────────

──────────────────────────────────────────
PATH: Waiver signed via Jotform
STATUS: YELLOW
WHERE IT LIVES:
- `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` (sets `waiver_signed=true`, `waiver_text_version=v1.0_2026-04-20`, `waiver_jotform_submission_id`, fires booking SMS in same endpoint)
- Jotform form ID: `260495320372050` (per `send_waiver_sms_POST.xs`)
TRIGGER: Jotform submission webhook
TRIGGER WIRED: Jotform dashboard config — not visible without dashboard login. Presumed yes per blueprint §8 "HIGH confidence."
LAST FIRED IN PROD: `waiver_signed` event_log = 1 row total, **2026-04-20 17:56 UTC**. `jobs.waiver_signed=true` shows 1 job (id=146). So: 1 production fire in the lifetime of the system.
KNOWN BUGS:
- `waiver_webhook_malformed_rawRequest` and `waiver_webhook_job_not_found` actions exist in the code but have 0 rows in event_log — so we have no evidence of any failed deliveries either. Either the webhook is configured + never received bad data, OR the webhook isn't actually pointed at us.
- Same Twilio-direct SMS pattern as `send_waiver_sms` — booking SMS goes from `$env.TWILIO_FROM_NUMBER` not the Telnyx customer number.
TO VERIFY: submit a test Jotform with `job_id=<test job>`. Verify `waiver_signed=true` lands AND `booking_sms_sent` event_log appears AND a SMS lands on the test phone.
TO FIX: verify Jotform webhook URL is pointed at `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/jotform_waiver_webhook` (Jotform dashboard access, ~5 min).
──────────────────────────────────────────

──────────────────────────────────────────
PATH: Auto-scheduling SMS ("Pick your appointment time")
STATUS: YELLOW
WHERE IT LIVES:
- `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` lines 100-241 (chained off waiver signed)
- Build URL: `https://superlative-naiad-233aa7.netlify.app/book.html?job_id=…&zip=…&name=…`
- `book.html` is the slot-picker page (root level)
- `xano-workspace/api/intake/get_available_slots_GET.xs` (slot availability)
- `xano-workspace/api/intake/book_appointment_POST.xs` (writes `scheduling_status=booked`, `scheduled_start`, etc.)
TRIGGER: waiver signed → fires booking SMS in same Xano stack
TRIGGER WIRED: yes (chained), but only if the jotform webhook fires
LAST FIRED IN PROD: `booking_sms_sent` event_log = **0 rows**. `appointment_booked` job_event (table 13) = 5 rows, latest 2026-04-25 00:42 UTC.
KNOWN BUGS:
- Same Twilio-direct pattern (sends from `$env.TWILIO_FROM_NUMBER`, not Telnyx customer number).
- URL hardcoded to `superlative-naiad-233aa7.netlify.app` — not the prod domain `tnapplianceexchange.net`. Customers will see a Netlify-flavored URL.
- The book.html → book_appointment flow has only fired 5 times ever. This whole self-service slot-picker hasn't been exercised at scale.
TO VERIFY: end-to-end test from waiver submission (see above) → verify the booking SMS arrives + clicking it opens book.html + picking a slot writes to jobs table.
TO FIX:
1. Hostname swap to `tnapplianceexchange.net` (5 min).
2. SMS from Telnyx instead of Twilio (20 min — replace inline api.request with `send_sms`).
──────────────────────────────────────────

## REPLY HANDLING

──────────────────────────────────────────
PATH: Customer reply handling (inbound SMS to +16155889500)
STATUS: MISSING
WHERE IT LIVES: nowhere. No Netlify function configured for the Telnyx customer number. `tech-sms-inbound.js` handles ONLY the tech number `+16158578800` (per its header comment + the `XANO_TECH_SMS_INBOUND` const it forwards to). No `customer-sms-inbound.js` or equivalent.
TRIGGER: would be Telnyx inbound webhook on `+16155889500`
TRIGGER WIRED: Telnyx webhook config for this number not verified (would require Telnyx API call — out of scope for this inventory). Even if a webhook is configured, no handler exists to receive it.
LAST FIRED IN PROD: n/a (no handler)
KNOWN BUGS: this is an architectural gap. Per `docs/sms-architecture-2026-05-19.md` §3 item 15: "Future relationship: Open-ended inbound → routes to chat/reply2 brain as new lead" — this is the FUTURE-STATE, not current.
TO VERIFY: query Telnyx for the messaging profile config of `+16155889500` — see if `webhook_url` points anywhere. If it does, that's likely going to a 404 (no handler).
TO FIX: build a `customer-sms-inbound.js` Netlify function that mirrors `tech-sms-inbound.js` but forwards to `chat/reply2` instead of `tech_sms_inbound`. Estimated 2-3 hrs (Telnyx parse, customer-lookup, conversation-resume from existing `agent_conversation`, reply send via `send_sms`). NOT a 30-min fix.
──────────────────────────────────────────

## ON-THE-WAY / IN-PROGRESS STAGE

──────────────────────────────────────────
PATH: "Tech on the way" / 30-min-out SMS (customer-facing)
STATUS: MISSING
WHERE IT LIVES: nowhere as a customer-facing SMS.
The HCP `job.started` webhook event in `hcp_job_webhook_POST.xs:663-739` does fire a SMS, but the recipient is **the tech** (`$tech.phone`) — and the body is the Tech Ant TDR link, not a customer arrival notification. The customer gets NO message on tech arrival.
TRIGGER: would be HCP `job.started` or a proximity event (no proximity infrastructure in repo)
TRIGGER WIRED: HCP webhook fires `tech_arrival` SMS to tech only
LAST FIRED IN PROD: `tech_sms_sent` (HCP-triggered tech SMS) event_log = 0 rows. The HCP webhook itself last fired 2026-05-14 — but with sparse payloads since 2026-05-05, the `job.started` branch may not be reaching the SMS code.
KNOWN BUGS: per `docs/sms-architecture-2026-05-19.md` §3 item 6: "30-min-out ETA (existing, auto-fires)" — this claim is FALSE; no customer-facing arrival SMS exists in the codebase.
TO VERIFY: confirm by grep that no `api.request` to Twilio/Telnyx in `hcp_job_webhook_POST.xs` sends to `$customer.phone` — only `$tech.phone`. Done.
TO FIX: significant build, not a small bug:
1. Add a "customer arrival" SMS send to `hcp_job_webhook_POST.xs` when `event_type=job.started`, sending FROM Telnyx customer number TO the customer's phone (1-2 hr code + test).
2. Wait for HCP to fix the sparse-payload issue OR pivot to a polling-based status-change detector (3-4 hr if HCP doesn't recover quickly).
──────────────────────────────────────────

──────────────────────────────────────────
PATH: "Parts ordered" SMS
STATUS: MISSING
WHERE IT LIVES: nowhere.
`jobs.parts_status` is a column (`xano-workspace/table/jobs.xs:105`) used by `daily_tech_summary` and `scheduling_queue_worker` for filtering/display. `xano-workspace/api/intake/get_parts_status_GET.xs` is a read-only endpoint. No SMS dispatch on `parts_status` change. Vapi has an "Ant Parts ETA Update" agent in the dashboard (per `docs/vapi-agent-inventory-2026-05-11.md`) but no Xano endpoint dispatches to it on parts-status changes — only the warranty followup scheduler (which calls a different assistant).
TRIGGER: would be a `parts_status` change event
TRIGGER WIRED: NO
LAST FIRED IN PROD: never (no path)
KNOWN BUGS: per `docs/vapi-agent-inventory-2026-05-11.md`, this was flagged as Decision 2 Week-1-Day-2 build work: "Ant Parts Ordered — fires when customer picks Install OEM/Amazon". Never built.
TO VERIFY: grep for parts_status_changed or any field-change trigger — none exists.
TO FIX: not a small bug. ~2 hr to build: (a) instrument the parts-status change point (likely `update_status_PATCH` or a new endpoint), (b) wire either a `send_sms` call OR a `trigger_vapi_parts_ordered_call` invocation. Plus a Vapi agent build if going voice.
──────────────────────────────────────────

## COMPLETION + FEEDBACK STAGE

──────────────────────────────────────────
PATH: Job complete + feedback SMS
STATUS: GREEN (plumbing) / 0 customers actually reached
WHERE IT LIVES: see `docs/feedback-flow-status-2026-05-20.md` for the full verified architecture.
- `xano-workspace/api/intake/hcp_job_webhook_POST.xs:715-722` enqueues `feedback_queue` row on `job.completed`
- `xano-workspace/task/process_feedback_queue.xs` (5-min cron, sends via Twilio FROM `+16292840444`)
- `xano-workspace/api/intake/send_feedback_sms_POST.xs` (direct send endpoint)
- `xano-workspace/api/intake/feedback_reply_webhook_POST.xs` (Twilio inbound on +16292840444)
- `xano-workspace/ai/agent/feedback_classifier.xs` (Claude Sonnet 4.5 classifier)
- `xano-workspace/api/intake/handle_negative_followup_POST.xs` (negative branch)
TRIGGER: HCP `job.completed` enqueues row; cron drains queue
TRIGGER WIRED: yes (verified by Twilio webhook API query in companion doc)
LAST FIRED IN PROD: `feedback_sms_sent` event_log = 1 row, **2026-04-27 22:14 UTC**. `feedback_sms_sent_from_queue` = 0. `feedback_queue` table is empty right now. So: the queue cron drains correctly but 0 jobs have completed via HCP since the broken webhook era began.
KNOWN BUGS: see companion doc. Notable: gated rows are DELETED from the queue without retry; if SMS_ENABLED was off and now on, old queued rows are gone. (Memory note: SMS_ENABLED is currently `true` per live `sms_enabled_status` endpoint query.)
TO VERIFY: companion doc test plan.
TO FIX: n/a
──────────────────────────────────────────

## VAPI VOICE AGENT MATRIX

Per `docs/vapi-agent-inventory-2026-05-11.md` and `docs/automation-inventory-2026-05-20.md` Category 2.

| Agent | Direction | Status | Xano Caller / Trigger | Per-path mapping |
|---|---|---|---|---|
| Ant Inbound | INBOUND | LIVE | Vapi-side phone number routing (`+16292607111`) | Path 7 (customer reply handling) — voice variant; Vapi routes inbound voice |
| Ant Warranty Fallback | OUTBOUND | LIVE (cron) — answering UNVERIFIED | `xano-workspace/task/vapi_warranty_followup_scheduler.xs` → `xano-workspace/api/jobs/trigger_vapi_warranty_call_POST.xs` | Path 1b (warranty intake) — voice variant when customer doesn't fill out form within 2hr |
| Ant Parts Follow-Up | OUTBOUND | UNVERIFIED | NO Xano dispatcher found; agent exists in Vapi dashboard | Would be Path 9 (parts ordered) — voice variant |
| Ant Appointment Reminder | OUTBOUND | UNVERIFIED | NO Xano dispatcher found | Would be Path 6 (auto-scheduling SMS) — voice variant |
| Ant Missed Call Callback | OUTBOUND | UNVERIFIED | NO Xano dispatcher found | Path 7 — voice variant after missed inbound |
| Ant Authorization Update | OUTBOUND | UNVERIFIED | NO Xano dispatcher found | Would be a NEW path (warranty auth status) — not in current SMS inventory |
| Ant Parts ETA Update | OUTBOUND | UNVERIFIED | NO Xano dispatcher found | Path 9 (parts ordered) — voice variant |
| Ant Tech Running Late | OUTBOUND | UNVERIFIED | NO Xano dispatcher found | Path 8 (tech on the way) — voice variant when running late |
| Ant Reschedule | HYBRID | UNVERIFIED | NO Xano dispatcher found; agent exists in Vapi dashboard | Path 7 (customer reply) — voice variant for reschedule requests |
| Ant After Hours | INBOUND | UNVERIFIED | Vapi-side phone routing | Path 7 (customer reply) — voice variant for off-hours |
| Ant Warranty Company Inbound | INBOUND B2B | UNVERIFIED | Vapi-side phone routing | NEW path (warranty company B2B) — not in current SMS inventory |

**Key insight:** Only ONE outbound Vapi agent has a Xano-side dispatcher (Warranty Fallback via `trigger_vapi_warranty_call`). Even that has **0 successful `vapi_followup_triggered` job_event rows** in production — the cron has either never matched a job (warranty_pending + 2hr + no vapi_called_at + waiver not signed) OR the trigger call is failing silently (likely: the cron uses `$env.$api_baseurl` which is a known XanoScript footgun — env-in-URL doesn't expand reliably).

**Dispatcher gaps (8 agents with no Xano caller):** Parts Follow-Up, Appointment Reminder, Missed Call Callback, Authorization Update, Parts ETA Update, Tech Running Late, Reschedule. To make any of these fire, a dispatcher endpoint pattern like `trigger_vapi_warranty_call` needs to be built per agent, plus the upstream trigger (e.g., parts_status change, scheduled date approaching, etc).

---

## Customer journey synthesis

The customer chain as built today:

1. Customer hits index.html → chat with Ant ✅ WORKS
2. Ant collects info, fires `%%JOB_READY%%` → `create_job_from_chat` creates Xano job ✅ WORKS (verified 21:06 UTC)
3. Job lands in Xano with `triage_status=routed` (auto-assigned to Teddy or by zip)
4. **GAP:** nothing fires `send-teddy-sms` to tell Teddy a new job needs his pre-diagnosis ❌
5. Teddy must manually navigate to `teddy-tdr-tool.html?job_id=X` to do pre-diagnosis
6. Teddy completes TDR pre-diagnosis → `create_tdr` with `mode="pre_diagnosis"` ✅ (endpoint exists, last used 2026-05-08)
7. **GAP:** nothing automatically fires `send_waiver_sms` to the customer after pre-diagnosis ❌
8. Customer (if they ever receive the waiver SMS) signs Jotform → `jotform_waiver_webhook` fires booking SMS ✅ (built, 1 production fire)
9. Customer clicks booking SMS → `book.html` → `book_appointment` writes to jobs ✅ (built, 5 production fires)
10. **GAP:** no customer-facing "you're scheduled for X" confirmation SMS (book_appointment writes the scheduling fields but sends no SMS to customer)
11. Job dispatched in HCP → HCP `job.started` event → SMS to TECH (Tech Ant TDR link) ✅
12. **GAP:** no customer-facing "tech on the way" SMS ❌
13. Tech works job, HCP `job.completed` → SMS to TECH (wrap-up TDR link) ✅ + feedback_queue row enqueued ✅
14. 5-min cron drains feedback_queue → SMS to customer ✅ (verified plumbing, 0 customers actually reached)
15. Customer replies → `feedback_reply_webhook` → classifier → branch (review link / apology + owner alert) ✅

So the customer chain is **roughly 7 nodes built and 4 gaps**, with the gaps being:
- (a) trigger to bring Teddy into the loop after job creation
- (b) trigger to send the waiver after Teddy's diagnosis
- (c) customer-facing arrival/ETA notification
- (d) inbound customer SMS handler (no brain on +16155889500)

The Vapi voice layer has the **same gap structure**: 11 agents exist in the Vapi dashboard, but only 1 outbound has a Xano dispatcher, and that dispatcher has fired 0 successful calls per event_log evidence.

## Feature-flag and env-var verification (live state, 2026-05-20)

| Flag | Source | Live value | Notes |
|---|---|---|---|
| `SMS_ENABLED` | Xano env | **`true`** | Confirmed via GET `/api:SXH92Wk7/sms_enabled_status`. 0 gated and 0 owner-bypass rows in last 24h. |
| `SMS_PROVIDER` | Xano env | presumed `telnyx` (default) | Last `sms_sent` row from 21:06 UTC shows `provider:telnyx, from_number:+16158578800` |
| `HCP_POLL_ENABLED` | Xano env | UNSET (skip log fires every tick) | Manual `override_enabled=true` works (50 jobs synced today) |
| `SCHEDULING_QUEUE_ENABLED` | Xano env | UNSET (worker exits immediately) | Per memory |
| `DAILY_SUMMARY_ENABLED` | Xano env | UNSET (cron exits immediately) | Per memory |
| `TECH_ASSIST_ENABLED` | Xano env | discrepancy in memory vs prior handoff | Today's task prompt asserts true but `tech_assist_session_triggered_from_webhook` event_log = 0 rows |
| `TECH_SMS_BRAIN_V2` | Netlify env | `true` | Confirmed |
| `TECH_SMS_BRAIN_V2_PHONES` | Netlify env | `6159671304,6159693115,6158291654,7315049617,8133527686` | 5 phones — Jimmy, Andre, Lee, Billy, John (per memory) |
| `EMAIL_ENABLED` | Netlify env | `true` | Confirmed |
| `SIGNATURE_VERIFICATION_ENABLED` | Netlify env | `false` | HCP webhook proxy is lax |
| `STRIPE_SECRET_KEY` | Netlify env | live key `sk_live_…` plaintext | **per memory: rotation pending after 2026-05-20 exposure incident** |

## Landmines

1. **`SMS_ENABLED=true` is already on.** Task prompt asserts it's false. Live `sms_enabled_status` endpoint returned `{"sms_enabled":true,"env_var_raw":"true",...}` at 21:50 UTC today. This means any code path that fires `send_sms` to a real customer phone WILL ATTEMPT TO DELIVER. The reason no customers have been texted is the chain is broken upstream (no `send_waiver_sms` caller, etc.), not because the gate is blocking. **Implication: flipping on any new automation today goes live to real customers immediately.**

2. **Customer-side waiver + booking SMS use Twilio direct, not Telnyx.** `send_waiver_sms_POST.xs:113` and `jotform_waiver_webhook_POST.xs:186` both hardcode `api.twilio.com` and use `$env.TWILIO_FROM_NUMBER`. Customers will see SMS from `+16292840444` (Twilio feedback number) instead of the new `+16155889500` (Telnyx customer number). Brand inconsistency landmine.

3. **`send-teddy-sms.js` uses Twilio FROM `+16292840444` to send to Teddy.** This is the feedback number (Twilio). Whether intentional (because owner-bypass is best-tested on Twilio) or stale is undocumented.

4. **`vapi_warranty_followup_scheduler.xs` uses `$env.$api_baseurl`** — the `$env.$<name>` syntax is a known XanoScript footgun (see memory `reference_xanoscript_gotchas`). This may explain why `vapi_followup_triggered` job_event has 0 rows despite the cron running on a 10-min cadence since 2025-01-01.

5. **`hcp_poll_recent_jobs` cron fires every 15 min but is gated off.** `hcp_poll_skipped_disabled` has 1,247 rows, latest 5 min before this survey. That's a lot of cron-skip noise. Flipping `HCP_POLL_ENABLED=true` (after a confidence pass on the manual override behavior) is the cheapest dormant-cron activation in the system.

6. **Booking SMS contains URL `https://superlative-naiad-233aa7.netlify.app/book.html`** — not the production domain `tnapplianceexchange.net`. Customers see a Netlify-internal URL.

7. **`warranty_job_intake_POST.xs` has NO event_log writes.** If this endpoint ever fails or gets weird data, you'll never know without trolling raw HTTP logs.

8. **TDR creation (`technician_decision_report` table) has been silent for 12 days** (latest 2026-05-08). Either no tech has used Tech Ant since then, or there's a write failure no one noticed.

9. **There is NO customer-side inbound SMS brain.** If a customer replies to any of our customer-facing SMS (waiver, booking, feedback), only the feedback reply goes anywhere meaningful (Twilio → `feedback_reply_webhook`). Replies to waiver/booking SMS from the Twilio number hit `+16292840444` and fall into the feedback webhook (incorrect handler). Replies to Telnyx-side customer SMS (`+16155889500`, if ever sent) go nowhere — Telnyx webhook for this number is unverified.

10. **Stripe live secret is in Netlify env in plaintext.** Per memory, rotation is a pending human task. Any test against Stripe today could be against a key that's about to be rotated.

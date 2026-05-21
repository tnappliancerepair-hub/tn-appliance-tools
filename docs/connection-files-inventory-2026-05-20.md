# Connection Files Inventory — 2026-05-20

What this lists: every file in the repo that handles a connection to an external service OR receives a webhook from the app frontend — across four buckets:

- **A. Netlify functions** — `netlify/functions/*.js` (top-level only)
- **B. Xano API endpoints** — `xano-workspace/api/**/*.xs`
- **C. Xano scheduled tasks** — `xano-workspace/task/*.xs`
- **D. Xano AI agents** — `xano-workspace/ai/agent/*.xs`

What this does NOT list: helper libs under `netlify/functions/_lib/`, Xano `table/*.xs`, Xano `function/*.xs`, frontend HTML/JS, or any admin-UI wiring. The question of "what is wired in admin UIs" (Twilio console, Vapi console, HCP webhooks, Jotform forms, Stripe products) is a separate audit.

**Direction convention:** From this codebase's perspective.
- `inbound` = receives webhooks/requests from external (or from our own frontend, treated as inbound to backend)
- `outbound` = calls external APIs out
- `both` = does both in a single file

**Git note:** `xano-workspace/` is in `.gitignore`. Last-touched dates for those files come from filesystem mtime, not git. Netlify-functions dates come from git.

---

## Summary by external service

| Service | # files | Inbound | Outbound | Both |
|---|---:|---:|---:|---:|
| Twilio (SMS) | 13 | 2 | 9 | 2 |
| Telnyx (SMS) | 1 | 1 | 0 | 0 |
| HCP (Housecall Pro) | 9 | 2 | 6 | 1 |
| Stripe | 8 | 2 | 6 | 0 |
| Vapi | 7 | 1 | 4 | 2 |
| Anthropic (Claude) | 7 | 0 | 7 | 0 |
| Gmail (Google API) | 3 | 0 | 3 | 0 |
| AHS / Frontdoor (via Gmail + Make.com) | 4 | 4 | 0 | 0 |
| ServicePower / SquareTrade (via Gmail) | 3 | 3 | 0 | 0 |
| NSA (vendor — manual / payments) | 1 | 1 | 0 | 0 |
| Jotform (webhook in) | 2 | 2 | 0 | 0 |
| AWS S3 | 3 | 0 | 3 | 0 |
| Gmail send (Netlify send-email) | 2 | 0 | 2 | 0 |
| Internal-only (no external service) | ~95 | n/a | n/a | n/a |

Cross-service notes:
- `tech-sms-inbound.js` (Netlify) counts under both Twilio and Telnyx (auto-detects format)
- `tech-sms-inbound.js` also calls Anthropic (Claude brain for onboarding)
- `vapi_warranty_webhook_POST.xs` is inbound from Vapi but also touches HCP downstream → counted under both
- `stripe_checkout_session_completed_POST.xs` consumes Stripe and writes HCP notes → both
- `ahs_email_intake_POST.xs` is AHS inbound that mints token via Netlify sign-job-token and sends Twilio SMS

---

## Detailed listing by service

### Twilio (SMS — outbound + inbound)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| tech-sms-inbound.js | `netlify/functions/tech-sms-inbound.js` | inbound | Receives tech SMS from Twilio (and Telnyx), routes through onboarding brain (Anthropic) or daily-mode stub | 2026-05-20 fix(tech-sms): brain param remap + bundle prompt file |
| send-teddy-sms.js | `netlify/functions/send-teddy-sms.js` | outbound | Owner-targeted SMS send via Twilio (SMS_ENABLED-gated) | 2026-05-11 SMS_ENABLED kill-switch |
| send_sms_POST.xs | `xano-workspace/api/intake/send_sms_POST.xs` | outbound | Central SMS wrapper: gates on SMS_ENABLED, supports Twilio + Telnyx provider switch | 2026-05-20 (fs mtime) |
| tech_sms_inbound_POST.xs | `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` | inbound | Xano-side inbound SMS handler called by Netlify shim; phone lookup + Anthropic onboarding | 2026-05-20 (fs mtime) |
| send_waiver_sms_POST.xs | `xano-workspace/api/intake/send_waiver_sms_POST.xs` | outbound | Sends warranty-waiver Jotform link to customer via send_sms wrapper | 2026-05-11 (fs mtime) |
| send_feedback_sms_POST.xs | `xano-workspace/api/intake/send_feedback_sms_POST.xs` | outbound | Sends post-job feedback solicitation SMS | 2026-05-11 (fs mtime) |
| handle_negative_followup_POST.xs | `xano-workspace/api/intake/handle_negative_followup_POST.xs` | outbound | Routes negative feedback into a follow-up SMS to owner | 2026-05-11 (fs mtime) |
| feedback_reply_webhook_POST.xs | `xano-workspace/api/intake/feedback_reply_webhook_POST.xs` | both | Inbound Twilio webhook for customer feedback reply; outbound owner alert via SMS | 2026-05-11 (fs mtime) |
| send_qc_diagnosis_to_customer_POST.xs | `xano-workspace/api/cash_tdr/send_qc_diagnosis_to_customer_POST.xs` | outbound | Sends QC diagnosis / payment link SMS to customer | 2026-05-06 (fs mtime) |
| jotform_waiver_webhook_POST.xs | `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` | both | Jotform-inbound + outbound self-schedule SMS via send_sms | 2026-05-11 (fs mtime) |
| daily_tech_summary.xs | `xano-workspace/task/daily_tech_summary.xs` | outbound | Cron — texts each tech today's job summary via Twilio | 2026-05-11 (fs mtime) |
| process_feedback_queue.xs | `xano-workspace/task/process_feedback_queue.xs` | outbound | Cron — pulls due feedback_queue rows and sends SMS | 2026-05-11 (fs mtime) |
| scheduling_queue_worker.xs | `xano-workspace/task/scheduling_queue_worker.xs` | outbound | Cron — broadcast handler sends SMS to qualified techs | 2026-05-11 (fs mtime) |
| compute_tech_assist_escalation.xs | `xano-workspace/task/compute_tech_assist_escalation.xs` | outbound | Cron — SMS owner when tech-assist session goes stale | 2026-05-11 (fs mtime) |
| get_tech_for_zip_POST.xs | `xano-workspace/api/intake/get_tech_for_zip_POST.xs` | outbound | Tech-lookup helper, mentions twilio in comments only — verify | 2026-05-11 (fs mtime) |
| start_tech_assist_session_POST.xs | `xano-workspace/api/intake/start_tech_assist_session_POST.xs` | outbound | Starts tech-assist session, sends opening SMS via send_sms | 2026-05-11 (fs mtime) |
| tech_assist_chat_POST.xs | `xano-workspace/api/intake/tech_assist_chat_POST.xs` | outbound | Tech-assist chat turn; outbound SMS via send_sms + Anthropic call | 2026-05-11 (fs mtime) |

### Telnyx (SMS)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| tech-sms-inbound.js | `netlify/functions/tech-sms-inbound.js` | inbound | Same file as Twilio — auto-detects Telnyx vs Twilio payload format | 2026-05-20 fix(tech-sms): brain param remap |
| send_sms_POST.xs | `xano-workspace/api/intake/send_sms_POST.xs` | outbound | SMS wrapper supports Telnyx provider switch alongside Twilio | 2026-05-20 (fs mtime) |

### HCP (Housecall Pro)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| hcp-webhook-proxy.js | `netlify/functions/hcp-webhook-proxy.js` | inbound | Netlify gateway: receives HCP webhook, HMAC-signs, forwards to Xano hcp_job_webhook | 2026-05-06 DIAG: log raw HCP webhook body |
| hcp-api-probe.js | `netlify/functions/hcp-api-probe.js` | outbound | One-off HCP API debug probe (diagnostic, marked for removal) | 2026-05-06 DIAG |
| hcp_job_webhook_POST.xs | `xano-workspace/api/intake/hcp_job_webhook_POST.xs` | inbound | Receives HCP webhook events; creates/updates jobs (HCP webhooks sparse since 2026-05-05) | 2026-05-11 (fs mtime) |
| hcp_poll_recent_jobs_POST.xs | `xano-workspace/api/intake/hcp_poll_recent_jobs_POST.xs` | outbound | Pulls recent HCP jobs (workaround for sparse webhooks) | 2026-05-08 (fs mtime) |
| hcp_backfill_recent_jobs_POST.xs | `xano-workspace/api/intake/hcp_backfill_recent_jobs_POST.xs` | outbound | One-shot HCP backfill paginator | 2026-05-08 (fs mtime) |
| reattribute_hcp_techs_POST.xs | `xano-workspace/api/intake/reattribute_hcp_techs_POST.xs` | outbound | Maps HCP technician IDs to our techs (queries HCP API) | 2026-05-08 (fs mtime) |
| create_job_POST.xs | `xano-workspace/api/intake/create_job_POST.xs` | outbound | Creates a job and POSTs to HCP /jobs | 2026-05-08 (fs mtime) |
| create_tdr_POST.xs | `xano-workspace/api/intake/create_tdr_POST.xs` | outbound | Creates TDR, writes HCP job note | 2026-05-06 (fs mtime) |
| add_tdr_note_to_hcp_POST.xs | `xano-workspace/api/intake/add_tdr_note_to_hcp_POST.xs` | outbound | Appends TDR note to HCP job via HCP API | 2026-05-01 (fs mtime) |
| validate_tdr_completeness_POST.xs | `xano-workspace/api/intake/validate_tdr_completeness_POST.xs` | outbound | Validates TDR + may post to HCP | 2026-05-04 (fs mtime) |
| derive_appliance_from_notes_POST.xs | `xano-workspace/api/intake/derive_appliance_from_notes_POST.xs` | outbound | Reads HCP notes to derive appliance | 2026-05-08 (fs mtime) |
| reclassify_ahs_jobs_POST.xs | `xano-workspace/api/intake/reclassify_ahs_jobs_POST.xs` | outbound | Reclassifies HCP-sourced AHS jobs | 2026-05-07 (fs mtime) |
| stripe_checkout_session_completed_POST.xs | `xano-workspace/api/cash_tdr/stripe_checkout_session_completed_POST.xs` | both | Stripe webhook handler; posts HCP note on payment | 2026-05-06 (fs mtime) |
| hcp_poll_recent_jobs.xs (task) | `xano-workspace/task/hcp_poll_recent_jobs.xs` | outbound | Cron — calls hcp_poll_recent_jobs endpoint every 15 min | 2026-05-07 (fs mtime) |

### Stripe

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| stripe-webhook.js | `netlify/functions/stripe-webhook.js` | inbound | Receives Stripe webhook, verifies signature, forwards to Xano | 2026-05-06 Phase 1c step 3d.3 fix |
| stripe_checkout_session_completed_POST.xs | `xano-workspace/api/cash_tdr/stripe_checkout_session_completed_POST.xs` | inbound | Xano-side handler for checkout.session.completed | 2026-05-06 (fs mtime) |
| qc_create_checkout_session_POST.xs | `xano-workspace/api/cash_tdr/qc_create_checkout_session_POST.xs` | outbound | Creates Stripe checkout.session via api.stripe.com | 2026-05-06 (fs mtime) |
| _create_qc_coupon_POST.xs | `xano-workspace/api/cash_tdr/_create_qc_coupon_POST.xs` | outbound | Creates Stripe coupon via api.stripe.com | 2026-05-06 (fs mtime) |
| _stripe_retrieve_session_GET.xs | `xano-workspace/api/cash_tdr/_stripe_retrieve_session_GET.xs` | outbound | GETs a Stripe checkout.session for status check | 2026-05-06 (fs mtime) |
| stripe_smoke_test_GET.xs | `xano-workspace/api/cash_tdr/stripe_smoke_test_GET.xs` | outbound | Smoke test: pings Stripe API to verify creds | 2026-05-06 (fs mtime) |
| qc_diagnosis_view_GET.xs | `xano-workspace/api/cash_tdr/qc_diagnosis_view_GET.xs` | outbound | Loads QC diagnosis incl. Stripe session info | 2026-05-06 (fs mtime) |
| send_payment_link_POST.xs | `xano-workspace/api/intake/send_payment_link_POST.xs` | outbound | Creates Stripe payment link and SMSes to customer | 2026-05-01 (fs mtime) |

### Vapi

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| trigger_vapi_warranty_call_POST.xs | `xano-workspace/api/jobs/trigger_vapi_warranty_call_POST.xs` | outbound | Kicks off outbound Vapi warranty call via api.vapi.ai | 2026-05-01 (fs mtime) |
| trigger_vapi_inbound_test_POST.xs | `xano-workspace/api/intake/trigger_vapi_inbound_test_POST.xs` | outbound | Test endpoint to trigger Vapi inbound flow | 2026-05-01 (fs mtime) |
| trigger_parts_followup_POST.xs | `xano-workspace/api/intake/trigger_parts_followup_POST.xs` | outbound | Triggers Vapi parts-followup call | 2026-05-01 (fs mtime) |
| vapi_warranty_webhook_POST.xs | `xano-workspace/api/jobs/vapi_warranty_webhook_POST.xs` | both | Receives Vapi end-of-call webhook; updates job + may post HCP | 2026-05-01 (fs mtime) |
| vapi_warranty_followup_scheduler.xs | `xano-workspace/task/vapi_warranty_followup_scheduler.xs` | outbound | Cron — finds stale warranty jobs and triggers Vapi calls | 2026-05-01 (fs mtime) |

### Anthropic (Claude API)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| claude-proxy.js | `netlify/functions/claude-proxy.js` | outbound | Generic Claude API proxy for frontend chat | 2026-04-13 |
| tech-sms-inbound.js | `netlify/functions/tech-sms-inbound.js` | outbound | Calls Claude (onboarding brain) for tech SMS handling | 2026-05-20 |
| tech_sms_inbound_POST.xs | `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` | outbound | Anthropic call for onboarding-mode tech reply | 2026-05-20 (fs mtime) |
| tech_assist_chat_POST.xs | `xano-workspace/api/intake/tech_assist_chat_POST.xs` | outbound | Anthropic call for tech-assist conversation turns | 2026-05-11 (fs mtime) |
| chat/reply_POST.xs | `xano-workspace/api/intake/chat/reply_POST.xs` | outbound | Customer-chat reply via Claude | 2026-05-01 (fs mtime) |
| chat/reply_2_POST.xs | `xano-workspace/api/intake/chat/reply_2_POST.xs` | outbound | Next-gen customer-chat reply via Claude | 2026-05-02 (fs mtime) |
| tech_ant_reply_POST.xs | `xano-workspace/api/intake/tech_ant_reply_POST.xs` | outbound | Tech Ant centerpiece — Anthropic-driven reply generator | 2026-05-01 (fs mtime) |
| feedback_classifier.xs | `xano-workspace/ai/agent/feedback_classifier.xs` | outbound | Anthropic agent — classifies feedback SMS reply as positive/negative/unknown | 2026-05-03 (fs mtime) |

### Gmail (Google API — reading mailboxes)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| ahs-gmail-poller.js | `netlify/functions/ahs-gmail-poller.js` | outbound | Polls AHS dispatch mailbox via Gmail API, parses, forwards to Xano | 2026-05-15 Phase 3: Gmail pollers extended for payment-remittance |
| servicepower-gmail-poller.js | `netlify/functions/servicepower-gmail-poller.js` | outbound | Polls ServicePower offer / payment mailbox via Gmail API | 2026-05-15 Phase 3 |
| send-email.js | `netlify/functions/send-email.js` | outbound | Sends email via Gmail API (alert/transactional) | 2026-05-12 send-email: remove env-var diag |

### AHS / Frontdoor (delivered via Gmail + Make.com)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| ahs-gmail-poller.js | `netlify/functions/ahs-gmail-poller.js` | inbound | Poller that ingests AHS dispatch emails (see Gmail above) | 2026-05-15 |
| ahs_email_intake_POST.xs | `xano-workspace/api/intake/ahs_email_intake_POST.xs` | inbound | XML parser endpoint: AHS dispatch → warranty job + sign-job-token + SMS | 2026-05-13 (fs mtime) |
| ahs_payment_intake_POST.xs | `xano-workspace/api/financial/ahs_payment_intake_POST.xs` | inbound | Receives AHS payment remittance lines from poller, matches to jobs | 2026-05-15 (fs mtime) |
| reclassify_ahs_jobs_POST.xs | `xano-workspace/api/intake/reclassify_ahs_jobs_POST.xs` | outbound | Reclassifies legacy HCP-sourced AHS jobs (calls HCP) — listed under HCP | 2026-05-07 (fs mtime) |

### ServicePower / SquareTrade (delivered via Gmail)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| servicepower-gmail-poller.js | `netlify/functions/servicepower-gmail-poller.js` | inbound | Poller for ServicePower offer + payment emails | 2026-05-15 |
| servicepower_email_intake_POST.xs | `xano-workspace/api/intake/servicepower_email_intake_POST.xs` | inbound | Receives parsed ServicePower offer payloads, creates jobs | 2026-05-13 (fs mtime) |
| squaretrade_payment_intake_POST.xs | `xano-workspace/api/financial/squaretrade_payment_intake_POST.xs` | inbound | Receives parsed SquareTrade/ServicePower remittance, books warranty payments | 2026-05-15 (fs mtime) |

### NSA (warranty vendor — payments only)

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| nsa_payment_intake_POST.xs | `xano-workspace/api/financial/nsa_payment_intake_POST.xs` | inbound | NSA remittance intake (mirrors squaretrade intake shape) | 2026-05-15 (fs mtime) |

### Jotform

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| jotform_waiver_webhook_POST.xs | `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` | inbound | Waiver signature webhook from Jotform; triggers self-schedule SMS | 2026-05-11 (fs mtime) |
| warranty_job_intake_POST.xs | `xano-workspace/api/intake/warranty_job_intake_POST.xs` | inbound | Warranty Jotform → job creation (gold-standard intake) | 2026-05-01 (fs mtime) |

### AWS S3

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| s3-presign.js | `netlify/functions/s3-presign.js` | outbound | Signs S3 PUT presigned URL for upload | 2026-04-25 |
| s3-view-url.js | `netlify/functions/s3-view-url.js` | outbound | Signs S3 GET presigned URL for viewing attachments | 2026-04-25 |
| generate_upload_url_POST.xs | `xano-workspace/api/intake/generate_upload_url_POST.xs` | outbound | Xano-side S3 presign for direct uploads | 2026-05-02 (fs mtime) |

### Internal-only (no external service — proxies, business logic, DB reads/writes)

Netlify functions:

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| agent-chat-proxy.js | `netlify/functions/agent-chat-proxy.js` | outbound | Proxies frontend → Xano agent chat | 2026-04-27 |
| create-job-proxy.js | `netlify/functions/create-job-proxy.js` | outbound | Proxies frontend → Xano create job | 2026-04-15 |
| get-job-proxy.js | `netlify/functions/get-job-proxy.js` | outbound | Proxies frontend → Xano get job | 2026-04-12 |
| get-tech-jobs-proxy.js | `netlify/functions/get-tech-jobs-proxy.js` | outbound | Proxies frontend → Xano tech jobs | 2026-04-19 |
| verify-pin-proxy.js | `netlify/functions/verify-pin-proxy.js` | outbound | Proxies PIN verification to Xano | 2026-04-19 |
| create-warranty-job-proxy.js | `netlify/functions/create-warranty-job-proxy.js` | outbound | Proxies frontend → Xano warranty job creation | 2026-04-30 |
| generate-qc-token.js | `netlify/functions/generate-qc-token.js` | internal | HMAC-SHA256 token mint for QC diagnosis links | 2026-05-05 |
| validate-qc-token.js | `netlify/functions/validate-qc-token.js` | internal | HMAC-SHA256 token validation | 2026-05-05 |
| sign-job-token.js | `netlify/functions/sign-job-token.js` | internal | HMAC-SHA256 token mint for chat links (called by Xano) | 2026-05-11 |
| xano-proxy.js | `netlify/functions/xano-proxy.js` | outbound | Generic Xano proxy (Phase 1g Teddy cockpit hydrate) | 2026-05-06 |

Xano API endpoints (~85 files) — selected; all are internal API endpoints that take requests from our own frontend or other endpoints, with no direct external API call. Examples:

- `api/authentication/**` — login/signup/reset (8 files)
- `api/members_accounts/**` — account + user management (7 files)
- `api/routing/**` — service zones + intake sessions (9 files)
- `api/scheduling/bootstrap_tech_schedule_POST.xs`, `log_event_POST.xs`, `update_scheduling_decision_POST.xs`
- `api/jobs/**` — CRUD on jobs, assign/unassign tech, status updates (12 files, except `vapi_warranty_webhook_POST.xs`)
- `api/intake/**` — many CRUD/lookup endpoints (technicians, tech_availability, intake_session, get_*, debug_job, cleanup_*, seed_*, normalize_*, get_tech_assist_session_history)
- `api/event_logs/**` — log readers (3 files)
- `api/financial/**` — get_financial_dashboard, get_job_financial_summary, get_payroll_report, manual_payment_entry, approve_payroll, resolve_dispute, parts_markup_calc (7 files, excluding the 3 intake endpoints above)
- `api/cash_tdr/qc_persist_selections_POST.xs` — persists QC selections (no external)
- `api/quick_check/warranty_webhook_POST.xs` — stub debug endpoint
- `api/admin/sms_enabled_status_GET.xs` — internal kill-switch status reader
- `api/admin/send_email_POST.xs` — internal email wrapper that proxies to Netlify send-email (counted under Gmail send if external is the target)

Xano tasks (cron):

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| compute_tech_performance_ledger.xs | `xano-workspace/task/compute_tech_performance_ledger.xs` | internal | Nightly performance ledger + pattern detection | 2026-05-03 (fs mtime) |

Xano AI agents:

| File | Path | Direction | Purpose | Last touched |
|---|---|---|---|---|
| xano_example_agent.xs | `xano-workspace/ai/agent/xano_example_agent.xs` | internal | Xano starter agent (xano-free LLM, docs search demo) | 2026-05-01 (fs mtime) |

---

## Notes on classification confidence

- **Counted multi-service files once per service**, so the summary table double-counts: e.g. `tech-sms-inbound.js` appears under Twilio AND Telnyx AND Anthropic.
- A few Xano files mention `twilio` only in comments referencing a legacy field (`twilio_sid`) — these are real Twilio touchpoints because the `send_sms` wrapper they call hits Twilio. Counted them.
- `qc_cockpit_load_GET.xs` mentions twilio only in a code comment ("success-shaped {success:true, twilio_sid:null}") — NOT a Twilio touchpoint, excluded from Twilio table.
- `get_tech_for_zip_POST.xs` mentions twilio — included tentatively; should verify whether it actually sends or just builds payload.
- Heisenberg/ElevenLabs/OpenAI/Google-Maps/Google-Reviews: zero matches in the codebase. Either not built yet or live entirely outside this repo (e.g. Vapi handles voice, no direct ElevenLabs).

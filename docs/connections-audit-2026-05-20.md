# Connections Audit — TN Appliance Exchange Platform

**Date:** 2026-05-20
**Author:** Claude Code (Opus 4.7), read-only audit.
**Scope:** Verify which external services are actually pointed at our endpoints — not just which code paths exist. Companion to `docs/customer-automation-inventory-2026-05-20.md` and `docs/automation-inventory-2026-05-20.md`.
**Method:** Live API queries against Twilio, Stripe, HCP, Netlify, Xano (POST liveness probes), plus on-disk inspection of `xano-workspace/`, `netlify/functions/`, `netlify.toml`, and git tree.

---

## 1. Top-line: Disconnections + Misconfigurations

| # | Service | Resource | Issue | Fix effort | Priority |
|---|---|---|---|---|---|
| D1 | Telnyx | Entire provider | `docs/sms-architecture-2026-05-19.md` claims Telnyx is now PRIMARY for customer + tech SMS and 4 Telnyx numbers exist. **No `TELNYX_API_KEY` in Netlify env. No Telnyx-related env at all.** Zero verifiable Telnyx infrastructure on the platform side. | LARGE — provision keys + 4 numbers in Telnyx, populate 4-5 env vars in Netlify AND Xano, wire 2 webhook URLs at Telnyx. Likely a full work session, not a 15-min fix. | HIGH |
| D2 | Vapi | API key | `xano-workspace/api/jobs/trigger_vapi_warranty_call_POST.xs` and `trigger_vapi_inbound_test_POST.xs` both expect `$env.VAPI_PRIVATE_KEY`. **Not in Netlify env.** Likely set in Xano env directly — cannot verify (no Metadata API env read). 8 of 11 Ant agents claimed live but never exercised through Xano. | SMALL if key is in Xano env (verify via Xano dashboard). MEDIUM if missing — needs Vapi dashboard work to mint + paste. | HIGH |
| D3 | Jotform | Webhook config | `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` exists. **No `JOTFORM_API_KEY` in Netlify env**, so cannot query Jotform API to confirm the form `260495320372050` actually points at the Xano webhook. Form last fired 2026-04-20 per inventory doc — 30 days quiet. | TINY to verify (paste key into local shell, query Jotform API). UNKNOWN to fix until verified. | HIGH |
| D4 | HCP | Webhook subscriptions | Cannot enumerate. Token `dfe291…` works for `/employees`, `/company` but every webhook-list path tested returns 404 (`/webhooks`, `/v2/webhooks`, `/webhook_subscriptions`, `/companies/{id}/webhooks`, `/companies/{id}/webhook_endpoints`). HCP webhook integration is degraded since 2026-05-05 (memory `project_hcp_webhook_incident`). Polling fallback is the live path. | UNKNOWN. HCP support ticket already open per memory. | MED |
| D5 | Vapi | 8 of 11 Ant agents | Per `docs/vapi-agent-inventory-2026-05-11.md`, only 3 agents (Ant Inbound, Ant Warranty Fallback, Ant Parts Follow-Up) are verified live. The other 8 exist in Vapi dashboard but have no Xano caller. | LARGE — orchestration code in Xano per agent. | LOW (week 2+) |
| D6 | Vapi | 4 dev "James Repair" agents | Listed in Vapi dashboard alongside Ant agents; entirely unwired; brand-conflict risk if accidentally activated against TN customers. | TINY to disable/archive in Vapi dashboard. | LOW |
| D7 | Twilio | `+16292477111` (629-247-7111) | Per memory, this is "TN Vapi" — but `sms_url` is empty string and `voice_url` is empty string. **Number is in-use but routes nowhere.** | TINY — set both URLs in Twilio console. | MED |
| D8 | Twilio | `+15703788177` and `+12342193439` (570/234 area codes) | Both `sms_url` and `voice_url` point at `https://demo.twilio.com/welcome/sms/reply` and `…/voice/`. These are Twilio test demo endpoints. Numbers were created Jan 2026; do not match any documented number in memory or in `docs/sms-architecture-2026-05-19.md`. **Mystery numbers, demo-routed.** | TINY if abandoned (release back) — but verify with T first they aren't intentional spares. | MED |
| D9 | Twilio | `+17273508487` (727-350-8487 St. Petersburg FL) | Mystery number. `sms_url` points at `https://tnapplianceexchange.net/.netlify/functions/tech-sms-inbound`. **Not in any documented inventory.** `voice_url` still Twilio demo. | TINY — confirm intent. | MED |
| D10 | Twilio | `+16292840444` voice | `sms_url` correctly wired to feedback_reply_webhook (verified). `voice_url` is still `https://demo.twilio.com/welcome/voice/`. If a customer ever calls this number expecting service, they hit Twilio's demo IVR. | TINY — point at Vapi or owner forward. | MED |
| M1 | Twilio | `+16292607111` (TN Ant Inbound) | Voice routed to `https://api.vapi.ai/twilio/inbound_call` ✓. But per docs, this number is also expected to be Telnyx-managed (D1). Currently lives on Twilio. **Sms_url at `https://api.vapi.ai/twilio/sms`** — fine for now but conflicts with Telnyx-primary plan. | n/a today — wait for Telnyx provision. | DEFER |
| M2 | Twilio | `+15043559111` (LA Vapi) | Same as M1 — wired Twilio→Vapi correctly, but Telnyx-primary doc says LA local should be on Telnyx. | n/a today. | DEFER |
| M3 | Xano legacy | `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` | 2142 lines, known broken per memory. Still receives traffic (fallback path when `TECH_SMS_BRAIN_V2_PHONES` allowlist misses). T's own phone is in allowlist now; 5 phones in allowlist. **All other techs still route to broken Xano file.** | LARGE — finish v2 brain daily-mode + onboarding migration. In flight. | (in flight) |
| M4 | Xano legacy | `event_log` and `job_event` audit gaps | `warranty_job_intake_POST.xs` writes NO event_log row (per customer-automation-inventory). Per `docs/feedback-flow-status` SMS_ENABLED=false in Xano env blocks every customer outbound SMS. | TINY-to-MED depending on which gate. | MED |
| M5 | Netlify | Stripe live key exposed as env-var NAME on 2026-05-20 | Per `docs/security-cleanup-2026-05-20.md`. Rotation a pending human task for T. | TINY (rotate in Stripe dashboard, swap in Netlify). | HIGH (security) |
| M6 | Xano | `SMS_ENABLED=false` in Xano env | Per `feedback-flow-status-2026-05-20.md` and `automation-inventory-2026-05-20.md`. Entire customer feedback pipeline is plumbed and running every 5 minutes but the gate blocks every send except owner-bypass. | TINY (one env flag flip). | HIGH |
| M7 | Xano | `HCP_POLL_ENABLED` env unset | `hcp_poll_recent_jobs` task fires every 15 min but exits at env gate. Only manual `override_enabled=true` runs work. | TINY (one env flag flip). | HIGH |
| M8 | Xano | `SCHEDULING_QUEUE_ENABLED`, `DAILY_SUMMARY_ENABLED`, `LEDGER_TASK_ENABLED`, `TECH_ASSIST_ENABLED` | All scheduled tasks fire on cron but env-gate exit. Built, dormant. | TINY per flag (but careful sequencing — see automation-inventory). | MED |

Status legend: HIGH = costs revenue/customer trust today, MED = visible misconfig, LOW = future-week cleanup.

---

## 2. Per-service detailed entries

### 2.1 Telnyx

──────────────────────────────────────────
SERVICE: Telnyx
RESOURCE: Provider integration as a whole
STATUS: NOT_CONFIGURED
ROUTES TO: (n/a — no credentials present)
LAST USED: unknown
NOTES: `docs/sms-architecture-2026-05-19.md` (1 day old) claims Telnyx is now primary for customer + tech SMS, with 4 active numbers (615 588 9500, 615 857 8800, 888 268 8998 toll-free, 866 268 0111 toll-free). **The Netlify production env has zero Telnyx variables.** `$env.TELNYX_API_KEY`, `TELNYX_FROM_TECH`, `TELNYX_FROM_CUSTOMER`, `TELNYX_PROFILE_ID` are referenced in `xano-workspace/api/intake/send_sms_POST.xs` — meaning they MAY be set inside Xano env (not visible to me through current credentials). Code path EXISTS for both sides (Telnyx inbound dispatcher in `tech-sms-inbound.js`, Telnyx outbound in `send_sms_POST.xs`). What's not verifiable: whether Telnyx has numbers provisioned, whether `+16158578800` and `+16155889500` are real numbers in a Telnyx account, whether the messaging profile `40019e28-9488-4a86-aef9-764f7a8b2891` (referenced in `tech-sms-inbound.js`) exists.
──────────────────────────────────────────

### 2.2 Twilio

7 numbers enumerated via `GET /2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json`. Credentials redacted: `SID:ACefea[redacted]` / `Bearer [redacted]`.

──────────────────────────────────────────
SERVICE: Twilio
RESOURCE: +16292840444 (629-284-0444) — "feedback / customer reply"
STATUS: ACTIVE
ROUTES TO: SMS → `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/feedback_reply_webhook` (POST); Voice → `https://demo.twilio.com/welcome/voice/` (demo)
LAST USED: SMS — actively used. Voice — never expected.
NOTES: Confirmed green-wired for the feedback flow. Voice URL is unconfigured — if someone ever calls this number, they hit Twilio's demo IVR. SID `PN7bae[redacted]`. Date_updated 2026-04-27.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Twilio
RESOURCE: +16292607111 (629-260-7111) — TN Ant Inbound
STATUS: ACTIVE
ROUTES TO: SMS → `https://api.vapi.ai/twilio/sms`; Voice → `https://api.vapi.ai/twilio/inbound_call`; status_callback → `https://api.vapi.ai/twilio/status`
LAST USED: unknown — Vapi handles inbound
NOTES: Wired into Vapi via Twilio shim. SID `PNe10c[redacted]`. Per memory + inventory: assistant ID `7cc98b0c…` (Ant Inbound). This is one of the 3 verified-live Vapi agents.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Twilio
RESOURCE: +15043559111 (504-355-9111) — LA Vapi
STATUS: ACTIVE
ROUTES TO: SMS + Voice → `https://api.vapi.ai/twilio/*` (Vapi shim)
LAST USED: unknown
NOTES: Same pattern as 629-260-7111 — Vapi shim. SID `PNba47[redacted]`.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Twilio
RESOURCE: +16292477111 (629-247-7111) — "TN Vapi" per memory
STATUS: ACTIVE-BUT-UNROUTED
ROUTES TO: sms_url empty string; voice_url empty string
LAST USED: unknown — likely never
NOTES: SID `PN0211[redacted]`. Number is in-use status but BOTH webhook URLs are blank. Inbound SMS or call would silently drop. Per memory expected as "TN Vapi" but no Vapi binding exists.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Twilio
RESOURCE: +17273508487 (727-350-8487 — St. Petersburg FL)
STATUS: ACTIVE
ROUTES TO: SMS → `https://tnapplianceexchange.net/.netlify/functions/tech-sms-inbound`; Voice → Twilio demo
LAST USED: unknown
NOTES: SID `PN5bfa[redacted]`. **Mystery — not in any documented inventory in memory or sms-architecture doc.** Wired to tech-sms-inbound. Date_created 2026-05-03. Could be an experimental/test number left in place.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Twilio
RESOURCE: +15703788177 (570-378-8177 — Pennsylvania) and +12342193439 (234-219-3439 — Ohio)
STATUS: ACTIVE-DEMO-ROUTED
ROUTES TO: SMS → Twilio demo `https://demo.twilio.com/welcome/sms/reply`; Voice → Twilio demo
LAST USED: unknown
NOTES: Both bound to `trunk_sid` (SIP trunks, not standard inbound). 570 SID `PNdfb0[redacted]`, 234 SID `PN60c1[redacted]`. Created Jan 2026. Not referenced anywhere in repo. **Mystery — likely SIP test numbers from a different experiment.**
──────────────────────────────────────────

10DLC campaign status not exposed via the IncomingPhoneNumbers endpoint and would require a `/v1/Services` or messaging-services query — `messaging_service_sid` is null on every number above. Per memory, Twilio 10DLC is in 7th resubmission loop.

### 2.3 Stripe

──────────────────────────────────────────
SERVICE: Stripe
RESOURCE: Webhook endpoint `we_1TU9XN03MYZgTikFPhmGSfDH`
STATUS: ACTIVE
ROUTES TO: `https://tnapplianceexchange.net/.netlify/functions/stripe-webhook` (live mode)
LAST USED: unknown via API; per inventory the Phase 1c step 3d cutover was 2026-05-15
NOTES: Events subscribed: `checkout.session.completed` only. API version `2026-01-28.clover`. Status `enabled`. Created 1778089629 (Mar 2026). **Single webhook only — no other events monitored.** Webhook secret `whsec_1UV[redacted]` matches `STRIPE_WEBHOOK_SECRET` in Netlify env (means HMAC verify is properly tied). Stripe secret key (`sk_live_…`) IS in Netlify env but per `docs/security-cleanup-2026-05-20.md` was exposed as an env-var NAME — rotation pending.
──────────────────────────────────────────

### 2.4 HCP (Housecall Pro)

──────────────────────────────────────────
SERVICE: HCP
RESOURCE: Company account
STATUS: ACTIVE (`/employees`, `/company` queryable)
ROUTES TO: company_id `2653b6e1-943b-49a3-8c18-1a95ef0ab18d`
LAST USED: continuously (HCP poll fires manually via override)
NOTES: API token `dfe291[redacted]` valid for company + employees endpoints. 11 employees enumerated successfully. Bearer auth confirmed.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: HCP
RESOURCE: Webhook subscriptions
STATUS: UNKNOWN — cannot enumerate
ROUTES TO: Per `XANO_HCP_WEBHOOK_URL` env: should be `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook` (via Netlify proxy `hcp-webhook-proxy.js`)
LAST USED: degraded since 2026-05-05 — payloads sparse `{event}` only
NOTES: All known webhook-list endpoints return 404 with the provided token: `/webhooks`, `/v2/webhooks`, `/webhook_subscriptions`, `/companies/{id}/webhooks`, `/companies/{id}/webhook_endpoints`, `/v1/webhooks`. The token scope likely doesn't cover webhook admin. Webhook configuration is managed in the HCP UI (not the API) per common HCP behavior. **Polling fallback via `xano-workspace/task/hcp_poll_recent_jobs.xs` (every 15 min, env-gated) is the live workaround.** Memory note `project_hcp_webhook_incident` records this is being tracked by HCP support.
──────────────────────────────────────────

### 2.5 Jotform

──────────────────────────────────────────
SERVICE: Jotform
RESOURCE: Form 260495320372050 (waiver)
STATUS: UNKNOWN — no credentials available
ROUTES TO: Expected → `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/jotform_waiver_webhook` (POST)
LAST USED: 2026-04-20 (per customer-automation inventory) — 30 days quiet
NOTES: **No `JOTFORM_API_KEY` in Netlify env, no `JOTFORM_*` env anywhere.** Cannot call `GET https://api.jotform.com/form/260495320372050/webhooks?apiKey=…` to verify. Endpoint `jotform_waiver_webhook_POST.xs` exists in Xano. The downstream "Pick your appointment time" SMS sent FROM `jotform_waiver_webhook` uses TWILIO direct (not the Telnyx-primary `send_sms` router — see send_waiver_sms_POST.xs). 30 days of zero waiver submissions could mean (a) no warranty traffic, (b) Jotform webhook broken, (c) form deleted. Needs T to confirm.
──────────────────────────────────────────

### 2.6 Vapi

──────────────────────────────────────────
SERVICE: Vapi
RESOURCE: API account
STATUS: UNKNOWN — cannot list assistants
ROUTES TO: n/a
LAST USED: unknown
NOTES: **No `VAPI_API_KEY` / `VAPI_PRIVATE_KEY` in Netlify env.** Xano code references `$env.VAPI_PRIVATE_KEY`, `$env.VAPI_ASSISTANT_ID`, `$env.VAPI_INBOUND_ASSISTANT_ID`, `$env.VAPI_PHONE_ID_LA`, `$env.VAPI_PHONE_ID_TN` — these are Xano env vars I cannot enumerate without Xano Metadata API env-read access (token has metadata:api scope but the env list endpoint returned 404/unauthorized when probed). Per `docs/vapi-agent-inventory-2026-05-11.md`: 11 Ant + 4 James Repair = 15 assistants in dashboard. Verified live (per blueprint): 3 of 11 — Ant Inbound (assistant `7cc98b0c…`, phone +16292607111), Ant Warranty Fallback, Ant Parts Follow-Up. Vapi → Telnyx mapping in §4 below.
──────────────────────────────────────────

### 2.7 Netlify state

──────────────────────────────────────────
SERVICE: Netlify
RESOURCE: Site `superlative-naiad-233aa7` (`1ecd89fc-8a9c-4fa3-b923-5186759cfc84`)
STATUS: ACTIVE
ROUTES TO: production URL `https://tnapplianceexchange.net`
LAST USED: continuously
NOTES: 22 functions deployed (full list below). 2 scheduled functions in `netlify.toml`: `ahs-gmail-poller` (every 15 min), `servicepower-gmail-poller` (every 15 min). Last 10 production deploys all `ready` state; most recent `6a0e21df` 2026-05-20 21:04 UTC; latest with commit_ref is `6a0dfb1c` (commit `52a28295…`) 2026-05-20 18:19 UTC. **Three "no-sha" deploys above the last commit deploy — these are likely CLI/manual deploys with no associated commit. No `error` state deploys in the recent window.**

**Functions:**
agent-chat-proxy, ahs-gmail-poller, claude-proxy, create-job-proxy, create-warranty-job-proxy, generate-qc-token, get-job-proxy, get-tech-jobs-proxy, hcp-api-probe **(DIAGNOSTIC — should be removed per memory `project_diagnostic_code_to_remove`)**, hcp-webhook-proxy, s3-presign, s3-view-url, send-email, send-teddy-sms, servicepower-gmail-poller, sign-job-token, stripe-webhook, tech-sms-inbound, validate-qc-token, verify-pin-proxy, xano-proxy.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Netlify env vars (production context)
STATUS: 26 keys present
NOTES: Names only (values redacted):
ANTHROPIC_API_KEY, CHAT_TOKEN_SECRET, EMAIL_ENABLED, EMAIL_SHARED_SECRET, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, HCP_API_KEY, HCP_INTERNAL_AUTH_SECRET, HCP_WEBHOOK_SECRET, NETLIFY_GENERATE_QC_TOKEN_URL, NETLIFY_VALIDATE_QC_TOKEN_URL, QC_TOKEN_SECRET, SIGNATURE_VERIFICATION_ENABLED **(=false — webhook signature verify is OFF; intentional per inventory)**, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TECH_SMS_BRAIN_V2 (=true), TECH_SMS_BRAIN_V2_PHONES (5 numbers), TN_AWS_ACCESS_KEY_ID, TN_AWS_S3_BUCKET, TN_AWS_S3_REGION, TN_AWS_SECRET_ACCESS_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, XANO_HCP_WEBHOOK_URL, XANO_METADATA_TOKEN, XANO_WEBHOOK_SHARED_SECRET.

**Missing (referenced in code but not present here):** TELNYX_API_KEY, TELNYX_FROM_TECH, TELNYX_FROM_CUSTOMER, TELNYX_PROFILE_ID, VAPI_API_KEY / VAPI_PRIVATE_KEY, JOTFORM_API_KEY. These may all live in Xano env (which I cannot read without a different scope), but Netlify lacks them entirely.

**No dev/test/staging leftovers detected.** No `TEST_*` / `DEV_*` / `STAGING_*` keys.
──────────────────────────────────────────

### 2.8 GitHub state

──────────────────────────────────────────
SERVICE: GitHub
RESOURCE: Repo `tnappliancerepair-hub/tn-appliance-tools`
STATUS: ACTIVE
NOTES: Branch protection on `main` — **NOT VERIFIABLE.** `gh` CLI not installed in this environment; unauthenticated REST returns 401 for `/branches/main/protection`. Cannot confirm whether main requires PR review, status checks, or signed commits.

**Open PRs:** unknown — `gh` CLI not available; `git ls-remote` of `refs/pull/*/head` was not run to avoid noise.

**Branches:** Only `origin/main` exists locally and remotely. No feature branches in flight.

**Working tree drift:** local is 1 commit ahead of origin/main (HEAD `4b16f72` "single-field search workaround"). Modified-not-staged: `.claude/settings.local.json`, `docs/system-blueprint-cc-reconstruction.md`. Untracked: `docs/automation-inventory-2026-05-20.md`, `docs/customer-automation-inventory-2026-05-20.md`, `docs/feedback-flow-status-2026-05-20.md` (today's inventory work, not yet committed).

**Last 20 commits:** all single-author, on `main`. Recent themes: tech-sms v2 brain shipping today (`4b16f72`, `52a2829`, `17fc93d`, `7e0a88f`), financial-system Phase 0-4 (Phases 0/1/2/3/4 commits 2026-05-15), SMS consent + cosmetic site fixes (`0a03fa3` through `f824c1d`), SEO bulk add (40+20+37 city/symptom/brand pages), AHS poller re-enabled (`0bf1e16`).
──────────────────────────────────────────

### 2.9 Xano state

──────────────────────────────────────────
SERVICE: Xano
RESOURCE: API groups + canonical slugs
STATUS: ACTIVE
NOTES: 11 API groups mapped:

| Group | Canonical | Notes |
|---|---|---|
| `intake` | **3e_TffpA** | 50+ endpoints — primary group for chat, HCP webhook, Jotform webhook, send_sms, feedback, AHS/SP intake |
| `jobs` | **WdAZ3bLA** | job CRUD + Vapi warranty trigger/webhook |
| `scheduling` | `scheduling` (no random slug) | bootstrap_tech_schedule, log_event, **tech_sms_inbound (BROKEN — 2142 lines)**, update_scheduling_decision |
| `Authentication` | eDCxIJvK | tagged xano:quick-start (boilerplate) |
| `Members & Accounts` | weEgCAvo | tagged xano:quick-start |
| `Event Logs` | _KQv0KE1 | tagged xano:quick-start |
| `quick_check` | MKqCxsNZ | warranty_webhook + group def only — likely lightly used |
| `routing` | NJzb6yGO | service zone + intake_session + slot options |
| `cash_tdr` | (unread — `cash_tdr` API group file not located but referenced in scaffolding) | Stripe checkout, QC coupon, smoke test |
| `financial` | (unread) | 10 new endpoints from 2026-05-15 build |
| `admin` | (unread) | send_email, sms_enabled_status |
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Xano
RESOURCE: Scheduled tasks (7 total in `xano-workspace/task/`)
STATUS: ACTIVE on cron — most env-gated (run no-op until env flag set)
NOTES:
- `compute_tech_assist_escalation.xs` — every 15 min (900s), starts 2026-05-04
- `compute_tech_performance_ledger.xs` — daily 04:00 UTC (86400s), env-gated `LEDGER_TASK_ENABLED`
- `daily_tech_summary.xs` — every 15 min (900s), env-gated `DAILY_SUMMARY_ENABLED`
- `hcp_poll_recent_jobs.xs` — every 15 min (900s), env-gated `HCP_POLL_ENABLED`
- `process_feedback_queue.xs` — every 5 min (300s), starts 2024-01-01 — ALWAYS ON
- `scheduling_queue_worker.xs` — every 60s, env-gated `SCHEDULING_QUEUE_ENABLED`
- `vapi_warranty_followup_scheduler.xs` — every 10 min (600s), starts 2025-01-01 — ALWAYS ON
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Xano
RESOURCE: Env vars (referenced by `$env.` in `xano-workspace/`)
STATUS: 30+ env names referenced
NOTES: Cannot read values (Metadata API env endpoint unauthorized with current token). Names referenced:
ANTHROPIC_API_KEY, ANT_TECH_ASSIST_PROMPT, ANT_TECH_DAILY_PROMPT, ANT_TECH_ONBOARDING_PROMPT, AWS_S* (truncated grep), DAILY_SUMMARY_ENABLED, EMAIL_ENABLED, EMAIL_SHARED_SECRET, HCP_API_KEY, HCP_BASE_URL, HCP_INTERNAL_AUTH_SECRET, HCP_POLL_ENABLED, LEDGER_TASK_ENABLED, NETLIFY_VALIDATE_QC_TOKEN_URL, OWNER_PHONE, OWNER_PHONE_NUMBER, SCHEDULING_QUEUE_ENABLED, SEND_SMS_URL, SMS_ENABLED, SMS_PROVIDER, STRIPE_LINK_*, STRIPE_SECRET_KEY, TECH_ASSIST_ENABLED, TELNYX_API_KEY, TELNYX_FROM_CUSTOMER, TELNYX_FROM_TECH, TELNYX_PROFILE_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, VAPI_ASSISTANT_ID, VAPI_INBOUND_ASSISTANT_ID, VAPI_PHONE_ID_LA, VAPI_PHONE_ID_TN, VAPI_PRIVATE_KEY, XANO_WEBHOOK_SHARED_SECRET.

**Two distinct OWNER_PHONE refs** (`OWNER_PHONE` vs `OWNER_PHONE_NUMBER`) — silently divergent if both set with different values. Worth a one-line consolidation pass.
──────────────────────────────────────────

──────────────────────────────────────────
SERVICE: Xano
RESOURCE: Deprecated / broken / TODO REMOVE markers
STATUS: 3 known
NOTES:
- `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` — 2142-line file, known broken (in-flight v2 brain replacement)
- `xano-workspace/table/jobs.xs` comment: `DEPRECATED 2026-05-05: needs_pre_diagnosis - replaced by prediagnosis_pending`
- `xano-workspace/api/intake/send_sms_POST.xs` line 517,798,944,991 — workaround comments for `regex_replace` bug (Footgun #28). Not deprecated, just defensive.

Live endpoint liveness probes (POST with empty body, expect non-2xx but service hits):
- `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/feedback_reply_webhook` → 200, `ERROR_FATAL Error parsing JSON: Syntax error` — endpoint alive, body rejected (expected)
- `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook` → 401, `unauthorized` — endpoint alive, HMAC-verify rejecting (expected per `XANO_WEBHOOK_SHARED_SECRET`)
──────────────────────────────────────────

---

## 3. Vapi ↔ Telnyx / Twilio number cross-reference matrix

| Phone | Provider | Voice routes to | SMS routes to | Vapi assistant (per memory) | Verified live? |
|---|---|---|---|---|---|
| +16292607111 | **Twilio** (not Telnyx) | api.vapi.ai/twilio/inbound_call | api.vapi.ai/twilio/sms | Ant Inbound `7cc98b0c…` | YES (per blueprint) |
| +15043559111 | **Twilio** (not Telnyx) | api.vapi.ai/twilio/inbound_call | api.vapi.ai/twilio/sms | (LA Vapi — assistant ID unverified) | UNVERIFIED |
| +16292477111 | **Twilio** (not Telnyx) | empty (UNROUTED) | empty (UNROUTED) | (claimed "TN Vapi" in memory) | NO — number alive, routes nowhere |
| +16292840444 | **Twilio** (not Telnyx) | Twilio demo | Xano feedback_reply_webhook | (none — feedback only) | YES (feedback) |
| +17273508487 | **Twilio** (not Telnyx) | Twilio demo | Netlify tech-sms-inbound | (none) | UNDOCUMENTED — mystery FL number |
| +15703788177 | **Twilio** SIP trunk | Twilio demo | Twilio demo | (none) | UNDOCUMENTED — mystery PA number |
| +12342193439 | **Twilio** SIP trunk | Twilio demo | Twilio demo | (none) | UNDOCUMENTED — mystery OH number |
| +16158578800 (claimed tech) | **TELNYX** (claimed) | — | tech-sms-inbound (claimed) | (none) | **CANNOT VERIFY — no Telnyx creds** |
| +16155889500 (claimed customer) | **TELNYX** (claimed) | — | (customer inbound — no brain wired) | (none) | **CANNOT VERIFY — no Telnyx creds** |
| 1-888-268-8998 (claimed toll-free) | **TELNYX** (claimed) | Vapi general intake (claimed) | — | (claimed Vapi general intake) | **CANNOT VERIFY** |
| 1-866-268-0111 (claimed toll-free) | **TELNYX** (claimed) | Vapi warranty (claimed) | — | (claimed Vapi warranty agent) | **CANNOT VERIFY** |

**KEY OBSERVATION:** Memory entry says the project has 7 numbers across Telnyx + Twilio. Reality on Twilio: 7 numbers (1 wired-feedback, 2 wired-Vapi-shim, 1 unrouted, 3 demo-routed). Telnyx: zero verified.

---

## 4. Unknowns / could not verify

1. **Telnyx account** — no API key in Netlify env. `docs/sms-architecture-2026-05-19.md` claims 4 numbers + messaging profile `40019e28-9488-4a86-aef9-764f7a8b2891`. None of this is verifiable from the platform side. If Telnyx is wired, the credentials live elsewhere (Xano env, owner's password manager, or 1Password). **Block:** customer-side SMS provider for entire customer pipeline.
2. **Vapi dashboard** — no API key. Cannot enumerate 15 claimed assistants. Cannot confirm which `phoneNumberId` binds to which Twilio number. Cannot confirm assistant IDs. **Block:** Vapi-side wiring health for 11 Ant agents and 4 James Repair agents.
3. **Jotform** — no API key. Cannot confirm form `260495320372050` webhook URL. Last fire 2026-04-20 per repo inventory. **Block:** waiver intake confirmation.
4. **HCP webhook subscriptions** — token doesn't have webhook-admin scope. Cannot list registered webhooks. **Block:** confirming HCP is pointed at `hcp-webhook-proxy` Netlify function URL.
5. **Xano env values** — Metadata API token scope `tenant_center:secrets=15` should allow this, but `/api:meta/workspace/1/env` returns "unauthorized" and `/api:meta/...` host returns 404 from app.xano.com. Need correct env-list endpoint shape OR Xano dashboard click-through. **Block:** confirming whether SMS_ENABLED, HCP_POLL_ENABLED, SCHEDULING_QUEUE_ENABLED, DAILY_SUMMARY_ENABLED, LEDGER_TASK_ENABLED, TECH_ASSIST_ENABLED, TELNYX_API_KEY, VAPI_PRIVATE_KEY actually have live values vs are unset.
6. **GitHub branch protection rules** — `gh` CLI not installed; unauth REST returns 401. Cannot confirm whether main is protected.
7. **Twilio 10DLC campaign status** — not exposed on IncomingPhoneNumbers endpoint. Requires a separate Messaging Services query (`messaging_service_sid` is null on every number). Per memory, 7th resubmission loop — still pending.
8. **Netlify build hooks / deploy notifications** — not audited.

---

## 5. Method log

- Twilio: `GET /2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json` with Basic auth (read-only).
- Stripe: `GET /v1/webhook_endpoints` with Bearer (read-only).
- HCP: `GET /company`, `/employees` succeeded; all `/webhooks*` paths 404'd.
- Netlify: `netlify env:list --json --context production`, `netlify api listSiteDeploys` (read-only).
- Git: `git log`, `git remote -v`, `git status`, `git for-each-ref` (read-only).
- Xano live endpoints: POST with empty body to confirm 200/4xx (no state mutation; both endpoints returned expected error codes confirming liveness).
- File system: `grep` / `ls` / read of `xano-workspace/`, `netlify/functions/`, `netlify.toml`, `docs/`.
- Credentials redacted per memory rule `feedback_redact_credentials`. No credential literals echoed.

---

## PHASE 1 FOLLOW-UP — Telnyx + Vapi audit (2026-05-20 evening)

T provided `TELNYX_API_KEY` + `VAPI_PRIVATE_KEY` on Netlify env (read-only retrieval; will be removed post-audit). Both APIs queried successfully.

### Telnyx — actual state

**4 active phone numbers** (matches expected inventory exactly):

| Number | Vanity | Status | Messaging profile | Voice connection |
|---|---|---|---|---|
| `+18882688998` | 1-888-ANT-8998 | active | `40019e28[...]` | **NULL** |
| `+18662680111` | 1-866-ANT-0111 | active | `40019e28[...]` | **NULL** |
| `+16158578800` | tech | active | `40019e28[...]` | **NULL** |
| `+16155889500` | customer | active | `40019e28[...]` | **NULL** |

**1 messaging profile** (all 4 numbers share it):

```
id: 40019e28[...]
name: " TN Appliance Exchange SMS"  (leading space in name)
enabled: true
webhook_url: https://tnapplianceexchange.net/.netlify/functions/tech-sms-inbound
webhook_api_version: 2
```

**1 voice connection** ("Forward Only", `credential_connection` type, no webhook). Connection is active but not assigned to any phone number (`connection_id: null` on all 4 numbers).

#### Telnyx implications

- **ALL 4 Telnyx numbers route SMS inbound to `tech-sms-inbound`.** Customer messages to `+16155889500`, vanity-line messages to `+18882688998` / `+18662680111`, and tech messages to `+16158578800` all hit the same Netlify function. v2 brain allowlist gates onboarding flow; everything else falls to broken legacy.
- **Zero voice routing on any Telnyx number.** The two vanity numbers (1-888-ANT-8998, 1-866-ANT-0111) are paid for and active but **calls to them are not connected to Vapi or anything else**.
- Memory references `+15043559111` (LA Vapi), `+16292477111` (TN Vapi), `+16292607111` (TN Ant Inbound) as Telnyx — **all three are actually Twilio**, not Telnyx (verified via Vapi `/phone-number` query).

### Vapi — actual state

**15 assistants total:**

| ID | Name | Voice | Model | Notes |
|---|---|---|---|---|
| 2915adea | Outbound James Repair - Dev | sarah | sonnet-4.5 | dev/test |
| 5bc5a428 | Outbound James Repair - Prod | sarah | sonnet-4.5 | dev/test (Prod naming but dev voice) |
| b9f31a9b | James Repair - Dev | sarah | sonnet-4.5 | dev/test |
| 322cda15 | James Repair - Prod | sarah | sonnet-4.5 | dev/test |
| 022faa54 | Ant Warranty Company Inbound | iEBOK9... (Ant) | sonnet-4.6 | |
| f2bb153d | Ant After Hours | Ant | sonnet-4.6 | |
| 5b2a4e7f | Ant Reschedule | Ant | sonnet-4.6 | |
| 264c14fe | Ant Tech Running Late | Ant | sonnet-4.6 | |
| 86755371 | Ant Parts ETA Update | Ant | sonnet-4.6 | |
| 63030edb | Ant AHS Authorization Update | Ant | sonnet-4.6 | |
| 36cd478e | Missed Call Callback | Ant | sonnet-4.6 | |
| 5da286fa | Ant Appointment Reminder | Ant | sonnet-4.6 | |
| b71260b4 | Ant Parts Follow-Up | Ant | sonnet-4.5 | |
| 7cc98b0c | Ant -Inbound | Ant | sonnet-4.5 | |
| 0abe54ec | Ant | Ant | sonnet-4.5 | |

**7 phone-number bindings:**

| Vapi number | Provider | Assistant bound | Notes |
|---|---|---|---|
| `+16292607111` | twilio | `7cc98b0c` Ant -Inbound | ✅ wired |
| `+16292477111` | twilio | `7cc98b0c` Ant -Inbound | ✅ wired |
| `+15043559111` | twilio | **null** | LA — no assistant assigned |
| `+15043800975` | vapi-native | **null** | LA — no assistant assigned |
| `+17315031142` | vapi-native | **null** | unnamed, no assistant |
| `+12342193439` | byo (Twilio +1-234) | `2915adea` Outbound James Repair Dev | ⚠️ dev wired to live BYO number |
| `+15703788177` | byo (Twilio +1-570) | `322cda15` James Repair Prod | ⚠️ dev wired to live BYO number |

### Cross-reference matrix — Telnyx ↔ Vapi

| Number | Source of truth | SMS routes to | Voice routes to |
|---|---|---|---|
| `+16158578800` (tech) | Telnyx | tech-sms-inbound.js ✅ | **not wired** ⚠️ (no voice expected) |
| `+16155889500` (customer) | Telnyx | tech-sms-inbound.js ⚠️ (wrong handler — no customer brain) | **not wired** ⚠️ (no voice expected) |
| `+18882688998` (1-888-ANT-8998) | Telnyx | tech-sms-inbound.js ⚠️ (wrong handler) | **NOT WIRED** 🚨 |
| `+18662680111` (1-866-ANT-0111) | Telnyx | tech-sms-inbound.js ⚠️ (wrong handler) | **NOT WIRED** 🚨 |
| `+16292607111` | Twilio + Vapi | (Twilio side) | Vapi → Ant -Inbound ✅ |
| `+16292477111` | Twilio + Vapi | (Twilio side) | Vapi → Ant -Inbound ✅ (per Vapi; Twilio shows empty URL fields because Vapi uses `voice_application_sid` not `voice_url`) |
| `+15043559111` (LA) | Twilio + Vapi | (Twilio side) | Vapi but **NO assistant** ⚠️ |
| `+15043800975` (LA) | Vapi-native | n/a | **NO assistant** ⚠️ |
| `+17315031142` (unnamed) | Vapi-native | n/a | **NO assistant** ⚠️ |
| `+12342193439` (BYO OH) | Twilio + Vapi BYO | Twilio: demo.twilio.com ⚠️ | Vapi → Outbound James Repair Dev 🚨 (dev assistant on live BYO) |
| `+15703788177` (BYO PA) | Twilio + Vapi BYO | Twilio: demo.twilio.com ⚠️ | Vapi → James Repair Prod 🚨 (dev voice on live BYO) |
| `+16292840444` (feedback) | Twilio | feedback_reply_webhook ✅ | demo.twilio.com ⚠️ |
| `+17273508487` (FL) | Twilio | tech-sms-inbound ⚠️ (undocumented FL) | demo.twilio.com ⚠️ |

### Net new disconnections from Phase 1

| # | Item | Effort |
|---|---|---|
| **D8** | `+18882688998` (1-888-ANT-8998) has NO voice routing on Telnyx. Paid number, ringing nowhere. Need to wire to Vapi (probably `7cc98b0c` Ant -Inbound or a new general inbound assistant) | MEDIUM (Telnyx admin + Vapi BYO setup) |
| **D9** | `+18662680111` (1-866-ANT-0111) — same as above. Warranty-line vanity number, ringing nowhere. Probably wire to `022faa54` Ant Warranty Company Inbound | MEDIUM |
| **D10** | `+15043559111` LA Vapi number has no assistant bound. Per memory, LA expansion is skipped — confirm intent. Either bind to LA-version of Ant or formally retire | TINY (Vapi admin) |
| **D11** | `+15043800975` LA Vapi-native number, no assistant. Same status. | TINY |
| **D12** | `+17315031142` unnamed Vapi-native number, no assistant. Mystery. | TINY |

### Net new misconfigurations from Phase 1

| # | Item | Effort |
|---|---|---|
| **M9** | `+12342193439` BYO routes voice to **Outbound James Repair Dev** assistant (dev brand). Live BYO number → dev assistant = brand-conflict risk | TINY (Vapi: unbind or rebind) |
| **M10** | `+15703788177` BYO routes voice to **James Repair Prod** (sarah voice). "Prod" name but dev brand and dev voice. Same risk | TINY |
| **M11** | Telnyx customer number `+16155889500` SMS routes to `tech-sms-inbound` (tech webhook) — there is no customer-side handler. Inbound customer SMS hits broken legacy via v2-brain fallthrough | MEDIUM (build customer-sms-inbound Netlify function) — already on backlog from earlier audits |
| **M12** | Telnyx vanity numbers `+18882688998`, `+18662680111` SMS routes also to `tech-sms-inbound`. Anyone texting those vanity numbers hits the tech webhook. Probably fine for now if vanity numbers are voice-primary, but worth knowing | TINY (decide intent) |


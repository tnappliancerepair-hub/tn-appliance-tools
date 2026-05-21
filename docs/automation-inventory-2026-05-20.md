# Automation Inventory — 2026-05-20

**Author:** Claude Code (Opus 4.7), read-only survey
**Scope:** Every automation path (SMS, voice, payment, scheduling, intake) — BUILT vs DORMANT vs DEGRADED vs RUNNING.
**Constraint reminder:** read-only inventory; no code, env, or deploys touched. Test plans are written but not executed.

This doc is the snapshot **as the repo + memory show it on the morning of 2026-05-20**, just after tech-sms v2 brain ship (Netlify-orchestrated, Metadata-API direct, bypasses the broken Xano `tech_sms_inbound` endpoint). Five techs are onboarding in the background under watcher `bp2lmsqp9`.

---

## Summary table

| # | Path | State | Blocker | Test today? |
|---|---|---|---|---|
| 1 | Customer-facing chat intake ("Appliance Ant" on index.html) | LIVE | None (chat reply2 working) | YES — low risk |
| 2 | Vapi voice agents (11 Ant agents) | 3 LIVE / 8 UNVERIFIED | Inbound number routing + per-agent verification | PARTIAL — outbound easy, inbound risky |
| 3 | HCP webhook CREATE/UPDATE | DEGRADED (sparse payload since 2026-05-05) | HCP support ticket open | NO — not under our control |
| 3b | HCP polling fallback (`hcp_poll_recent_jobs`) | BUILT, DORMANT | `HCP_POLL_ENABLED` unset | YES — dry-run via `override_enabled=true` |
| 4a | AHS Gmail poller | LIVE (15-min cron, parallel) | None | NO TEST NEEDED — already running |
| 4b | ServicePower Gmail poller | LIVE (15-min cron, parallel) | None | NO TEST NEEDED — already running |
| 5 | Scheduling queue worker | BUILT, DORMANT | `SCHEDULING_QUEUE_ENABLED` unset + TCR + tech availability data | NO — blocked on tech data |
| 6 | Daily summary cron | BUILT, DORMANT | `DAILY_SUMMARY_ENABLED` unset + per-tech `summary_send_time` populated | NO — depends on onboarding completion |
| 7 | Performance ledger | BUILT, DORMANT | `LEDGER_TASK_ENABLED` unset | YES — manual single-run, read-only |
| 8 | Stripe payment flow (Cash TDR) | LIVE end-to-end | None (live keys present) | YES — well-trodden path, but mutates state |
| 9 | Post-job feedback SMS | LIVE (cron always-on; gated by SMS_ENABLED + owner bypass) | None | YES — fire to Teddy's number only (owner-bypass path) |
| 10 | Tech Ant (`tech-ant.html` post-job TDR) | LIVE | PIN auth only | YES — low risk, owner-side |
| 10b | Tech Ant Live (`tech-ant-live.html` in-field) | BUILT, DORMANT | `TECH_ASSIST_ENABLED` + UI build | NO — wired to TECH_ASSIST_ENABLED |
| 11 | Tech Assist v1 backend (escalation cron + bootstrap) | BUILT, DORMANT (env says enabled per memory; never exercised) | Web UI build + tested data flow | NO — high risk, never exercised |
| 12 | Media capture / S3 (photo upload) | LIVE | None | YES — single-photo smoke is trivially safe |
| 13 | Financial dashboard (`financial-dashboard.html`) | LIVE (PIN-gated, read-only) | None | YES — read-only |
| 14 | SMS opt-in compliance page (`/sms-opt-in`) | LIVE + linked from index/Privacy/terms | None | YES — pure HTML view check |
| 15 | Vapi warranty follow-up cron | LIVE (10-min cron; outbound calls firing) | Vapi answering quality not verified | NO — fires real outbound Vapi calls |
| 16 | Cash-TDR public link / customer view | LIVE | None | YES — token validation read-only |
| 17 | Jotform waiver webhook | LIVE | None | YES via fresh Jotform submission |

---

## Detailed entries

### Category 1 — Customer-facing chat intake (Appliance Ant)

#### 1. Homepage chat → `reply_2` → Xano
- **One-line:** Public visitor types into the chat box on `index.html`; Claude responds via Anthropic, persists to `customer` + `intake_session`, emits `__SHOW_CONSENT_CHECKBOX__`, finally creates a `jobs` row via `create_job_from_chat`.
- **Code:**
  - `index.html` line 1668 — `const PROXY = '…/agent-chat-proxy'`
  - `netlify/functions/agent-chat-proxy.js` — 30s timeout, forwards to Xano `api:3e_TffpA/chat/reply2`
  - `xano-workspace/api/intake/chat/reply_2_POST.xs` — main reply handler
  - `xano-workspace/api/intake/create_job_from_chat_POST.xs` — job-create on submit
  - System prompt sits in `$env.SYSTEM_PROMPT` (Xano) — see `prompts/ant_system_prompt_consent_gate_addition.md`
- **Status:** LIVE end-to-end per system-blueprint-v1.md §8 (verified HIGH confidence)
- **Blocker:** None for chat reply. Per memory ("Teddy: paste system-prompt addition into `$env.SYSTEM_PROMPT`" in §17 of blueprint), the consent-gate addendum may not be live in production prompt — verify before relying on chat-side consent rendering.
- **End-to-end test today:** Open `https://tnapplianceexchange.net/`, type one symptom, walk through Yes-text-me branch with Teddy's own phone, ZIP 37013, accept consent gate, verify a `jobs` row appears with `customer_type=self_pay`, `intake_source=web_chat`, `sms_consent=true`. Then DELETE the test job manually.
- **Priority:** today
- **Risk if it fails:** LOW. Test job is owner-only; no customer-facing fallout. SMS sends gated by SMS_ENABLED owner-bypass path (Teddy's number bypasses).

---

### Category 2 — Vapi voice agents

#### 2. The 11 Ant agents
- **One-line:** 11 specialist voice agents in Vapi dashboard (Heisenberg voice, Claude Sonnet LLM, Nova 2 Phonecall transcriber).
- **Code:** Prompts live in Vapi dashboard (not in repo). Invocation patterns:
  - Outbound trigger: `xano-workspace/api/jobs/trigger_vapi_warranty_call_POST.xs`
  - Outbound trigger inventory probe: `xano-workspace/api/intake/trigger_vapi_inbound_test_POST.xs`
  - Webhook callback receiver: `xano-workspace/api/jobs/vapi_warranty_webhook_POST.xs`
  - Scheduled outbound: `xano-workspace/task/vapi_warranty_followup_scheduler.xs` (every 10 min, fires `/WdAZ3bLA/trigger_vapi_warranty_call`)
- **Confirmed LIVE (3 of 11), per blueprint §11:**
  - Ant Inbound — `7cc98b0c…`, +16292607111
  - Ant Warranty Fallback — `0abe54ec…`
  - Ant Parts Follow-Up — `b71260b4…`
- **UNVERIFIED (8 of 11):** Appointment Reminder, Missed Call Callback, Authorization Update, Parts ETA Update, Tech Running Late, Reschedule, After Hours, Warranty Company Inbound. Per `docs/vapi-agent-inventory-2026-05-11.md` they exist in Vapi dashboard but live wiring needs verification.
- **Plus 4 dev agents** (James Repair / Sarah voice) sitting in same dashboard, **NOT wired in**. Brand-conflict if ever activated.
- **Status per blueprint:** "LIVE (cron) end-to-end Vapi-side answering UNVERIFIED" (MED confidence)
- **Blocker:** No code change. Verification is Teddy-side click-through in Vapi dashboard. Numbers + IDs need confirmation.
- **End-to-end test today:** Outbound: `POST /WdAZ3bLA/trigger_vapi_warranty_call` with `{job_id: <test job created via path 1>}`. Answer the phone, hang up after greeting, check `job_event` table for `vapi_followup_triggered` row. Inbound: call `+16292607111` (Ant Inbound) and verify greeting + tool flow works.
- **Priority:** outbound today (low cost). Inbound tomorrow (requires being in a quiet space to talk to it).
- **Risk if it fails:** LOW outbound (Teddy calls Teddy). MED inbound if call routing is mis-configured (could route a real caller wrong) — verify on a phone that's not the main customer line first.

---

### Category 3 — HCP webhook + polling

#### 3a. HCP webhook CREATE/UPDATE
- **One-line:** Housecall Pro pushes `job.appointment_scheduled` / `job.work_status_changed` / `customer.*` events; Netlify proxy HMAC-verifies (currently lax), forwards to Xano.
- **Code:**
  - `netlify/functions/hcp-webhook-proxy.js` (signature verify gated by `SIGNATURE_VERIFICATION_ENABLED=false`)
  - `xano-workspace/api/intake/hcp_job_webhook_POST.xs` (2000+ lines; SMS dispatch by event)
- **Status:** DEGRADED since 2026-05-05. HCP is delivering `{event}` only — no `data` body. Xano accepts the requests but produces zero useful writes. See memory `project_hcp_webhook_incident`.
- **Blocker:** HCP support ticket. NOT under our control.
- **Test today:** Do NOT trigger; nothing to do that the polling fallback (3b) isn't already covering. **Skip.**
- **Risk:** N/A.

#### 3b. HCP polling fallback (workaround)
- **One-line:** Every 15 min, polls HCP `/jobs` REST endpoint for updated_after window, upserts to Xano.
- **Code:**
  - `xano-workspace/task/hcp_poll_recent_jobs.xs` (15-min cron, currently fires but endpoint exits on env gate)
  - `xano-workspace/api/intake/hcp_poll_recent_jobs_POST.xs` (gated by `HCP_POLL_ENABLED == "true"` OR `override_enabled=true` body field)
- **Status:** BUILT, DORMANT. Per blueprint §9 confidence HIGH.
- **Blocker:** `HCP_POLL_ENABLED` env unset in Xano. Manual `override_enabled=true` runs work.
- **End-to-end test today:** `POST /api:3e_TffpA/hcp_poll_recent_jobs` with body `{"override_enabled": true}`. Verify `event_log` actions `hcp_poll_started` + `hcp_poll_finished`. Verify any new HCP rows landed (no double-writes — endpoint dedupes on `housecall_pro_job_id`).
- **Priority:** today (high-value: validates the workaround, builds confidence to flip the env flag)
- **Risk if it fails:** LOW for dry-run (read + idempotent upsert). Worst case: stale data refresh.

---

### Category 4 — Warranty intake automations

#### 4a. AHS Gmail poller
- **One-line:** Every 15 min, reads `tnappliancerepair@gmail.com` for Frontdoor `noreply@msg.frontdoor.com`, extracts dispatch.xml attachment OR parses payment-remittance plaintext, POSTs to Xano `ahs_email_intake` (dispatch) or `ahs_payment_intake` (payment).
- **Code:**
  - `netlify/functions/ahs-gmail-poller.js` (schedule `*/15 * * * *` in netlify.toml)
  - `xano-workspace/api/intake/ahs_email_intake_POST.xs`
  - `xano-workspace/api/financial/ahs_payment_intake_POST.xs`
  - Parser: `netlify/functions/_lib/parsers/ahs-payment.js`
- **Status:** LIVE. Per netlify.toml comment "RE-ENABLED 2026-05-14 — idempotency fix verified via 3-step synthetic test".
- **Blocker:** None.
- **Verify-it-works (read-only):** check Xano `event_log` for `ahs_email_intake_*` rows in last 24h; check `job_email_event` table for fresh `gmail_message_id` entries. Optional: tail Netlify function logs for `[ahs-gmail-poller]` lines.
- **Test today (proactive):** Not strictly needed — already running. Just **observe** last-cron output via Netlify dashboard.
- **Priority:** observe-only today
- **Risk if it fails:** Already running. If it fails, jobs don't auto-land — Danielle/Teddy notice. No test action needed.

#### 4b. ServicePower Gmail poller
- **One-line:** Same architecture as AHS, parses ServicePower plaintext (dispatch + remittance), POSTs to Xano `servicepower_email_intake` or `squaretrade_payment_intake`.
- **Code:**
  - `netlify/functions/servicepower-gmail-poller.js` (schedule `*/15 * * * *` in netlify.toml)
  - `netlify/functions/_lib/parsers/servicepower.js`, `servicepower-payment.js`
  - `xano-workspace/api/intake/servicepower_email_intake_POST.xs`
  - `xano-workspace/api/financial/squaretrade_payment_intake_POST.xs`
- **Status:** LIVE. Per netlify.toml comment "Phase A1 step 13 cleared 2026-05-13. Two-phase Gmail label claim mirrors AHS."
- **Blocker:** Per netlify.toml comment "running in parallel with AHS poller + existing HCP system. NO cutover yet — parallel running + validation phase."
- **Test today:** Same as 4a — observe-only.
- **Priority:** observe-only today
- **Risk if it fails:** Same as 4a.

#### 4c. SquareTrade integration
- Per blueprint: SquareTrade now ships through ServicePower portal (`squaretrade_servicepower` company). The dedicated `squaretrade_payment_intake_POST` endpoint exists at `xano-workspace/api/financial/squaretrade_payment_intake_POST.xs` and is the payment-side handler invoked by the ServicePower poller. **No separate SquareTrade poller.**

---

### Category 5 — Scheduling queue (`SCHEDULING_QUEUE_ENABLED`)

#### 5. Tech Scheduler v2 queue worker
- **One-line:** Every 60s, pulls `scheduling_queue` rows, dispatches broadcast / book / propose / wait / notify / escalate / sick_day_cascade to handlers; sweeps expired `broadcast_attempt` rows.
- **Code:**
  - `xano-workspace/task/scheduling_queue_worker.xs` (60s cron; immediate env-gate exit if not "true")
  - `xano-workspace/api/scheduling/update_scheduling_decision_POST.xs` — TDR processor that enqueues `ready_to_schedule`
  - Inbound claim handler: legacy `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` (broken) → being replaced by `netlify/functions/_lib/brain/onboarding.js` (v2 brain only covers onboarding mode today)
- **Status:** BUILT, DORMANT. `SCHEDULING_QUEUE_ENABLED` env unset. Per six-week-plan: "Flip on a small slice once techs have laid out availability."
- **Blocker:** (a) TCR clearance, (b) tech availability data (5 techs still onboarding via v2 brain TODAY), (c) `tech_sms_inbound` daily mode still relies on the broken Xano endpoint — v2 brain only covers onboarding-mode (per `docs/tech-sms-migration-design-onboarding-2026-05-20.md` "What's deferred to tomorrow").
- **End-to-end test today:** **NO.** Cannot exercise. Daily-mode broadcast tools (`__CLAIM_BROADCAST__` etc.) are not implemented in v2 brain. Flipping `SCHEDULING_QUEUE_ENABLED=true` while techs are mid-onboarding could fan out broadcasts they can't respond to.
- **Priority:** later — wait for v2 brain daily-mode + onboarding completions.
- **Risk if it fails:** HIGH if attempted today. Would SMS-fanout broadcasts to onboarding techs with no working reply path.

---

### Category 6 — Daily tech summary (`DAILY_SUMMARY_ENABLED`)

#### 6. Per-tech morning rundown
- **One-line:** Every 15 min, scans techs whose `daily_summary_time` falls inside the current CT window, sends each one a SMS rundown of today's jobs.
- **Code:**
  - `xano-workspace/task/daily_tech_summary.xs` (15-min cron, env-gate exit)
- **Status:** BUILT, DORMANT. `DAILY_SUMMARY_ENABLED` env unset (per memory).
- **Blocker:** (a) per-tech `daily_summary_time` not populated until each tech finishes onboarding (currently 5 mid-onboarding), (b) `SMS_ENABLED` plus owner-bypass logic — sends to non-owner recipients only when SMS_ENABLED=true.
- **End-to-end test today:** Could trigger for Teddy alone (tech_id=1, owner-bypass path always sends to him), but daily summary requires `daily_summary_time` to match current CT 15-min window — would need to set Teddy's `daily_summary_time` to current-time first. **MED complexity, requires setting a tech field.** Skip today.
- **Priority:** tomorrow after onboarding completes
- **Risk if it fails:** LOW if scoped to Teddy alone via summary_time match.

---

### Category 7 — Performance ledger (`LEDGER_TASK_ENABLED`)

#### 7. Nightly 30-day stats + pattern detection
- **One-line:** Daily 04:00 UTC, computes per-tech 30-day rolling counts (offered / accepted / called_off / helped_out), runs O(N²) bucket scan on `broadcast_decline` event_log entries for {city, dow, time_window} patterns ≥3 → sets `pending_pattern_offer`. Feeds soft-preference offers via Ant.
- **Code:**
  - `xano-workspace/task/compute_tech_performance_ledger.xs` (daily cron, env-gate exit)
- **Status:** BUILT, DORMANT. `LEDGER_TASK_ENABLED` env unset.
- **Blocker:** Need broadcast history to compute against. Currently no broadcasts (queue worker dormant). Manually-running it on current data would produce mostly-empty ledger rows.
- **End-to-end test today:** Trigger task once manually via Xano dashboard. Verify `tech_performance_ledger` rows appear for all 6 techs (would be zero-filled). Read-only at this stage. **Safe but uninformative.**
- **Priority:** later (after scheduling queue produces data)
- **Risk if it fails:** LOW. Pure compute task. No SMS, no customer touch.

---

### Category 8 — Stripe payment flow

#### 8. Cash TDR end-to-end Stripe
- **One-line:** Customer pays $50 Quick Check via Stripe Checkout. `checkout.session.completed` → Netlify HMAC-verify → Xano sets `tdr.confirmed_at`, posts HCP note, SMS Danielle.
- **Code:**
  - `netlify/functions/stripe-webhook.js` — signature verify + forward
  - `xano-workspace/api/cash_tdr/stripe_checkout_session_completed_POST.xs` — handler with shared-secret + idempotency
  - `xano-workspace/api/cash_tdr/qc_create_checkout_session_POST.xs` — mints Stripe Checkout session
  - `xano-workspace/api/cash_tdr/_stripe_retrieve_session_GET.xs` — read-only
  - `xano-workspace/api/cash_tdr/stripe_smoke_test_GET.xs` — built-in smoke test
- **Status:** LIVE end-to-end. Live keys in Netlify prod env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Per blueprint HIGH confidence.
- **Blocker:** None. **WARNING:** `docs/security-cleanup-2026-05-20.md` notes a Stripe live secret key was exposed as an env-var NAME (now deleted) on 2026-05-20 — **rotation is a pending human task for Teddy**. Could affect any test we run if the key has been rotated.
- **End-to-end test today:** Hit `GET /api:VGkW9mcV/stripe_smoke_test` (built-in, side-effect-free read). For an end-to-end live test, Teddy would need to push a $50 Quick Check from his own customer flow (mutates state). **Skip the live mutation; the smoke test is the safe today-test.**
- **Priority:** today via smoke test only
- **Risk if it fails:** Smoke test LOW. Full live Stripe test MED — leaves a real $50 transaction trail.

---

### Category 9 — Post-job feedback SMS

#### 9. Feedback queue + classifier
- **One-line:** When job completes, `feedback_queue` enqueues; cron sends "Reply 5 = great, 0 = had an issue"; reply classified by Claude Sonnet 4.5 → 5 routes to Google review, 0 routes to `handle_negative_followup`.
- **Code:**
  - Enqueue trigger: writes `feedback_queue.send_at`
  - Cron: `xano-workspace/task/process_feedback_queue.xs` (every 5 min; SMS_ENABLED owner-bypass; per memory always-on)
  - Send: `xano-workspace/api/intake/send_feedback_sms_POST.xs`
  - Reply webhook: `xano-workspace/api/intake/feedback_reply_webhook_POST.xs`
  - Classifier agent: `xano-workspace/ai/agent/feedback_classifier.xs` (not glob'd but referenced in blueprint)
  - Negative path: `xano-workspace/api/intake/handle_negative_followup_POST.xs`
- **Status:** LIVE (cron always-on). Per blueprint MED confidence "wired to feedback_reply_webhook".
- **Blocker:** None for cron itself. SMS gated by SMS_ENABLED; owner-bypass works.
- **End-to-end test today:** POST `send_feedback_sms` with `{job_id: <Teddy-test-job>, customer_phone: "+16154855795", customer_first_name: "Teddy"}` — owner-bypass means SMS actually sends. Reply "5" from Teddy's phone, verify classifier routes correctly + Google review link arrives. Then reply "0" from same number on a different job → verify `handle_negative_followup` fires + alert lands on Teddy's phone.
- **Priority:** **TODAY** — exercises classifier, owner-bypass path, and inbound reply webhook in one shot.
- **Risk if it fails:** LOW. Owner-only. Sends to Teddy's phone, classifier writes are append-only.

---

### Category 10 — Tech Ant pages

#### 10a. `tech-ant.html` (post-job TDR)
- **One-line:** Tech opens `/tech-ant.html?job_id=X&tech_id=Y`, PIN-gated, completes TDR (parts, labor, notes, photos). Submits via `tech_ant_reply` Xano endpoint.
- **Code:**
  - `tech-ant.html` (UI)
  - `xano-workspace/api/intake/tech_ant_reply_POST.xs`
  - `xano-workspace/api/intake/verify_tech_pin_POST.xs` + `netlify/functions/verify-pin-proxy.js` (PIN auth)
  - Photo upload: `generate_upload_url_POST.xs` + `netlify/functions/s3-presign.js`
- **Status:** LIVE.
- **Blocker:** None.
- **End-to-end test today:** Open `/tech-ant.html?job_id=<Teddy test job>&tech_id=1`, PIN-verify, submit a TDR with one photo. Verify `tdr` row + `tdr_failure` rows + `attachment` row + S3 object all materialize. **Touches multiple subsystems in one walk.**
- **Priority:** today
- **Risk if it fails:** LOW. Owner-side action. Test job already disposable.

#### 10b. `tech-ant-live.html` (in-field live capture, Tech Assist v1)
- **One-line:** Live in-field capture during the job. Activates on HCP `work_status=in_progress` when `TECH_ASSIST_ENABLED=true`.
- **Code:** `tech-ant-live.html` (UI), `xano-workspace/api/intake/start_tech_assist_session_POST.xs`, `tech_assist_chat_POST.xs`
- **Status:** BUILT, DORMANT. Per blueprint and `docs/tech-scheduler-vs-assist-discovery-2026-05-09.md`.
- **Blocker:** `TECH_ASSIST_ENABLED`. Even with flag on, requires HCP webhook to fire `in_progress` — which is currently DEGRADED (see Category 3).
- **Test today:** **Skip.** End-to-end requires HCP webhook (broken) or manual session-start via `start_tech_assist_session` endpoint. The latter is feasible but never end-to-end-tested.
- **Priority:** later
- **Risk if it fails:** MED if attempted — wires to tech's actual phone via SMS.

---

### Category 11 — Tech Assist v1 backend

#### 11. Escalation cron + on-arrival bootstrap
- **One-line:** Cron every 15 min finds `tech_assist_session` rows in `awaiting_completion` ≥2h stale, SMS-escalates to owner. Bootstrap fires from HCP `in_progress` webhook.
- **Code:**
  - `xano-workspace/task/compute_tech_assist_escalation.xs` (gated by `TECH_ASSIST_ENABLED`)
  - `xano-workspace/api/intake/start_tech_assist_session_POST.xs`
  - `xano-workspace/api/intake/tech_assist_chat_POST.xs`
  - `xano-workspace/api/intake/validate_tdr_completeness_POST.xs`
  - `xano-workspace/api/intake/get_tech_assist_session_history_GET.xs`
  - Bootstrap caller: `hcp_job_webhook_POST.xs` lines 884-911 (additive — does NOT replace tech_arrival SMS)
- **Status:** Per yesterday's handoff per task description: `TECH_ASSIST_ENABLED` currently **true** but never exercised end-to-end. Memory notes "DORMANT MED confidence." Discrepancy: blueprint says dormant; task prompt says env=true. **Verify env state before testing.**
- **Blocker:** Web UI in `tech-ant-live.html` exists but never wired end-to-end through a real `in_progress` HCP event. HCP webhook is degraded, so bootstrap path is essentially untested.
- **End-to-end test today:** Bypass HCP and POST `start_tech_assist_session` directly with `{job_id: <test>, technician_id: 1, session_start_event: "manual_test"}`. Verify `tech_assist_session` row created, then POST `tech_assist_chat` with a message. **Owner-only, no customer impact.** But: never-exercised path → could surface a parser bug, schema mismatch, or prompt missing.
- **Priority:** today **IF you want to validate this works at all** — but be ready for bugs.
- **Risk if it fails:** LOW for the manual-bootstrap-to-Teddy walk. If a token misfires it could SMS-loop, so keep it scoped to Teddy.

---

### Category 12 — Media capture / S3

#### 12. CaptureOverlay + tech-ant photo upload
- **One-line:** Customer or tech captures photo/video → `generate_upload_url` Xano endpoint → `s3-presign` Netlify → uploads direct to S3 bucket `tn-appliance-media-586117210123-us-east-2-an` → `save_attachment` persists row.
- **Code:**
  - `netlify/functions/s3-presign.js` (PUT presign)
  - `netlify/functions/s3-view-url.js` (GET presign)
  - `xano-workspace/api/intake/generate_upload_url_POST.xs`
  - `xano-workspace/api/intake/save_attachment_POST.xs`
  - `xano-workspace/api/intake/get_job_attachments_GET.xs`
  - Used by: `index.html` (line 2852 etc.), `tech-ant.html`, `tech-ant-live.html`, `upload.html`, `view-job.html`, `dashboard.html`
- **Env:** `TN_AWS_S3_BUCKET`, `TN_AWS_ACCESS_KEY_ID`, `TN_AWS_SECRET_ACCESS_KEY`, `TN_AWS_S3_REGION` (TN_ prefix because AWS_ reserved by Netlify)
- **Status:** LIVE.
- **Blocker:** None.
- **End-to-end test today:** Open `/upload.html` (or run from inside chat flow). Upload one photo. Verify it appears in S3 + `attachment` table.
- **Priority:** today (smoke-test of trivially safe path)
- **Risk if it fails:** LOW. Append-only, single test object.

---

### Category 13 — Financial dashboard

#### 13. `financial-dashboard.html`
- **One-line:** PIN-gated read-only owner dashboard. Renders outstanding warranty A/R by company, recent payment batches, payroll readiness, dispute queue.
- **Code:**
  - `financial-dashboard.html` (UI, PIN overlay, served from Netlify root)
  - URL: `https://tnapplianceexchange.net/financial-dashboard.html` (Netlify-served static)
  - Backend: `xano-workspace/api/financial/get_financial_dashboard_GET.xs` (aggregated payload)
  - Related: `get_payroll_report_GET`, `get_job_financial_summary_GET`, `parts_markup_calc_GET`
  - Mutating endpoints (NOT auto-fired): `approve_payroll_POST`, `manual_payment_entry_POST`, `resolve_dispute_POST`, `ahs_payment_intake_POST` (fired by AHS poller), `squaretrade_payment_intake_POST` (fired by ServicePower poller), `nsa_payment_intake_POST`
- **Design doc:** `docs/financial-system-design-2026-05-15.md` (2026-05-15 design)
- **Status:** LIVE. Read endpoints + UI built. Payment intake endpoints exist and wired into AHS + ServicePower pollers.
- **Blocker:** Vendor accounts need to be seeded (Phase 1 of design). 210 paper checks require manual entry. NSA parser is best-effort.
- **End-to-end test today:** Open `/financial-dashboard.html`, PIN-verify, observe payload. Read-only.
- **Priority:** today (read-only verification)
- **Risk if it fails:** LOW. Pure read.

---

### Category 14 — SMS opt-in compliance page

#### 14. `/sms-opt-in`
- **One-line:** 10DLC TCR-compliance page documenting consent flow (two-button affirmative-choice gate), sample messages, opt-out keywords.
- **Code:** `sms-opt-in.html` at repo root → served at `/sms-opt-in` via Netlify
- **Linked from:**
  - `index.html` lines 1403, 1427, 1538, 1606
  - `Privacy.html`
  - `terms.html`
- **Status:** LIVE.
- **Blocker:** None. Per blueprint § "Recent ship history" 2026-05-08 commits, this is the load-bearing TCR resubmission compliance artifact.
- **End-to-end test today:** Hit `https://tnapplianceexchange.net/sms-opt-in` directly. Verify page loads, all anchor links work, footer link from `/` works.
- **Priority:** today (5-min verification)
- **Risk if it fails:** LOW for the page-load test. Underlying TCR approval is what gates production SMS.

---

### Category 15 — Vapi warranty follow-up cron

#### 15. `vapi_warranty_followup_scheduler`
- **One-line:** Every 10 min, finds `jobs.current_status="warranty_pending"` (or `triage_status="warranty_sent"`) older than 2h with `vapi_called_at=null` and `waiver_signed != true`. For each: fires `/WdAZ3bLA/trigger_vapi_warranty_call`.
- **Code:**
  - `xano-workspace/task/vapi_warranty_followup_scheduler.xs`
  - `xano-workspace/api/jobs/trigger_vapi_warranty_call_POST.xs`
  - `xano-workspace/api/jobs/vapi_warranty_webhook_POST.xs` (Vapi callback)
- **Status:** LIVE (cron). End-to-end Vapi answering UNVERIFIED per blueprint §8.
- **Blocker:** None for cron. Vapi-side verification is on Teddy.
- **End-to-end test today:** **NO.** Cron fires real outbound calls to real customer numbers when it finds a qualifying job. Don't trigger.
- **Priority:** later (Teddy verifies by observing one real call)
- **Risk if it fails:** Could call a real customer at the wrong time.

---

### Category 16 — Cash-TDR customer page (public token view)

#### 16. `cash-tdr-customer.html?token=…`
- **One-line:** Customer-facing TDR options page; HMAC-signed token via `generate-qc-token.js`, validated by `validate-qc-token.js`.
- **Code:**
  - `cash-tdr-customer.html` (UI)
  - `netlify/functions/generate-qc-token.js`, `validate-qc-token.js`
  - `xano-workspace/api/cash_tdr/qc_diagnosis_view_GET.xs` (loads TDR)
  - `xano-workspace/api/cash_tdr/qc_persist_selections_POST.xs` (writes customer choice)
- **Status:** LIVE per blueprint §8.
- **Blocker:** None.
- **End-to-end test today:** Use any past test TDR row, mint a token via `generate-qc-token.js`, open the URL, verify TDR renders. Read-only.
- **Priority:** today
- **Risk if it fails:** LOW.

---

### Category 17 — Jotform waiver webhook

#### 17. Jotform → Xano waiver intake
- **One-line:** Jotform `form.jotform.com/260495320372050` submission webhook fires `jotform_waiver_webhook_POST`, sets `waiver_signed=true`, `waiver_text_version=v1.0_2026-04-20`, `waiver_jotform_submission_id`.
- **Code:**
  - `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs`
- **Status:** LIVE per blueprint §8 HIGH confidence.
- **Blocker:** None.
- **End-to-end test today:** Submit the Jotform with a known test job_id. Verify `jobs.waiver_signed=true` after.
- **Priority:** today (low cost; verifies a third-party webhook path that's rarely exercised standalone)
- **Risk if it fails:** LOW.

---

## Feature flag inventory (grep'd from code)

| Flag | Default | Used in |
|---|---|---|
| `SMS_ENABLED` | "false" | Master kill-switch on SMS. Owner-bypass on `+16154855795`. Wraps every send-site (28+ call sites across `tech_sms_inbound`, `feedback_reply_webhook`, `get_tech_for_zip`, `hcp_job_webhook`, `send_sms`, `start_tech_assist_session`, `tech_assist_chat`, `process_feedback_queue`, `send_feedback_sms`, `send_waiver_sms`, `handle_negative_followup`, `jotform_waiver_webhook`) |
| `EMAIL_ENABLED` | "false" | `netlify/functions/send-email.js`, `xano-workspace/api/admin/send_email_POST.xs` |
| `HCP_POLL_ENABLED` | unset | `xano-workspace/api/intake/hcp_poll_recent_jobs_POST.xs` |
| `SCHEDULING_QUEUE_ENABLED` | unset | `xano-workspace/task/scheduling_queue_worker.xs` |
| `DAILY_SUMMARY_ENABLED` | unset | `xano-workspace/task/daily_tech_summary.xs` |
| `LEDGER_TASK_ENABLED` | unset | `xano-workspace/task/compute_tech_performance_ledger.xs` |
| `TECH_ASSIST_ENABLED` | unset (memory says now true per yesterday's handoff — verify before relying) | `xano-workspace/task/compute_tech_assist_escalation.xs`, `start_tech_assist_session_POST.xs`, `hcp_job_webhook_POST.xs` (Phase 1b/1c branch) |
| `SIGNATURE_VERIFICATION_ENABLED` | "false" (verified) | `netlify/functions/hcp-webhook-proxy.js` |
| `TECH_SMS_BRAIN_V2` | "true" today | `netlify/functions/tech-sms-inbound.js` — dispatches to v2 brain |
| `TECH_SMS_BRAIN_V2_PHONES` | (allowlist) | Same file — phone allowlist for v2 brain |
| `SMS_PROVIDER` | "telnyx" | `send_sms_POST.xs` routing (telnyx primary, twilio fallback) |
| `HCP_BACKFILL_ENABLED` | gated, manual | Backfill endpoint |

---

## Surprises / red flags surfaced during the survey

1. **Tech Assist v1: status discrepancy.** Blueprint says DORMANT. Task prompt says yesterday's handoff has `TECH_ASSIST_ENABLED=true`. Memory says "DORMANT MED confidence." The env state needs human verification before any test. The bootstrap path (HCP `in_progress` → `start_tech_assist_session`) has never been exercised end-to-end because HCP webhooks are sparse-degraded.

2. **The legacy Xano `tech_sms_inbound` is broken.** Per `docs/xano-deploy-corruption-explained-2026-05-20.md` it has unresolved-reference corruption. V2 brain in Netlify only covers **onboarding mode**; daily-mode (broadcast claim/decline, owner override, etc.) still relies on the broken endpoint. ALL Tech Scheduler queue work is blocked until daily-mode is migrated tomorrow.

3. **Stripe live secret was exposed as Netlify env-var NAME (deleted 2026-05-20).** `docs/security-cleanup-2026-05-20.md` flags that rotation is a pending human-only task for Teddy. If you live-test Stripe today, you could be testing against a rotated key without realizing.

4. **HCP webhook DEGRADED since 2026-05-05.** Polling fallback is the workaround but env-gated off (`HCP_POLL_ENABLED` unset). Running manual `override_enabled=true` polls is the only HCP-side automation actually working right now.

5. **Andre's onboarding bug (today).** `metadata-crud.js#findOrCreateTechConversation` had a bug where Andre's messages landed in Jimmy's conversation 673. Captured in `docs/andre-onboarding-recovery-2026-05-20.md`. Worth knowing because the v2 brain is what 5 techs are using right now.

6. **4 dev Vapi agents (James Repair / Sarah voice) sitting in same Vapi dashboard, not wired in.** Brand-conflict risk if anything accidentally activates them. Per `docs/vapi-agent-inventory-2026-05-11.md`, decision deferred to Week 2+.

7. **The `process_feedback_queue` cron is described as "always-on" in blueprint** but the cron file itself is the same SMS_ENABLED-gated pattern as everything else. The "always-on" refers to the cron firing, not to SMS actually going out — non-owner customers still won't get the SMS until `SMS_ENABLED=true`. Don't confuse "cron running" with "customers getting texted."

8. **`xano-workspace/` IS in git** despite some prior assumption it was ignored. Per blueprint §12.6, no audit for hardcoded credential literals has been run. Standing risk.

9. **The `feedback_classifier.xs` AI agent file** is referenced in blueprint as `xano-workspace/ai/agent/feedback_classifier.xs` but the `ai/` directory was not glob'd in my survey. Either it's elsewhere or it lives only in Xano dashboard (Xano workspace may not export AI agents to local files).

10. **DAILY_SUMMARY_ENABLED is referenced in code (15-min cron, env-gate exit at line 26)** but per the May-4 handoff "DAILY_SUMMARY_ENABLED — DOES NOT EXIST yet — null behaves as false." Either the env was added later or the handoff comment is stale. Code is ready; runtime state needs verification.

---

## Recommended "test today" picks (filtered: complete + would prove value + low risk + does not touch v2 brain / send_sms)

These are the 5 highest-leverage tests that are safe to run TODAY while v2 brain is mid-rollout.

| # | Test | Why it matters | One-line execution |
|---|---|---|---|
| **A** | **HCP poll dry-run with `override_enabled=true`** | Proves the workaround works without flipping the env. Builds confidence to flip `HCP_POLL_ENABLED=true` later. Pure read + idempotent upsert. | `POST /api:3e_TffpA/hcp_poll_recent_jobs {"override_enabled": true}` then check `event_log` for `hcp_poll_*` rows. |
| **B** | **Feedback SMS round-trip to Teddy's own phone** | Exercises the feedback queue, owner-bypass SMS_ENABLED path, classifier AI agent, AND the inbound reply webhook in one walk. Owner-only so zero customer fallout. | `POST send_feedback_sms` with `customer_phone=+16154855795`, reply "5" from phone, verify Google review link arrives. |
| **C** | **Financial dashboard read-only smoke** | Validates the 2026-05-15 build. Confirms vendor seed data, payment intake rows, aggregated payload. PIN-gated, read-only. | Open `/financial-dashboard.html`, PIN-verify, observe. |
| **D** | **Tech-Ant TDR submission with a test job** | Touches PIN auth + Xano TDR write + S3 photo + attachment row in one walk. Owner-side, disposable test job. | Open `/tech-ant.html?job_id=<test>&tech_id=1`, PIN-verify, submit TDR with one photo. |
| **E** | **Stripe smoke test (built-in, side-effect-free)** | Verifies Stripe key + Xano endpoint plumbing without creating a real transaction. Useful given today's Stripe-key exposure incident. | `GET /api:VGkW9mcV/stripe_smoke_test`. |

(Picks NOT included: anything that touches Tech Assist v1 — never exercised, flag state uncertain; anything that flips a `_ENABLED` env; anything that fires real Vapi outbound to real customer numbers; anything that mutates a real customer record.)

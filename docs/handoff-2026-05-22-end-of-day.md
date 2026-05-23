# Handoff — 2026-05-22 end of day

Tomorrow-ready handoff. Read first thing in the morning before opening any code.

---

## What's live and working

### Frontend pages (Netlify auto-deploys from `main`)

| URL | Auth | Purpose |
|---|---|---|
| `tnapplianceexchange.net/tech-ant-live.html?job_id=X&tech_id=Y` | Tech PIN | Live in-field chat with Ant. Action bar (Navigate, On My Way, Call, Start Job, Complete dropdown). Parts decision UI. |
| `tnapplianceexchange.net/tech-ant.html?job_id=X` | Tech PIN | Older single-page tech UI (still functional, lower-traffic than tech-ant-live). |
| `tnapplianceexchange.net/tech-dashboard.html?tech_id=X` | Tech PIN | Daily stops list for one tech. Header + Route Summary panel (multi-stop Google Maps link) + numbered stop cards. |
| `tnapplianceexchange.net/office-dashboard.html` | Office password | Office-wide filter-tab dashboard. 7 tabs (All, Needs Scheduling, Needs Info, Parts Ordered, Ready to Submit, Submitted, Flagged). Sort oldest-first. |
| `tnapplianceexchange.net/office-tn.html` | Office password | TN region MeisterTask-style folders. Scheduling block + Jimmy/Lee/Teddy folders × 7 subsections each + Waiting for Payment. Move Stage dropdown. |
| `tnapplianceexchange.net/office-la.html` | Office password | LA region mirror. Andre/Billy/John × 7 subsections. |
| `tnapplianceexchange.net/job-detail.html?job_id=X&office=1` | Office password | Single-job deep view. Customer/Appliance/Tech/Timeline/Parts/TDR/Earnings/Activity. **Office-only modals: Reschedule, Reassign, Cancel Job.** |
| `tnapplianceexchange.net/job-detail.html?job_id=X&tech_id=Y` | Tech PIN | Same page in tech mode (no earnings, no edit modals). |

### Xano endpoints (live and functional)

All in `api_group = "intake"` unless noted, all POST verb.

| Endpoint | Purpose |
|---|---|
| `get_jobs_for_dashboard` | Paginated jobs list with TDR/parts/timestamps/office_stage. Used by all dashboards. |
| `get_job_for_dashboard` | Single job + customer + tech + tdr (latest) + recent_events (20) + earnings (all). Used by job-detail.html. |
| `update_job_office_stage` | Writes jobs.office_stage. Used by Move Stage dropdown. |
| `get_pending_earnings` | Per-tech list of `tech_earnings.status="pending_payment"` rows + job/customer context. Used by Waiting for Payment subsections. |
| `payout_batch` | Closes a payout batch. dry_run=true returns calculated amounts only. Marks all pending rows paid + SMS each tech + SMS Teddy summary. |
| `reschedule_job` | Updates scheduled_start + scheduling_status="scheduled". Audit-logs prior values. |
| `reassign_job` | Updates technician_id. Validates target tech exists. |
| `cancel_job` | Sets scheduling_status="canceled". Optional reason in audit. |
| `tech_on_the_way` | Stamps tech_en_route_at + SMS customer. Idempotent. |
| `tech_job_started` | Stamps job_started_at. |
| `tech_job_complete` | Stamps job_completed_at + calculates time_on_site_minutes + maps completion_type to scheduling_status + writes tech_earnings stub + SMS customer (diagnosis complete) + SMS Danielle (TDR submitted). |
| `validate_tdr_completeness` | Flips tech_assist_session status to complete/awaiting_completion. On transition to complete: auto-creates TDR + SMS Danielle + SMS customer. |
| `start_tech_assist_session` | Bootstraps a Tech Assist session on HCP job.started. Sends opening "🐜 hey jimmy" SMS via send_sms wrapper. |
| `tech_assist_chat` | Live in-field chat token dispatcher (CAPTURE_FIELD, QUERY_STATUS, ESCALATE_TO_OFFICE → Danielle, SEND_CUSTOMER_MESSAGE). |
| `tech_sms_inbound` | Tech inbound SMS router. New: Tech Assist routing (`__QUERY_MY_PAY__` block reads tech_earnings). |
| `notify_parts_ordered` | Teddy tool calls this when parts_decision=ship_to_customer. SMS + email Danielle. |
| `send_sms` | Unified SMS wrapper. Routes to Telnyx for internal recipients (Teddy/Danielle/techs), Twilio for customers. |
| `verify_pin` (via Netlify proxy) | 4-digit PIN check for tech-page auth. |
| `xano-proxy.js` (Netlify function) | All frontend → Xano calls route through this for CORS + method bridging. |

### Database tables touched this week

| Table | New / Updated this week | Notes |
|---|---|---|
| `jobs` | +`office_stage` (text, nullable), +`tech_en_route_at`/`job_started_at`/`job_completed_at`/`time_on_site_minutes` from earlier session | 113 columns total |
| `tech_earnings` | Created 2026-05-21 (table id 34) | Stub rows written by tech_job_complete; commission_earned=0 until real payment reconciliation |
| `addon_catalog` | Created 2026-05-21 (table id 35) | 7 seed rows |
| `tech_assist_session` | Active | Live in production |

---

## What needs to happen first thing tomorrow

### 1. Mac Mini setup (Mac arrives morning)
Follow `docs/mac-mini-setup-checklist.md` top to bottom. ~45-60 min total. End state: Claude Code authed + repo cloned + Xano CLI working + Netlify CLI working + MCP config copied from laptop.

After setup, smoke-test by running:
```
claude
> read docs/handoff-2026-05-22-end-of-day.md
```
Should summarize this doc back to you.

### 2. Pre-appointment upsell SMS (NEW feature)
**Status: not yet designed.** Concept:
- Trigger: ~24hrs before scheduled appointment
- Recipient: customer
- Content: offers from `addon_catalog` keyed on `jobs.appliance_type` (e.g., dryer → "Add vent cleaning to the visit for $75?")
- Mechanism: probably a daily cron that scans `jobs.scheduled_start` between now+18h and now+30h, queries addon_catalog where appliance_type matches OR equals "any", sends customer SMS with a tap-link to confirm
- Confirmation path: customer reply → feedback_reply_webhook captures intent → writes a job_addon row → tech sees the upsell in tech-ant-live.html

This needs design work before building. Tackle in tomorrow morning's first session.

### 3. Payout batch button in office dashboard (UI for existing endpoint)
The `payout_batch` Xano endpoint is built (queued for paste — see "Paste backlog" below). Need a UI:
- Add a "Run Payout Batch" button to `office-tn.html` and/or `office-dashboard.html`
- Two-stage confirmation: first click → dry_run=true → show modal with breakdown (Jimmy $X, Andre $X, ... Total $X) + "Confirm Real Run" button → second click → dry_run=false
- On confirm: shows success modal + SMS goes out to each tech + Teddy
- Auth-gated to office only

---

## URLs and passwords

### Production URLs
- Frontend: `https://tnapplianceexchange.net/`
- Xano API: `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/` (intake group)
- Xano Metadata API: `https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/...`
- Netlify site: `superlative-naiad-233aa7.netlify.app` (custom domain → tnapplianceexchange.net)
- GitHub: `github.com/tnappliancerepair-hub/tn-appliance-tools`

### Passwords / credentials
- **Office password (hardcoded in client JS for now):** `office2026`
- **Tech PINs:** stored per-tech row in Xano. Test via Xano UI → technicians table.
- **Apple ID for Mac Mini:** `tpivacek@gmail.com`
- **Email for git/GitHub:** `tpivacek@gmail.com`
- **GitHub PAT:** generate fresh at github.com/settings/tokens if needed
- **Xano CLI token:** in `~/.xano/credentials.yaml` (laptop) — needs regenerating on Mac Mini
- **Netlify CLI:** OAuth login flow, no manual token needed

### Localstorage keys used by frontend
- `tn_office_auth_v1` — office password unlock sentinel (shared across office-dashboard, office-tn, office-la, job-detail)
- `tn_office_folders_v1` — TN folder open/closed state
- `la_office_folders_v1` — LA folder open/closed state

---

## Feature flags (Xano environment variables)

| Flag | Current value | Effect |
|---|---|---|
| `SMS_ENABLED` | **true** (per Teddy report) | Master SMS gate. When false, all customer-facing SMS goes through gate-bypass logic (owner-only bypass). |
| `TECH_ASSIST_ENABLED` | **true** (per Teddy report) | Gates Tech Assist Phase 1c — session creation on HCP job.started, validate_tdr_completeness, escalation cron, tech_sms_inbound routing. |
| `PARTS_ARRIVAL_NOTIFY_ENABLED` | **false** | Gates the parts arrival daily cron. Flip to true when ready to send "your parts arrived" SMS automatically. |
| `OWNER_PHONE_NUMBER` | Teddy's phone (verify in Xano UI) | Used by escalation paths, payout_batch summary SMS. |
| `TWILIO_FROM_NUMBER` | `+16292840444` | Customer-facing TCR-cleared number. |
| `TELNYX_FROM_TECH` | (verify in Xano UI) | Tech-direction SMS from. |
| `TELNYX_FROM_CUSTOMER` | (verify in Xano UI) | Customer-direction Telnyx number. |
| `ANT_TECH_ASSIST_PROMPT` | Set | Tech Assist Claude system prompt. |
| `ANT_TECH_DAILY_PROMPT` | Set | Daily scheduler Claude system prompt. |
| `ANT_TECH_ONBOARDING_PROMPT` | Set | Tech onboarding flow Claude system prompt. |

---

## Paste backlog (XS files queued in Notepad — verify saved in Xano)

These were written to disk + Notepad opened today. Confirm each one is pasted-and-saved in Xano UI tomorrow morning. Until pasted, dependent features error.

| File | Status (per my session log) | Dependent features |
|---|---|---|
| `update_job_office_stage_POST.xs` | Notepad opened | Move Stage dropdown on office-tn / office-la cards |
| `get_pending_earnings_POST.xs` | Notepad opened | Waiting for Payment subsections |
| `payout_batch_POST.xs` | Notepad opened | (no UI yet; payout button TBD) |
| `reschedule_job_POST.xs` | Notepad opened | Reschedule modal on job-detail.html |
| `reassign_job_POST.xs` | Notepad opened | Reassign modal on job-detail.html |
| `cancel_job_POST.xs` | Notepad opened | Cancel Job modal on job-detail.html |
| `get_jobs_for_dashboard_POST.xs` (latest with office_stage in response) | Notepad opened | The 5 new office_stage subsections per tech in office-tn / office-la |
| `get_job_for_dashboard_POST.xs` (POST flip + extended) | Notepad opened | job-detail.html full data including tdr/events/earnings |
| `hcp_job_webhook_POST.xs` (CREATE-path tech lookup) | Notepad opened | New HCP jobs get correct tech_id at creation |

Smoke-test sequence after pasting all of the above:
```bash
curl -X POST 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/payout_batch' -H 'Content-Type: application/json' -d '{"dry_run":true}'
curl -X POST 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_pending_earnings' -H 'Content-Type: application/json' -d '{"tech_id":2}'
curl -X POST 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_jobs_for_dashboard' -H 'Content-Type: application/json' -d '{"date_filter":"all","page":1,"per_page":5}'
```
All should return `{success: true, ...}` with sensible data.

---

## Open items and known issues

### Verified bugs not yet fixed
1. **Office dashboard tabs "Needs Info" + "Submitted" return empty** — those filter `jobs.scheduling_status="awaiting_completion"` and `="submitted"`, but those values actually live on `tech_assist_session.status` and `technician_decision_report.status` respectively. Fix needs new endpoint param or denormalization.
2. **Recent events JSON-path filter unverified** — `where = $db.event_log.metadata.job_id == $input.job_id` in get_job_for_dashboard may silently return empty. Test by curl on a job_id you know has events.
3. **`commission_earned` is always 0** on tech_earnings rows — the stub-write pattern in tech_job_complete writes zeros; real values come from stripe webhook (self-pay) or remittance match (warranty) flows that don't exist yet. Until built, Waiting for Payment and payout_batch will show $0 totals.

### Design gaps
4. **Office password is hardcoded in client-side JS** (visible in view-source). Move to a Netlify function proxy. Note: same trade-off across office-dashboard, office-tn, office-la, job-detail.
5. **5 office_stage subsections fire redundant fetches** — each subsection re-queries the same per-tech jobs list with a different client-side filter. 15 extra fetches per page on office-tn/office-la. Future: one shared fetch per tech, client-side bucket.
6. **The Xano parse-serialize bug** — `??` and `|trim` inside `if (...)` comparisons get stripped on UI paste. Mitigation pattern: keep those defensive ops in `value = (...)` assignment context only.
7. **Map iframe blocked** — multi-stop /maps/dir/ URLs are X-Frame-blocked by Google. Workaround: clickable Route Summary panel (no iframe). Real fix: Google Maps Embed API key.

### Workflow gaps (not bugs, just missing features)
8. **Stage dropdown doesn't filter sections** — Move Stage writes `jobs.office_stage` to DB but no section currently filters by it visibly, so the card doesn't move. The 5 office_stage subsections we added today DO filter — but the "tech's job folder" sections (Scheduled, Upgrade) still filter by scheduling_status. Card moves between scheduling_status sections AND office_stage sections as expected.
9. **Pre-appointment upsell SMS** — not designed yet (tomorrow's task).
10. **Payout batch trigger UI** — endpoint exists, no button in dashboards yet (tomorrow's task).
11. **Reschedule modal doesn't notify customer** — endpoint writes DB but no SMS. Future: customer notification on reschedule.
12. **Cancel modal doesn't notify customer** — same as above.
13. **Reassign modal doesn't notify the new tech** — same.

---

## Git log — today's commits (most recent first)

```
6181112 docs: Mac Mini setup checklist - first boot through Claude Code config + first agents to build
30ff530 feat: tech-dashboard clickable Route Summary panel + job-detail office-only modals (Reschedule, Reassign, Cancel)
bcf3de5 feat: add 5 office_stage subsections per tech in office-tn + office-la (Report/Waiting Auth/Completion Appt/Follow Up/Needs Invoicing)
4b669de docs: session record 2026-05-22 office dashboards + payouts + GET to POST conversion
9820358 feat: office-la.html LA region dashboard (Andre/Billy/John)
319ed4b fix: office-tn.html replace grid lock with fixed-header + natural body scroll
f3da594 fix: office-tn.html sticky header + restore body overflow:hidden lock
eae822d fix: office-tn.html remove overflow:hidden from body for natural scrolling
da1387e fix: office-tn.html scroll - add min-height:0 to .content for grid+flex overflow
cdfbf11 feat: office-tn.html with collapsible folders, 13 parallel fetches, move-stage dropdown
f11cff7 fix: route get_job_for_dashboard calls through xano-proxy as POST in dashboard.html + tech-ant.html
86892a4 fix: tech-ant-live routes get_job_for_dashboard through xano-proxy as POST
f2230f6 fix: job-detail.html sends method:POST to xano-proxy
129587f feat: job-detail.html with auth gates, action bar, timeline, parts/tdr/earnings/activity sections
f847d7c fix: switch dashboards to POST forwarding via xano-proxy
06e4e4d fix: force Netlify redeploy office-dashboard
ec6663c fix: route dashboard fetches through xano-proxy to fix page=0 issue
2bc07bb feat: office dashboard with filter tabs and job cards
30c9685 feat: tech daily dashboard with map + stop list
6003104 docs: session record 2026-05-21 scheduling complete
05e3f44 feat: add job action bar (navigate, on my way, call, start, complete) + fix SESSION_ID bug
```

21 commits today. The handful of `fix: office-tn.html scroll-*` commits are the embarrassing scroll-debugging chain — fixed eventually with `position: fixed` header + natural body scroll (commit `319ed4b`).

---

## Tomorrow's start-of-day checklist

1. Mac Mini setup (use `docs/mac-mini-setup-checklist.md`)
2. Open Claude Code in `~/code/tn-appliance-tools` on the Mac
3. Read this doc — confirm "what's live" matches reality (curl smoke tests in Paste backlog section)
4. Paste the queued endpoint files from Notepad backlog into Xano UI (9 files)
5. Smoke-test each newly-pasted endpoint via curl
6. **Then** decide morning priority — most likely:
   - Design + start pre-appointment upsell SMS, OR
   - Build payout batch UI button (smaller scope, ships faster)
7. End-of-day: write `docs/session-2026-05-23-*.md` summarizing what shipped

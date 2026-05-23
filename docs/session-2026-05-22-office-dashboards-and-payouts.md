# Session — 2026-05-22 — Office Dashboards, Payouts, GET→POST Conversion

**Headline:** Built TN + LA office dashboards (Danielle's MeisterTask folder structure replacement), job-detail.html, and four new endpoints (`update_job_office_stage`, `get_pending_earnings`, `payout_batch`, plus extending `get_job_for_dashboard`). Also discovered + worked around a Xano-side bug where GET endpoints reject `Content-Type: application/json` headers, and pivoted the dashboard stack to route through the existing `xano-proxy` Netlify function as POST. HCP webhook tech-assignment bug fixed (was hardcoded to Teddy on CREATE).

---

## Starting state (this morning)

- `office-dashboard.html` (built yesterday) had a working filter-tabs UI but most tabs were broken: only "all"/"unscheduled" returned data because the endpoint had `?? null` patterns that produced `ParseError: Invalid value for param:""` on every call.
- Jimmy reported he couldn't open jobs from his dashboard — the `tech-dashboard.html` page was hitting `get_jobs_for_dashboard` directly and getting empty results.
- No region-split dashboards existed for Danielle; she was still working from MeisterTask cards manually.
- `tech_earnings` table had ~zero rows (stubs only) and no payout-batch automation.
- Every HCP webhook-created job was landing with `technician_id = 1` (Teddy) regardless of who HCP actually assigned, because the CREATE path had a hardcoded `1` while the UPDATE path had a working `db.query technicians where hcp_id = ...` lookup.
- No `office_stage` field on `jobs` — no way for Danielle to bucket jobs into her workflow stages.
- The dashboards in production were calling Xano endpoints directly via GET; some pages added `Content-Type: application/json` headers which (we discovered today) cause Xano GET endpoints to throw `ParseError`.

---

## What shipped today

### 1. New Xano table field

- **`jobs.office_stage`** — text, nullable, default "" — added via Metadata API. Bucket label for Danielle's workflow. Expected values: `scheduled`, `report`, `upgrade`, `waiting_auth`, `completion_appt`, `follow_up`, `needs_invoicing`. Empty = unbucketed.

### 2. New / extended endpoints

| Endpoint | File | Verb | Purpose |
|---|---|---|---|
| `get_jobs_for_dashboard` | `xano-workspace/api/intake/get_jobs_for_dashboard_POST.xs` | **GET→POST** (verb flip) | Paginated dashboard list. Multiple fix passes today (see "GET→POST saga" below). |
| `get_job_for_dashboard` | `xano-workspace/api/intake/get_job_for_dashboard_POST.xs` | **GET→POST** (verb flip) | Extended to include scheduling_status, days_since_created, hcp_assigned_to, parts_*, tech_en_route_at/job_started_at/job_completed_at/time_on_site_minutes, plus 3 new top-level blocks: `tdr` (most recent), `recent_events` (last 20 from event_log filtered by metadata.job_id), `earnings` (all rows for this job from tech_earnings). |
| `update_job_office_stage` | `xano-workspace/api/intake/update_job_office_stage_POST.xs` | POST (new) | Writes `jobs.office_stage`. Validates against 7-stage enum. Empty = clear. Audit-logs every change with prior/new stage. |
| `get_pending_earnings` | `xano-workspace/api/intake/get_pending_earnings_POST.xs` | POST (new) | Per-tech list of `tech_earnings.status = "pending_payment"` rows, enriched with job + customer for display. One call per tech (3/5/6 for LA, 1/2/4 for TN). |
| `payout_batch` | `xano-workspace/api/intake/payout_batch_POST.xs` | POST (new) | Closes a payout batch. Marks all pending rows paid, stamps payout_batch_date=today, SMS each tech ("Zelle incoming" or "PayPal" for Billy), SMS Teddy with full breakdown. `dry_run=true` calculates without writing/sending. |

### 3. HCP webhook tech-assignment fix

`hcp_job_webhook_POST.xs` — CREATE path was hardcoded `technician_id: 1`. Discovered the UPDATE path (lines 516-536) already has a working `db.query technicians where hcp_id = ...` lookup, and the `technicians.hcp_id` column was already populated correctly for all 6 techs:

```
id=1 Teddy  → pro_62f343b05fc74db29b0f18a6f406a9f3
id=2 Jimmy  → pro_e4e4a77e88be413bb2d9ec2335f579da
id=3 Andre  → pro_7f6119d83a7e4d0fb2c7009a66bde45b
id=4 Lee    → pro_a5c9d8b438b843e3adfbdf810ffe0155
id=5 Billy  → pro_24fa2d9032b8435cb4ec348594b2044b
id=6 John   → pro_cf9d2663844a4be686b0edd55b5091c7
```

Added the same `db.query technicians` lookup to the CREATE path (Option B from design discussion — data-driven, no hardcoded mapping). Defaults to Teddy (1) if no pro assigned in webhook payload OR pro doesn't match any tech row; logs `create_tech_not_found` event for traceability.

**Audit result:** count of jobs in last 7d with `technician_id=1 AND hcp_assigned_to != Teddy's pro = 0`. The bug existed but wasn't actively producing wrong assignments — appointment-update events were correcting them via the working UPDATE path. The CREATE fix closes a corner-case race for jobs that arrive with pre-assigned pros.

### 4. New frontend pages (all at repo root, all served by Netlify)

| Page | Purpose | Auth |
|---|---|---|
| `office-tn.html` | TN region dashboard — collapsible folder structure matching Danielle's MeisterTask: Scheduling block (Needs Scheduling, Pre-Diagnosis, Post-Diagnosis), Jimmy/Lee/Teddy folders (Scheduled, Upgrade subsections each), Waiting for Payment per tech. 13 parallel API calls via xano-proxy. Client-side TN filter on `service_state`. Per-card Move Stage dropdown writes `office_stage`. Folder open/closed state persisted in `localStorage` key `tn_office_folders_v1`. | Office password `office2026` |
| `office-la.html` | LA region dashboard — mirror of TN with Andre (3), Billy (5), John (6). State filter on "LA"/"Louisiana". Folder state key `la_office_folders_v1`. | Office password (shared key) |
| `job-detail.html` | Single-job deep view. Sections: header + action bar (Call / Navigate / Open Tech Live), Customer, Appliance, Tech, Timeline stepper (en_route → started → completed), Parts (conditional), TDR (conditional), Earnings (office only), Activity (last 20 event_log entries). Auth branches on URL params: `?office=1` → office password; `?tech_id=X` → tech PIN; default → office password. | Office password OR tech PIN (per URL) |

### 5. GET → POST conversion saga

Spent significant time chasing a Xano-side parser bug.

**Root cause discovered:** Xano GET endpoints throw `ParseError: Invalid value for param:""` when the request includes `Content-Type: application/json`. The xano-proxy Netlify function adds that header unconditionally, so all proxy-routed GET calls were failing.

**Solution:** flipped both dashboard endpoints from `verb=GET` to `verb=POST`:
- `get_jobs_for_dashboard_GET.xs` → renamed to `_POST.xs`, `verb=GET` → `verb=POST`
- `get_job_for_dashboard_GET.xs` → renamed to `_POST.xs`, `verb=GET` → `verb=POST`

Then updated all frontend callers to route through `/.netlify/functions/xano-proxy` with `method: "POST"` in the body:
- `office-dashboard.html` (loadJobs)
- `tech-dashboard.html` (init)
- `job-detail.html` (loadJob)
- `tech-ant-live.html` (init)
- `tech-ant.html` (loadJob)
- `dashboard.html` (Promise.all for get_job_for_dashboard)

The `xano-proxy.js` Netlify function already supported a `method` field in the body for forwarding the right HTTP verb — it was just being called with `method: "GET"` initially which inherited the broken behavior.

**Also fixed in `get_jobs_for_dashboard`:**
- Where clauses split per `date_filter` value (4 branches) to eliminate the deeply-nested OR for date filtering
- Optional input filtering: added `$safe_tech_id` and `$safe_status` stack-level vars that coerce nulls (`?? 0` and `?? ""`) before referencing in where clauses. The original `$input.tech_id == null || ...` pattern was triggering ParseError when the input was null in the POST body.

### 6. Frontend dashboard fixes

- `tech-dashboard.html` action bar (added in earlier session) now works because the `get_jobs_for_dashboard` payload routing through the proxy is fixed.
- `office-dashboard.html` filter tabs now functional for the 3 working scheduling_status values (`parts_ordered`, `complete`, `pending_auth`). The other 2 tabs (`awaiting_completion`, `submitted`) will return empty until the underlying field semantics get reconciled (those map to tech_assist_session.status and TDR.status respectively, not jobs.scheduling_status).
- `office-tn.html` scroll bug fix — went through several attempts. Final pattern: removed grid layout from body, fixed-position header at top, content uses `margin-top: 60px` + `min-height: calc(100vh - 60px)` and lets natural body scroll handle the overflow.

### 7. User-driven actions (no direct code evidence in repo, included per Teddy's report)

- **Daily summary SMS flipped on** — the `compute_daily_summary` cron / SMS flow is now active in production.
- **Tech dashboard links sent to techs** — Teddy texted Jimmy, Andre, Lee, Billy, John their personal `tech-dashboard.html?tech_id=X` URLs so they can check their daily stops.

---

## Things still to do (handoff to next session)

1. **Paste the 3 new endpoints into Xano UI** — `update_job_office_stage`, `get_pending_earnings`, `payout_batch` — all written to disk + Notepad opened, but UI paste/save not confirmed.
2. **Verify `get_job_for_dashboard` POST flip pasted in Xano UI** — file renamed locally + verb changed, but Xano-side verb switch requires manual UI action.
3. **Smoke-test `payout_batch` with `dry_run=true`** before any real run. Confirms the per-tech sums look right.
4. **Reconcile broken office-dashboard tabs** — `Needs Info` (`awaiting_completion`) and `Submitted` need either a new `status_source` parameter on `get_jobs_for_dashboard` or a separate query path. Current behavior: silently returns empty.
5. **Cluttering risk on `office_stage` dropdown** — currently no section on office-tn/la actually FILTERS by `office_stage`, so changing the dropdown writes the field but card doesn't move visually. Future: add office_stage-driven sections OR remove the dropdown until consumed.
6. **`recent_events` JSON-path filter** in `get_job_for_dashboard` (`where = $db.event_log.metadata.job_id == $input.job_id`) is unverified. May silently return empty even when events exist for that job_id. Fallback: query broader event_log + filter post-fetch.

---

## Endpoint inventory after this session

**New POST endpoints in `intake` group:**
- `update_job_office_stage`
- `get_pending_earnings`
- `payout_batch`
- `get_jobs_for_dashboard` (verb-flipped)
- `get_job_for_dashboard` (verb-flipped + extended)

**New tables:**
- `tech_earnings` (existing; populated as stubs by `tech_job_complete`)
- `addon_catalog` (existing; 7 seed rows from yesterday)

**New jobs columns this session:**
- `office_stage` (text, nullable)

---

## Git log this session (commits in order)

- `129587f` feat: job-detail.html with auth gates, action bar, timeline, parts/tdr/earnings/activity sections
- `f2230f6` fix: job-detail.html sends method:POST to xano-proxy
- `86892a4` fix: tech-ant-live routes get_job_for_dashboard through xano-proxy as POST
- `f11cff7` fix: route get_job_for_dashboard calls through xano-proxy as POST in dashboard.html + tech-ant.html
- `cdfbf11` feat: office-tn.html with collapsible folders, 13 parallel fetches, move-stage dropdown
- `da1387e` fix: office-tn.html scroll - add min-height:0 to .content for grid+flex overflow
- `eae822d` fix: office-tn.html remove overflow:hidden from body for natural scrolling
- `f3da594` fix: office-tn.html sticky header + restore body overflow:hidden lock
- `319ed4b` fix: office-tn.html replace grid lock with fixed-header + natural body scroll
- `9820358` feat: office-la.html LA region dashboard (Andre/Billy/John)

Plus prior commits earlier in the day on the get_jobs_for_dashboard fix iterations (06e4e4d, ec6663c, 2bc07bb, 30c9685).

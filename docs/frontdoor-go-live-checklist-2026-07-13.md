# Frontdoor / AHS API — GO-LIVE CHECKLIST (2026-07-13)

The runbook for taking the Frontdoor integration from "staged" to "live," both
directions. Everything on **our** side is built, vaulted, and auth-verified — the two
sequences below fire the moment Frontdoor completes their two steps.

Spec: `docs/frontdoor-integration-spec-2026-07-09.md` · Connector: `netlify/functions/_lib/frontdoor.js`

---

## Current state (staged — nothing left on our side to prep)

| Item | State |
|---|---|
| Inbound creds (`FRONTDOOR_CLIENT_ID` / `_API_USERNAME` / `_API_PASSWORD`) | ✅ vaulted; auth proven (JWT mints live) |
| `FRONTDOOR_ENV` | ✅ `sandbox` |
| Outbound webhook token (`FRONTDOOR_WEBHOOK_TOKEN`) | ✅ vaulted (`fdw_…Xp8`), same value handed to Brian |
| Outbound receiver `frontdoor-webhook.js` | ✅ deployed, bearer-auth, **dark/dry-run** (no `FRONTDOOR_WEBHOOK_LIVE`) |
| Inbound connector `dispatchStatusUpdate()` + `STATUS` catalog | ✅ built |
| Vendor→area→crew map | ✅ 822418→John (North Shore) · 822218→Andre (South Shore) · 839828→TN crew |
| Email to Brian (creds + webhook URL + token) | ✅ sent 2026-07-13 |

**Blocked only on Frontdoor:** (A) link our sandbox Client ID to our account → clears the
403 for inbound push; (B) point their sandbox dispatch webhook at our URL for outbound.

**Admin secret for all test calls:** `?secret=<VAPI_ADMIN_SECRET>` (fallback `tn-vapi-admin-9f83b1c4e7a206d5`).

---

## DIRECTION A — OUTBOUND (Frontdoor → us): auto-intake of new dispatches
*Fires when Frontdoor's team points their sandbox webhook at our URL. No 403 dependency.*

**Endpoint:** `https://tnapplianceexchange.net/.netlify/functions/frontdoor-webhook`
**Auth:** `Authorization: Bearer fdw_…Xp8` (must match the vaulted `FRONTDOOR_WEBHOOK_TOKEN`)

1. **Confirm the receiver is armed** (dark mode returns `mode:"dark"`, dry-runs, no insert):
   POST a sample Schedule event with the bearer token → expect `200 { ok:true, mode:"dark",
   results:[{operation:"schedule", area:"Middle TN", mode:"dry_run"}] }`. A wrong token → `401`.
   *(Note: dry-run does a live `create_job_from_email` round-trip, so during Xano load spikes
   the call can be slow — Frontdoor retries + the receiver is idempotent, so it self-heals.)*
2. **Watch real sandbox payloads land** — every event writes an `event_log` row
   `action="frontdoor_webhook_event"` (+ `frontdoor_dispatch_scheduled` for Schedule). Pull
   them and verify the mapping on 2–3 real dispatches: customer name/phone/address, appliance,
   brand, symptom, and that `area`/`cluster`/`lead_tech_id` resolved from `vendor.external_id`.
3. **Flip intake LIVE** once the mapping looks right: vault **`FRONTDOOR_WEBHOOK_LIVE=1`**.
   Now a `Schedule` event creates (or dedups to) a real Ant job, pre-routed to the right crew,
   and `Status`/`notes`/`ncc` events are recorded against the dispatch.
4. **Verify a live create** — first real dispatch after the flip → confirm a job appears on the
   board with the right crew + warranty_company (AHS/HSA/Frontdoor/2-10) and no duplicate.
5. **Retire the email parser** for that tenant once the webhook is proven — the webhook is
   richer + real-time. (Keep the Gmail parser as a fallback for a week before fully cutting.)

**Kill switch:** unset `FRONTDOOR_WEBHOOK_LIVE` (or set ≠ `1`) → back to dark/dry-run instantly.

---

## DIRECTION B — INBOUND (us → Frontdoor): push tech status into the portal
*Fires the moment Brian links our Client ID and clears the 403. This is the piece that kills
Danielle's manual portal updating.*

1. **Run the live status-push test** (was 403; should now be accepted):
   `GET /.netlify/functions/frontdoor-test?secret=<admin>&push=1&code=EN_ROUTE`
   → expect a non-403 structured response ("dispatch not found" is still a PASS — it means auth
   + endpoint + schema were accepted). If still 403 → Client ID not linked yet; ping Brian.
2. **Lock the exact endpoint path + status vocabulary** from the sandbox response / Appendix A.
   The connector has two candidates — `dispatchStatusUpdate()` (`/dispatch-connector/v1/webhook`)
   and `caseLifecycleStatusUpdate()` (`/{routingId}/v1/case-lifecycle/dispatch_status_update`).
   Confirm which one the ticket authorized; if it's the case-lifecycle path, vault
   `FRONTDOOR_ROUTING_ID` and wire that variant. Reconcile the `STATUS` code map against the
   live API reference (codes 10–590).
3. **Wire the push into the job lifecycle** (the build step, ~an hour once the path is locked):
   on tech taps — On-my-way → `EN_ROUTE` (70), Arrived → `ARRIVED` (90), Start → `IN_PROGRESS`
   (20), Parts ordered → `PARTS_ORDERED` (380), Return set → `RETURN_SET` (400), Complete →
   `COMPLETE` (10) — plus tech notes → Notes Update. Echo back the `vendor_id` the job arrived
   under (`vendorForArea(job.area)`). Ship SHADOW first (log-only, no live write).
4. **Validate a real dispatch in sandbox** end-to-end: drive one job through on-my-way →
   arrived → complete and confirm each status shows in the Frontdoor sandbox portal.
5. **Flip inbound push LIVE** — remove the shadow gate so lifecycle taps write to Frontdoor
   automatically. Danielle stops updating the portal by hand.

---

## PRODUCTION CUTOVER (after both sandbox directions validate)

1. Get **production** API creds from Frontdoor → vault new `FRONTDOOR_CLIENT_ID` /
   `_API_USERNAME` / `_API_PASSWORD` (prod values) and set **`FRONTDOOR_ENV=production`**
   (connector auto-switches token URL → `login.frontdoorhome.com` + base → `api.frontdoorhome.com`).
2. Issue a **fresh production** `FRONTDOOR_WEBHOOK_TOKEN`, vault it, and hand it to Frontdoor to
   point their **production** webhook at the same URL. (Never reuse the sandbox token for prod.)
3. Re-run both smoke tests against production (auth + push + one live webhook event) before
   trusting real dispatches.
4. Confirm `FRONTDOOR_WEBHOOK_LIVE=1` and the inbound push shadow gate is off in production.

---

## Reference

- **Secrets (all in the vault via `admin-secrets.html`):** `FRONTDOOR_CLIENT_ID`,
  `FRONTDOOR_API_USERNAME`, `FRONTDOOR_API_PASSWORD`, `FRONTDOOR_ENV`, `FRONTDOOR_WEBHOOK_TOKEN`,
  (later) `FRONTDOOR_ROUTING_ID`, `FRONTDOOR_WEBHOOK_LIVE`.
- **Vendor IDs (all "TN APPLIANCE EXCHANGE LLC"):** `822418` North Shore/John · `822218`
  South Shore/Andre · `839828` Middle TN/Jimmy·Lee·Teddy · `1373302` + `120868` legacy/inactive.
- **Diagnostics:** `frontdoor-keys` (what's vaulted, shareable IDs) · `frontdoor-test`
  (auth + `?push=1` status test) · `frontdoor-webhook` (outbound receiver).
- **Log actions to watch:** `frontdoor_webhook_event`, `frontdoor_dispatch_scheduled`,
  `frontdoor_dispatch_status/notes/ncc`, `frontdoor_webhook_rejected`, `frontdoor_webhook_error`.
- **Contact:** Brian Bullock (Brian.Bullock@ahs.com) — Senior PM, Contractor Experience;
  authorizes the Client ID on the ticket.

**One-line status:** our side is 100% staged both directions; go-live = Brian links the Client
ID (→ run Direction B step 1) and Frontdoor aims their webhook at us (→ Direction A step 2).

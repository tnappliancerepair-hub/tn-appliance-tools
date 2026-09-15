# Frontdoor / AHS API — implementation spec (captured 2026-06-24)

## 🟢 RE-RUN FROM SCRATCH 2026-09-15 — the sandbox gateway is EMPTY; the service is on PRODUCTION
Teddy: *"start from the beginning of the api process and try everything over."* Did exactly that
(`frontdoor-rerun?secret=<admin>&step=hosts|auth|identity|paths`) and it overturns the earlier read.

**The endpoints are REAL and they are on PRODUCTION at the prefix we already coded.**
- **`api.sandbox.frontdoorhome.com` has ZERO routes.** Every path 404s — including a control path
  under a known prefix. Nothing is deployed there. **That is the entire source of the 404s since June.**
- **`api.frontdoorhome.com` routes by PREFIX** (proven with a control pair: unknown prefix → 404,
  nonsense sub-path under a known prefix → 401). Live + JWT-gated prefixes: **`/dispatch-connector`**,
  `/address`, `/dtc`, `/real-estate`.
- Our token there → **`401 "Jwt issuer is not configured"`** = production does not trust the sandbox issuer.
- ⚠️ **THE ROUTING-ID THEORY IS DEAD.** `/ahs`, `/ftdr`, org_id and applicationId all 404 as unknown
  prefixes. There is no routing-id segment to be issued.
- ⚠️ **`/v1/case-lifecycle/dispatch_status_update` is NOT a real prefix** on either host — the
  "simpler contractor endpoint" from Getting Started is not ours. **`/dispatch-connector` is the one.**

**Auth was never the problem, and is now fully exhausted as a theory:**
- Sandbox password-grant mints; `introspect` → **`active: true`**.
- Both production token URLs reject our client_id as **`invalid_client`** → **our key is sandbox-only**.
- `scopes_supported` is only `openid, offline_access, email, phone, profile` — **no dispatch or
  contractor scope exists to request**, so we are not under-asking. `roles` is always `["external-partner"]`.
- `userinfo` (with `openid`) returns only `sub` + `tid`. The IdP has nothing more to give us.

**→ THE ASK IS A PRODUCTION API KEY**, from the BD rep / `partnerapiadmin@frontdoorhome.com` —
not a sandbox config ticket. Full copy-paste ask: `docs/frontdoor-production-key-ask-2026-09-15.md`.

- ⚠️ **AND THE WATCHER WAS LYING.** `frontdoor-auth-watch` treated ANY non-403 as "authorized", so a
  404 tripped it — false all-clear texts on **2026-08-12** and **2026-09-10** (29d apart, just past its
  own 30d dedup). Fixed: only 200/201/202, 400/422 (auth taken, body rejected = a PASS) or 405 count.
  It also now probes **production** — it was watching the empty sandbox gateway, so it would have
  waited forever — and reports `issuer_not_trusted` until a production key exists. Pinned by
  `tests/frontdoor-auth-gate.test.js` (26 assertions, decision regex-lifted from the shipped file).
- ⚠️ **STANDING: a 404 is not a permissions signal, and a 401 is not proof a sub-path exists.** Gate on
  codes that prove success, never on "not the error I was waiting for" — and always probe a control
  path before reading a route map out of status codes. My first control assumed route-then-auth; the
  gateway does auth-per-prefix, and the control is what caught it before I published a wrong map.

## ⚠️ REALITY (6/24, from the portal's Getting Started page): being in the portal ≠ usable API
Generating an API key is only step 1. To get a key that actually WORKS you must also:
1. **Generate the key** (Sandbox or Production) on the Keys page.
2. **Open a CONFIG TICKET** to link the key to your account/profile/OfficeIds:
   `https://ftdr-developer.atlassian.net/servicedesk/customer/portal/3/group/11/create/53`
   Provide: portal-account email · Organisation name · API Key **username + clientID** · environment (Sandbox/Production).
3. **PRODUCTION access** (the real goal — pushing status on live AHS jobs) requires a human:
   your **Frontdoor business-development rep** or **`partnerapiadmin@frontdoorhome.com`** (THE correct API contact — better than the legal `salessolutionscontracts@`).
- **Open question:** the portal/Partner-API program is heavily Real-Estate + DTC oriented. Whether a ProConnect *contractor* account gets the dispatch/case-lifecycle status API (vs it being for dispatch platforms / RE partners) is exactly what the config ticket + partnerapiadmin convo will confirm. Don't overclaim until confirmed.
- **URL has a routing-id segment:** `https://api.frontdoorhome.com/<routing-id>/v1/...` (routing-id provided at config time → vault `FRONTDOOR_ROUTING_ID`).

## ⭐ Simpler contractor endpoint found (Getting Started → "Case-Lifecycle")
`POST /<routing-id>/v1/case-lifecycle/dispatch_status_update`
```json
{ "dispatchNumber": 444924742, "status": "JobComplete" }
```
status is camelCase (e.g. `JobComplete`) — full vocab TBD via config/sandbox. This is likely OUR path (simple dispatchNumber + status), vs the heavier `/dispatch-connector/v1/webhook`. Connector supports both (`caseLifecycleStatusUpdate` + `dispatchStatusUpdate`).

## Portal FAQ / operational notes (captured 6/24)
- **Production access has ONE path: your Frontdoor Business Development representative.** The FAQ routes EVERY access question to the BD rep — production, OfficeId/data access, and Helpdesk access all say "connect with your Frontdoor business development representative." → **Find out who TN Appliance's AHS/Frontdoor BD rep is** (ProConnect onboarding paperwork / contractor portal contacts / or ask `partnerapiadmin@frontdoorhome.com` to route).
- **Partner Helpdesk** = "only for Business Partners" — access requested via BD rep / sales solutions.
- **The public docs + FAQ are RE + DTC heavy** (offices, agents, contracts, plan orders). ZERO contractor-dispatch-status content in the FAQ. The Case-Lifecycle dispatch-status API exists, but **whether it's provisioned for ProConnect *contractors* (vs RE/DTC partners) is the open make-or-break question → the BD rep confirms it.**
- 401/403 = token missing/invalid/expired (regen token). 400 = bad body/schema.
- Password reset: Login page → Forgot Password (logged out) or User Account → Change Password (logged in).
- (RE only) v1→v2: camelCase fields, `tenantId` not `brand`, hyphenated endpoint names, base `sandbox.api.frontdoorhome.com` / `api.frontdoorhome.com`.
- **Logs & Metrics page (Kibana) in the portal** — once live, our API logs/metrics are viewable in the Developer Portal (filter by env/key/API/user). Useful for debugging the integration.
- **1:N org feature** — multiple users from the same org can join the portal + invite others (so Danielle/others can get portal access under TN Appliance).
- **Changelog (2021-2022) is entirely Real Estate + DTC/Address** — reinforces that the maintained/documented portal surface is RE/DTC; contractor dispatch-status is the un-advertised piece to confirm with the BD rep.

## Auth — OAuth2 password grant (FusionAuth), JWT Bearer, 1-hour expiry
1. In the developer portal → **"Your API key" page → "Add API Key"**. Modal returns
   **Password, Username, ClientId**. **ClientId is environment-specific** (sandbox ≠ prod).
2. Exchange those for a JWT:
   - **Production token URL:** `https://login.frontdoorhome.com/oauth2/token`
   - **Sandbox token URL:** `https://frontdoorhome-dev.fusionauth.io/oauth2/token`
   - `POST` `application/x-www-form-urlencoded`:
     - `grant_type=password` (STATIC — do not change)
     - `client_id=<apikey ClientId>`
     - `username=<apikey Username>`
     - `password=<apikey Password>`
   - Returns a JWT → use as **`Authorization: Bearer <jwt>`** on every API call. **Valid 1 hour** → cache + refresh.

## API base URLs
- **Sandbox:** `https://api.sandbox.frontdoorhome.com`
- **Production:** `https://api.frontdoorhome.com` (inferred from the sandbox host pattern — VERIFY on the live key page)

## ⭐ THE endpoint we want — Dispatch Status Update (kills Danielle's manual portal work)
`POST /dispatch-connector/v1/webhook`
```json
{ "data": [ { "type": "status", "object": {
  "source": "DISPATCH_ME",            // enum: DISPATCH_ME|SEARS|WHIRLPOOL|GE  (AHS contractor jobs ≈ DISPATCH_ME — VERIFY)
  "tenant": "AHS",                    // enum: AHS|HSA|FTDR
  "dispatch_id": 123456,              // integer — Frontdoor's dispatch id (maps to our jobs.dispatch_source_id? VERIFY)
  "vendor_id": "<our vendor id>",     // string — our contractor/vendor id
  "description": "In Progress",       // must match the enum below for the status_code
  "status_code": 20,                  // see table
  "note": "Tech diagnosed compressor failure; part on order.",
  "updated_at": "2026-06-24T18:00:00Z",
  "start_time": "2026-06-24T17:30:00Z",
  "end_time":   "2026-06-24T18:00:00Z",
  "items": [ { "id": 0, "legacy_item_id": 0, "description": "" } ]   // line items (STAR item ids)
} } ] }
```
The `note` field is how we satisfy BOTH asks (Dispatch Status Update + Dispatch Note Update) in one call.

### Status codes (full list)
10 Job Complete · 20 In Progress · 30 Appointment Set · 40 Job Cancelled · 50 Automated Dispatch Load Successful ·
60 Unable to Contact Customer · 70 Technician in Route · 80 Technician May Be Delayed · 90 Technician Arrived ·
100 In Progress w/ Parts on Order · 110 In Progress w/ Need to Replace · 120 Customer Missed Appointment ·
130 Possible Denial · 140 Incomplete · 150 On Hold · 160 Parts/Equipment Status · 200 Customer Appointment Set ·
210 Customer Complete · 220 Appointment Complete · 230 Appointment Cancelled · 240 Survey Complete ·
250 Dispatch Assigned · 260 Dispatch Accepted · 270 Reschedule Appointment Set · 280 Left message for Customer ·
290 Authorization Reported · 300 Appliance Options Offered · 310 Appliance Replaced · 320 CIL Offered ·
330 CIL Accepted · 340 CIL Declined · 350 Authorization Approved · 360 Authorization Denied ·
370 Authorization Approved w/ Limitations · 380 Parts Ordered · 390 Equipment Ordered · 400 Return Appointment Set ·
410 Parts Arrived · 420 Equipment Arrived · 430 Installation Appointment Set · 440 Job Invoiced ·
450 Authorization Awaiting Contractor Input · 460 2nd Opinion Requested · 470 Draft Autho for Contractor Review ·
480 Autho Review with Agent · 500 Cash out Approved

### Our-lifecycle → Frontdoor status_code map (proposed; refine vs sandbox)
| Ant event / office stage | Frontdoor status_code |
|---|---|
| Appointment scheduled (day set) | 30 Appointment Set |
| Tech en route (`tech_en_route_at`) | 70 Technician in Route |
| Tech arrived / job started | 90 Technician Arrived → 20 In Progress |
| TDR: part needed / ordered | 380 Parts Ordered (or 100 In Progress w/ Parts on Order) |
| Parts arrived | 410 Parts Arrived |
| Return visit scheduled | 400 Return Appointment Set |
| Authorization needed/reported | 290 Authorization Reported |
| Job complete | 10 Job Complete |
| Job invoiced | 440 Job Invoiced |
| Job canceled | 40 Job Cancelled |

## Other APIs in the spec (not our priority, noted for later)
- **Address API** (`/address/v1/*`) — verify/typeahead/zip lookup.
- **DTC** (`/dtc/v1/*`) — direct-to-consumer warranty quoting/ordering.
- **Real Estate v2** (`/real-estate/v2/*`) — warranty product ordering for RE partners.
- Footer also lists **"Parts Supplier APIs"** under Partner APIs — worth a look for a parts angle.

## Status / next
- Connector PRE-BUILT (dark): `netlify/functions/_lib/frontdoor.js` + `frontdoor-dispatch-status.js`. Returns `configured:false` until vault has `FRONTDOOR_*`.
- **TO GO LIVE:** get dev-portal access → Add API Key → vault `FRONTDOOR_CLIENT_ID` / `FRONTDOOR_API_USERNAME` / `FRONTDOOR_API_PASSWORD` (+ `FRONTDOOR_VENDOR_ID`, `FRONTDOOR_ENV=production`) → confirm `source`/`dispatch_id` field mapping against one real AHS job in sandbox → wire the status pushes into the job lifecycle.

# Frontdoor / AHS Status API — full integration spec (2026-07-09)

Source: the official Frontdoor partner docs Brian Bullock (Senior PM, Contractor
Experience) emailed 2026-06-29 — **Third-Party Integration Overview**, **Inbound
Integration Technical Guide**, **Outbound Integration Technical Guide** (incl.
Appendix A OpenAPI 3.0 YAML). This is the "biggest Danielle-replacement lever" we've
tracked for weeks, now fully specced.

**Config contact = Brian Bullock (Brian.Bullock@ahs.com).** He authorizes the sandbox
Client ID on the ticket. The AI-intake council (Jeanna Corley / the VP / Director of
Appliances) is a SEPARATE track — their "API too early" answer was about the new AI
test system, NOT this Status API.

## Two independent directions

| Direction | Who initiates | Dev Portal? | Partner provides | What it buys us |
|---|---|---|---|---|
| **Outbound** (Frontdoor → Ant) | Frontdoor | ❌ NOT required | a secure webhook endpoint | real-time auto-intake of new dispatches + status/NCC/notes → replaces Gmail dispatch parsing |
| **Inbound** (Ant → Frontdoor) | Partner (us) | ✅ required | Dev Portal account + API creds | push tech status/notes/NCC into Frontdoor → **kills Danielle's manual portal updating** |

Mnemonic from their doc: **Developer Portal = Inbound request · Webhook API = Outbound request.**

## OUTBOUND (Frontdoor → our webhook) — no permission needed, build first

- Frontdoor POSTs JSON to a partner-hosted HTTPS webhook. Body is an **array** of event
  objects. `operation` discriminates the schema.
- Endpoint must: accept POST, accept JSON, authenticate the request, respond with standard
  HTTP codes (200 ok / 400 invalid / 500 error), be idempotent (**handle duplicate/retried
  requests safely** — Frontdoor retries on failure).
- **Auth (outbound only):** Bearer token in `Authorization: Bearer <token>` (token agreed
  at onboarding) OR HMAC (shared secret, signature in a custom header). Basic auth = legacy/
  deprecated. Unauthorized → return `401`. We'll use **Bearer** (simplest).

### Operation → schema (OpenAPI, Appendix A: `openapi 3.0.0`, title "Outbound Dispatch API")
Single path `POST /dispatch/outbound`, body `oneOf`: SchedulePayload | StatusPayload |
NotesPayload | NCCPayload. Responses 200/400/500.

| operation | meaning | schema |
|---|---|---|
| `Schedule` | dispatch created / materially updated (the full new job) | SchedulePayload |
| `Status` | dispatch status changed | StatusPayload |
| `notes` | note added to a dispatch | NotesPayload |
| `ncc` | non-covered cost created/accepted | NCCPayload |

`external_organization_id` (tenant) enum: **AHS | HSA | FTDR | 2-10**.

### Schedule payload (new/updated dispatch — the auto-intake gold)
```json
[{
  "external_organization_id": "AHS",
  "operation": "Schedule",
  "vendor": { "external_id": 1586688, "name": "MCS'S APPLIANCE SERVICE", "phoneNumber": "1111111111", "email": "..." },
  "dispatch": {
    "external_id": 456559468,               // Dispatch Id (our job key)
    "dispatchType": "Original",             // Original|Transfer|Continuation|Recall|Referral|Second Opinion|Concealed|Dispatch Rejected|Transfer Item
    "trade": "APL",                          // trade code (APL, HVAC, ...)
    "priority": "Normal",                   // Normal|Expedited
    "date": "2024-04-19T30:01:35Z",
    "isAuthoRequired": false,
    "customers": [{
      "name": "BEN CESTA", "email": "...", "preferredCommunicationType": "PHONE",
      "phone": [{ "number": "3844814979", "type": "HOME" }],
      "address": { "streetNumber": "113", "streetName": "NORTH ST", "unitNumber": "", "unitType": "", "city": "AUBURN", "state": "NY", "zip": "13021", "zipFour": "1824" }
    }],
    "property": { "external_id": 261565378, "address": { ... } },   // commercial property (optional)
    "items": [{
      "external_id": 586, "description": "Dishwasher", "status": "Open",
      "symptoms": ["Does Not Cleaning"],
      "attributes": { "Brand": "Whirlpool", "location": "Kitchen" }
    }]
  }
}]
```
→ Contains the ENTIRE job (customer, phone, address, appliance, brand, symptom, location,
autho-required, priority, trade) — richer + real-time vs. dispatch emails.

### Status payload (Frontdoor-initiated status change)
```json
[{
  "external_organization_id": "AHS", "operation": "Status",
  "dispatch": { "external_id": 455139438, "isAuthoRequired": false },
  "status": {
    "description": "Initial Appointment Scheduled",
    "code": 30,                              // see catalog below
    "updated_at": "2024-04-19T10:01:09+0000",
    "start_time": "2024-04-19T10:01:00+0000",
    "items": [{ "external_id": 586, "description": "Dishwasher", "status": "" }]
  }
}]
```

### NCC payload
```json
[{ "external_organization_id":"AHS", "operation":"ncc", "dispatch":{ "external_id":455120198 }, "ncc":{ "status":"created" } }]
```

### Notes payload
```json
[{ "external_organization_id":"AHS", "operation":"notes", "dispatch":{ "external_id":455139458 },
   "note":{ "type":"note", "text":"...", "created_at":"...", "created_by":"TONY STARK", "application":"CSC" } }]
```
`note.type` ∈ {`note`, `expert_call_id`}.

## INBOUND (Ant → Frontdoor) — needs Dev Portal (Brian's Step 4)
- Requires: Dev Portal account → register org → generate **Sandbox** API Key (ClientId /
  Username / Password) → **share the Client ID with Frontdoor so they configure access to
  your account** (THIS is the 403-unblocking step Brian's email covers) → sandbox validate →
  production.
- Auth: Frontdoor-issued creds only (OAuth2 → JWT Bearer). No custom auth. Env-specific
  (sandbox vs prod). REST/JSON, synchronous.
- Supported inbound events: **Dispatch Status Update** (Appointment Set, Job Complete, Job
  Cancelled, Unable to Contact Customer, …) + **Notes Update** (technician notes).
- Payloads mirror the outbound Status/Notes shapes (`{"data":[{"type":"status","object":{…}}]}`).
- **Already built:** `netlify/functions/_lib/frontdoor.js` — `dispatchStatusUpdate()` +
  `STATUS` code map, OAuth token cache, `configured:false` until `FRONTDOOR_*` secrets set.
  Sandbox auth verified live (JWT minted); stuck at **403** = key not yet authorized to our
  account = exactly what Brian's ticket step fixes.

## Status-code catalog (codes 10–590, step 10)
Descriptions listed in the doc (exact code↔description pairing to be locked from the
Appendix A YAML): Job Completed · In Progress · Initial Appointment Scheduled · Cancel Job ·
Automated Dispatch Load Successful · Unable to contact customer to schedule · On My Way ·
Running Behind · Arrived · In Progress With Parts on Order · In Progress With Need To Replace ·
Customer not home · Possible Denial · Incomplete · On Hold · Parts/Equipment Status ·
Customer Appointment Set · Customer Complete · Appointment Complete · Appointment Cancelled ·
Survey Complete · Dispatch Assigned · Dispatch Accepted · Rescheduled appointment · Left
Customer a Message to Schedule · Authorization Reported · Appliance Options Offered ·
Appliance Replaced · CIL Offered · CIL Accepted · CIL Declined · Authorization Approved ·
Authorization Denied · Authorization Approved with Limitations · Parts Ordered · Equipment
Ordered · Return appointment · Parts Have Arrived · Equipment Arrived · Installation
Appointment Set · Job Invoiced · Authorization Awaiting Contractor Input · 2nd Opinion
requested · Cash Out Approved · NCC Accepted · NCC Rejected · Quote Started · Quote Submitted ·
Quote Approved · Quote Expired · Quote Cancelled · Availability Verified · Equipment Shipped.
(`_lib/frontdoor.js STATUS` has our working subset — reconcile against Appendix A YAML.)

## Build plan
1. **Outbound webhook receiver** (`frontdoor-webhook.js`) — DARK/guarded scaffold built
   2026-07-09: bearer auth, parses the event array, routes by `operation`, dedups by
   dispatch_id, logs every event. Live job-create gated behind `FRONTDOOR_WEBHOOK_LIVE=1`
   (default off). Give Frontdoor the URL + agree the bearer token → new AHS jobs flow in.
2. **Inbound push** — wire `_lib/frontdoor.js dispatchStatusUpdate()` into the job lifecycle
   (on-my-way / arrived / complete / notes / NCC). Blocked only on Brian authorizing the
   Client ID.
3. Sandbox validate both → production.

## What we still need from Teddy
- **Frontdoor Contractor / Vendor ID** (`FRONTDOOR_VENDOR_ID`) — for inbound payloads + the
  Brian reply. (Sample `vendor.external_id: 1586688` is the doc's fake.)
- Relay our **webhook URL** to Frontdoor + agree the **bearer token** (vault
  `FRONTDOOR_WEBHOOK_TOKEN`) for outbound.
- **Frontdoor Contractor / Vendor ID** (`FRONTDOOR_VENDOR_ID`).
- For inbound: complete Step 4 (share Client ID → Frontdoor authorizes the account → clears 403).
- For outbound: hand Frontdoor our webhook URL + agree the bearer token.

## Appendix A — exact OpenAPI schema (locked from the YAML, 2026-07-09)
Single endpoint `POST /dispatch/outbound`, `requestBody` is `oneOf` the 4 payloads.
Responses: 200 processed / 400 invalid / 500 error. All payloads share
`external_organization_id` (enum **AHS | HSA | FTDR | 2-10**) + `operation`.

**SchedulePayload** (`operation: Schedule`) — the full job:
- `vendor`: { external_id:int, name:str, phoneNumber:str, email:str(email) }
- `dispatch`:
  - external_id:int, dispatchType:str, trade:str,
    priority:str enum **[Normal, Expedited]**, date:str(date-time), isAuthoRequired:bool
  - `customers`: array of **DispatchCustomer**
  - `items`: array of **Item**
  - `streamLink`:str, `streamLinkExpiryDate`:str  ← media/stream link on the dispatch
  - `coverage`: { details:{ header:str, content:[str] }, notes:[str] }
  - `payments`: { total:num, paid:num, remaining:num }
  - `contract`: { external_id:int, listingEffectiveDate:date, listingExpiryDate:date,
    effectiveDate:date, expiryDate:date, customers:[**ContractCustomer**] }

**StatusPayload** (`operation: Status`):
- `dispatch`: { external_id:int, isAuthoRequired:bool }
- `status`: { description:str, code:int, updated_at:date-time, start_time:date-time,
  items:[**Item**] }

**NotesPayload** (`operation: notes`):
- `dispatch`: { external_id:int }
- `note`: { type:str, text:str, created_at:date-time, created_by:str, application:str }

**NCCPayload** (`operation: ncc`):
- `dispatch`: { external_id:int }
- `ncc`: { status:str }

**Shared schemas:**
- **DispatchCustomer / ContractCustomer**: { external_id:int, name:str, email:str(email),
  preferredCommunicationType:str enum **[PHONE, EMAIL]**, phone:[{ number:str, type:str }],
  property:{ external_id:int, address:{ streetNumber, streetDirection, streetName,
  unitNumber, unitType, city, state, zip, zipFour } } }
- **Item**: { external_id:int (aka STAR DB item id), legacy_item_id:int, description:str,
  status:str (Open|Cancelled), symptoms:[str], attributes:{ Brand:str, location:str } }

Note: the YAML types `status.code` as a plain integer (no enum) — the **code↔description
pairing** (10–590) lives in the narrative catalog + the live API reference, not the YAML.
Lock the exact map from developer.frontdoorhome.com/apis or during sandbox validation;
`_lib/frontdoor.js STATUS` holds our working subset today.

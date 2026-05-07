# Capacity Governor — Architecture Design

**Last updated:** 2026-05-07
**Owner:** James (Teddy) Pivacek
**Status:** Design draft — citations verified against `Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf`. Phase 3 implementation gated on the load-bearing open question below.

---

## Opening summary

The Capacity Governor is the system that prevents tech overload by
dynamically throttling ServicePower dispatch capacity per tech, per
day, per time band — without ever rejecting a dispatch (which would
penalize us in ServicePower's ranking algorithm). The architecture
is three layers: a skeleton schedule in Xano, a real-time load
monitor in Xano, and a dynamic adjuster that calls ServicePower's
SOAP API to close capacity windows as techs fill up.

This document's citations are grounded in the v2.8 PDF that lives at
`docs/servicepower/Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf`.
Page references are to that PDF.

### ⚠️ The single biggest unresolved question

**The capacity API operates per-technician (TechKey), not per-area.**
This contradicts `docs/warranty-operations-strategy.md`, which states
"ServicePower itself has no awareness of individual techs — they only
see 'TN Appliance Exchange' coverage in each area."

The Dispatch v2.8 PDF says otherwise: every documented capacity
operation (`updateTechCapacity` Section 13, `updateTechInfo` Section 12,
`addTechInfo` Section 6.1) requires a **TechKey** parameter — "Unique
identifier for the technician." There is **no documented per-area
capacity API**.

We currently do not know:
- The TechKey values that ServicePower uses for our techs
- Whether the portal's "7 sections" are stored as fictional
  per-section techs (one TechKey per section), or as real techs
  Danielle never saw at that abstraction layer, or as an
  undocumented per-area API not in this PDF
- Whether we even have any techs registered in ServicePower today,
  or whether the portal's "TN Appliance Exchange" coverage is set
  at a higher-level group/servicer-account scope

**This is Phase 3 step 0 — a hard prerequisite before any SOAP code
is written.** Three candidate hypotheses + verification approaches
are detailed in the Phase 3 plan below.

**One of `warranty-operations-strategy.md` or this document will need
updating once ground truth is known.** Do not let the two docs sit
inconsistent past the Phase 3.0 resolution.

---

## Verified API surface

### Authentication (Section 5.1, page 7)

> "The web service has an authentication section named UserInfo which
> contains two elements - user ID and password. A manufacturer client
> must obtain a user and password that is valid only for web service
> connections. The user id and password used to connect to the website
> will not work.
>
> **Servicers may use the same user and password that is used to log
> on to the web site.** The information is provided in the welcome email."

**Practical meaning:** TN Appliance is a *servicer*, not a manufacturer
client. Danielle's portal login credentials work directly as the API
auth pair. No separate API-only credential needs to be obtained.

There is **no token issuance flow** — UserId + Password are passed in
the body of every request via a `UserInfo` SOAP element. That means:
- No expiring access token to refresh
- Simpler client (no auth caching layer)
- Credential rotation requires updating every call site (single
  env-var indirection covers this)

### Time bands (Section 14.2, page 46)

The 5 IDs below are the **only** values accepted by the
`Timeband` field on `updateTechCapacity` and the `BasicCapacity:TimeBand`
field on `updateTechInfo`. Any other value triggers error code SP053
"TIMEBAND DOES NOT EXIST IN THE SYSTEM."

| TIME BAND ID | DESCRIPTION   | START | END   |
|--------------|---------------|-------|-------|
| `8-12`       | MORNING       | 8:00  | 12:00 |
| `12-17`      | AFTERNOON     | 12:00 | 17:00 |
| `8-17`       | ALL DAY       | 8:00  | 17:00 |
| `17-21`      | EVENING       | 17:00 | 21:00 |
| `6-8`        | EARLY MORNING | 6:00  | 8:00  |

**Open question — overlap semantics:** `8-17` (ALL DAY) literally
covers `8-12` (MORNING) + `12-17` (AFTERNOON). The PDF doesn't
specify whether setting `8-17` capacity to N is the same as setting
`8-12` to N **and** `12-17` to N, or whether the bands are
independent counters. Phase 3 needs to test this empirically — set
`8-17` to 5, dispatch a `8-12` job, observe whether capacity decrements
in `8-12` only or in both. **Architectural impact: which band do we
write to when throttling?**

### `updateTechCapacity` operation (Section 13, pages 42–45)

> "This is a maintenance task, not part of the standard workflow. The
> updateTechCapacty [sic — typo in PDF] API is used to update the
> capacity of a technician created either within the ServiceDispatch
> user interface or by using the updateTechInfo API."

**Request fields (Section 13.2, page 43):**

| Field      | Required | Length | Notes |
|------------|----------|--------|-------|
| `UserId`   | Y        | 10     | Servicer's portal login (per Section 5.1) |
| `Password` | Y        | 10     | Servicer's portal password |
| `SvcrAcct` | Y        | 10     | Servicer account number |
| `MfgId`    | (n/a)    | -      | "Client's unique ID" — not marked required, manufacturer-side identifier |
| `TechKey`  | Y        | 10     | Per-tech identifier (the unresolved-question variable) |
| `Capacity` | Y        | 3      | Number of jobs allowed in this band on this date (max 999, but ServicePower portal practical max is "50") |
| `Datetime` | Y        | 8      | YYYYMMDD — **single specific date, not a recurring pattern** |
| `Timeband` | Y        | -      | One of the 5 IDs from Section 14.2 |

**Response fields (Section 13.4, page 45):** `erroroccurred` (Y=fail
/ N=success), `ackmessage`, `updatedate` (YYYYMMDD when transaction
applied), `errordata` complex object with `Code` (e.g., `SP053`) and
`Description`.

**Date format note:** Section 13 uses `YYYYMMDD` for `Datetime`. By
contrast, `getCallInfo` (Section 7, page 14) uses
`mm/dd/yyyy HH24:mi:ss`. Two different date formats in the same SOAP
service — easy to typo, worth a centralized formatter helper.

### `updateTechInfo` operation (Section 12, pages 38–41)

This is the second capacity primitive — and it changes the architecture.

`updateTechInfo` includes a **`BasicCapacity` complex field** with
sub-elements (Section 12.2, page 39):
- `Capacity` (number)
- `Day` — one of `MON`, `TUE`, `WED`, `THU`, `FRI`, `SAT`, `SUN`
- `TimeBand` — one of the 5 IDs

**This is the recurring weekly default.** Once set per
(tech × day-of-week × time-band) combination, ServicePower applies
that capacity automatically every week. There is no expiration or
reset.

### Two-tier capacity model (key architectural insight)

| Primitive | Granularity | Use |
|---|---|---|
| `updateTechInfo` → `BasicCapacity` | per-tech × day-of-week × band (recurring) | Set once per tech to establish weekly defaults |
| `updateTechCapacity` | per-tech × specific-date × band (one-shot) | Override the default for a specific date |

**Implication:** "Day rolls over → reset capacity to max" happens
**automatically** because tomorrow's date is governed by
`BasicCapacity`. The dynamic adjuster only writes per-date overrides;
those naturally only apply to the date specified.

**No daily reset cron is needed.** Drop that step from the previous
architecture sketch in `warranty-operations-strategy.md`.

---

## Three-layer architecture

### Layer 1 — Skeleton schedule (Xano)

Static per-tech weekly pattern: which clusters each tech covers on
each day, daily caps, day-shape rules (start time, late-day caps).
Migrated from `docs/tech-operational-profiles.md` into a Xano table
(`tech_availability`) once Ant Tech Scheduler activates.

**ServicePower side:** rendered into `BasicCapacity` weekly defaults
via `updateTechInfo` calls — one call per (tech × day-of-week × band)
the tech is active in. ~6 techs × 7 days × 5 bands = up to 210
combinations, but most cells are zero (a tech's not active on most
day/band combinations). Realistically ~30–60 active cells written
once per tech.

### Layer 2 — Real-time load monitor (Xano)

Per-tech, per-day job count from all sources (HCP polling already
shipped, plus ServicePower `getCallInfo` integration). Tracks against
the skeleton's caps. Visible on the dashboard. Cron-driven (~15 min
cadence, matching the existing HCP poll).

**ServicePower side:** `getCallInfo` + `getCallAttributes` provide the
ServicePower-dispatched job stream. Polling pattern recommended in
the PDF (Section 6.2, page 10): "It is recommended that getCallInfo
is scheduled to run at regular intervals throughout the day in order
to obtain a list of updated jobs." No specific frequency stated.

### Layer 3 — Dynamic adjuster (Xano → ServicePower SOAP)

When Layer 2 detects a tech is approaching their daily cap (in a
specific band), Layer 3 fires `updateTechCapacity` with `Capacity = 0`
for that tech / today / that band. ServicePower stops dispatching to
that tech in that band for the rest of the day.

Tomorrow, the override expires (it was date-specific). Next day's
`BasicCapacity` takes over as the default. Self-healing.

**Manual override path** (for owner-driven decisions): a Xano
admin endpoint that takes (tech, date, band, capacity) and calls
`updateTechCapacity` directly, bypassing the load-monitor logic.

---

## Phase 3 build plan

### Phase 3.0 — Resolve TechKey acquisition (prerequisite)

**No SOAP code should be written until this is resolved.** Three
hypotheses and how to verify each:

**Hypothesis A: Sections-are-fictional-techs.** The portal's 7 sections
are each backed by a TechKey we don't know about, with capacity set
at the section-as-fictional-tech level.
- *Verify:* Have Danielle log into the portal, navigate to wherever
  she sets capacity, and screenshot the data model — is there a
  "technician" entity per section, or just "section + capacity"?
  Look for any internal IDs visible in URLs or detail panes.
- *Verify:* Call `getCallInfo` against staging with our portal creds
  and inspect the `TechKey` field on returned calls. If TechKeys
  appear and they look like section names, hypothesis confirmed.

**Hypothesis B: Real-techs-exist-but-Danielle-never-saw-them.** Six
TechKeys exist for our six real techs, set up at servicer onboarding,
but Danielle has only worked at the section/area UI layer.
- *Verify:* Same staging call as above — TechKeys in returned calls
  should match real tech names.
- *Verify:* Check the staging environment's `addTechInfo` history — if
  there's a way to inspect existing techs (the PDF says "not all
  APIs are documented within this guide" — page 9; check the live
  WSDL via SoapUI for a `getTechs` / `listTechs` operation).

**Hypothesis C: Undocumented-area-API.** The portal's per-section
capacity is managed via a different API not in the v2.8 guide.
- *Verify:* Pull the staging WSDL
  (`https://fssstag.servicepower.com/sms/services/SPDService?wsdl`),
  enumerate all operations, look for anything area-shaped
  (`updateAreaCapacity`, `updateSectionCapacity`, etc.). The PDF
  mentions `addAreaInfo` and `updateAreaInfo` (Section 6.1, pages 8–9)
  but those manage *coverage zones*, not capacity. A capacity-by-area
  variant might or might not exist.

**Decision points after Phase 3.0:**
- If hypothesis A or B: proceed with the per-tech architecture as
  designed, using the discovered TechKeys.
- If hypothesis C: the per-tech architecture in this doc is wrong;
  rework against the area-keyed API.

**Update `warranty-operations-strategy.md`** with the resolution. One
of the two docs is currently incorrect; reconcile before Phase 3.1.

### Phase 3.1 — Build SOAP client

**Question to resolve before coding: SOAP in XanoScript or in a
Netlify function?**

XanoScript has `api.request` with body strings and headers, so a
hand-rolled SOAP envelope is *technically* possible. But:
- XML escaping / namespace handling is fragile when string-built
- WSDL parsing isn't a thing in XanoScript
- Existing precedent: every other external integration in this repo
  (Stripe, Twilio, Claude, Netlify auth gateways, HCP webhook proxy)
  uses Netlify Node functions for protocol-heavy work and Xano for
  business logic.

**Recommended:** Netlify Node function (`netlify/functions/sp-soap-proxy.js`)
that wraps the `soap` npm package, accepts internal-auth-gated POST
calls from Xano, and translates `{operation, params}` JSON into
proper SOAP envelopes. Xano endpoints call the proxy via `api.request`
the same way they call HCP today.

**Credential storage:** ServicePower UserId + Password go into Netlify
env (`SP_USER_ID`, `SP_PASSWORD`, `SP_SVCR_ACCT`). Same pattern as
`HCP_API_KEY`. The Netlify proxy reads them and injects them into
SOAP envelopes server-side. Xano never sees the password.

### Phase 3.2 — `getCallInfo` + `getCallAttributes` integration

Build a Xano cron task `sp_poll_recent_calls` (matching the existing
`hcp_poll_recent_jobs` pattern) that:
1. Calls the SOAP proxy's `getCallInfo` operation, passing
   `FromDatetime` = last poll's `ToDatetime` minus an overlap window,
   `ToDatetime` = now (formatted as `mm/dd/yyyy HH24:mi:ss` per
   Section 7).
2. For each returned call, idempotent-upserts into Xano `jobs` (same
   pattern as `hcp_backfill_recent_jobs` and `hcp_poll_recent_jobs`).
3. Optionally calls `getCallAttributes` for extended info on new calls.
4. Tracks load per (tech × today × band) for Layer 2.
5. Cron at 15 min cadence, gated by `SP_POLL_ENABLED` env flag.

### Phase 3.3 — `updateTechInfo` for BasicCapacity weekly defaults

One-shot maintenance endpoint `sp_initialize_tech_capacity_defaults`
that reads `tech_availability` rows in Xano and writes corresponding
`BasicCapacity` entries via `updateTechInfo`. Idempotent (re-running
overwrites with current values). Run once per tech onboarding or
after schedule changes.

### Phase 3.4 — `updateTechCapacity` intra-day adjustment trigger

Extend the Layer 2 load monitor: when a tech's job count for today
in a specific band reaches a configured threshold (e.g., 80% of
BasicCapacity), fire `updateTechCapacity` with `Capacity = 0` for
(tech, today, band). Log to event_log. Don't fire again for the same
combination today (idempotency by checking event_log).

### Phase 3.5 — Manual override path

Xano endpoint `sp_set_tech_capacity_override` that takes
`{tech_id, date, timeband, capacity}` and calls the SOAP proxy. Auth
required. Used by Teddy/Danielle for ad-hoc adjustments (e.g., "Lee
is sick today, set his capacity to 0 across all bands").

### Phase 3.6 — Monitoring / alerting on SOAP failures

`updateTechCapacity` failures (`erroroccurred=Y`) need owner
visibility — a misfired throttle leaves a tech overbooked OR
permanently zeroed-out. Log all SOAP responses to event_log;
threshold-alert via SMS to Teddy when:
- More than 3 failures in 15 min
- Any `SP005` (USER AUTHENTICATION FAILED — credential expiry/
  rotation) error
- Any `SP053` (TIMEBAND DOES NOT EXIST — code-side bug we should
  catch)

---

## Operational findings worth knowing

- **No documented rate limits.** No throttling, quota, or 429-style
  guidance in the PDF. Could discover via production failures. Plan:
  start with conservative cadence (15 min poll, ad-hoc throttle calls
  ≤10/day during normal operation), watch for unusual error rates.
- **No auth token lifetime.** UserId + Password sent in every request;
  no expiring token. Credential rotation = update Netlify env vars
  and redeploy.
- **Date format inconsistency:** `getCallInfo` uses
  `mm/dd/yyyy HH24:mi:ss`, `updateTechCapacity` uses `YYYYMMDD`.
  Centralize formatting in the SOAP proxy to avoid bugs.
- **Error code SP053 = "TIMEBAND DOES NOT EXIST"** — confirms the 5
  fixed band IDs are validated; passing anything else fails the
  request.
- **TechKey is 10 chars max** (Section 13.2, page 43). Suggested as
  employee-ID. We can choose our own when calling `addTechInfo`.
- **No `listTechs` / `getTechs` API documented.** PDF explicitly notes
  "not all APIs are documented within this guide" (page 9). The live
  WSDL may have one — check during Phase 3.0 verification.
- **`updateCallInfo` CAN reject calls** (sets `CallStatus="REJECTED"`)
  — but per `warranty-operations-strategy.md`'s "never reject" policy,
  we don't use that path. The API permits it; ServicePower's algorithm
  penalizes it.

---

## Open questions

1. **TechKey acquisition (the big one).** See Phase 3.0. Until
   resolved, the per-tech-vs-per-area architecture rests on an
   unverified assumption.
2. **Time band overlap semantics.** Does `updateTechCapacity` on
   `8-17` independently track `8-17` capacity, or does it cascade to
   `8-12` + `12-17`? Affects which band(s) Layer 3 should write to
   when throttling.
3. **Rate limits / undocumented quotas.** Discover in production.
   Mitigation: conservative cadence + retry-with-backoff on the
   SOAP proxy.
4. **SOAP-in-XanoScript viability.** Likely workable but fragile.
   Recommended: Netlify proxy. Final call deferred to Phase 3.1.
5. **Credential rotation strategy.** What happens when Danielle
   changes her portal password? Need a runbook. Probably:
   `netlify env:set SP_PASSWORD <new>` + redeploy. No code change
   needed if the SOAP proxy reads from env on each invocation.
6. **`MfgId` semantics.** Listed in the schema but description is
   "Client's unique ID" (manufacturer-side). The PDF doesn't say
   whether servicers populate this or leave blank. Test in staging.
7. **Staging vs production credentials.** PDF Section 4.2 (page 7)
   says staging and production are separate environments with
   separate URLs; do they share creds, or is each environment a
   separate invitation? Affects how to set up the dev/test flow.
8. **Live WSDL inspection.** PDF documents core APIs only; full
   surface is in the WSDL. Pull and import into SoapUI early in
   Phase 3 to enumerate everything that exists.

---

## Cross-references

- `docs/warranty-operations-strategy.md` — operational context, three-layer
  architecture vision, why we want SOAP integration. **Will need
  reconciliation after Phase 3.0 if the per-tech model holds.**
- `docs/tech-operational-profiles.md` — per-tech preferences that
  Layer 1's skeleton schedule will encode.
- `docs/servicepower/Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf` —
  source of all citations in this document.
- `docs/servicepower/README.md` — full PDF library inventory.

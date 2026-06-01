# Warranty Portal Automation — Scoping

**Date:** 2026-05-31
**Status:** Scoping (not implementation)
**Goal:** Automate the manual portal entry step for warranty claim submissions. Biggest single Danielle-replacement lever.

---

## 1 · The problem

After a warranty job is completed with a full TDR:
1. `warranty_submission.js` / `warranty_claim_action.js` agent composes the claim package via Claude ✅
2. Digest SMS goes to Danielle ✅
3. **Danielle manually logs into vendor portal, enters claim, attaches photos, submits.** ← THIS IS WHAT WE'RE AUTOMATING

For 50 warranty jobs/week (rough estimate), this is ~30-90 min of Danielle's time per day. If she leaves, this falls to Teddy or grinds to a halt.

---

## 2 · Vendors to automate (in priority order)

| Vendor | Portal | Auth | Volume | Complexity |
|---|---|---|---|---|
| **ServicePower** (Allstate / SquareTrade) | https://hub.servicepower.com | Username/password | HIGH | MED — well-structured portal |
| **AHS / Frontdoor** | dispa.me (per existing job notes_internal links) | Token / login | HIGH | HIGH — opaque mobile-style flows |
| **Frontdoor (directly)** | https://platform.frontdoor.com (TBD) | Login | MED | UNKNOWN |
| **NSA** | Unknown — paper-based? | Unknown | LOW | UNKNOWN |
| **210** | Paper checks only | N/A | LOW | N/A (no portal) |

**Recommendation:** start with **ServicePower** (highest leverage, best-documented, structured portal). Land that, then tackle AHS.

---

## 3 · Path A — APIs (preferred if available)

For each vendor, research:
- Does the vendor publish a contractor API?
- If yes, what auth scheme (API key / OAuth / token)?
- What endpoints exist for claim submission, status check, payment lookup?

### ServicePower

ServicePower has a contractor REST API. Key research targets:
- API documentation page (typically at `developer.servicepower.com` or available through portal "API Access" tab)
- OAuth or API key model
- Sandbox environment for testing
- Rate limits

If we can submit claims via API, the whole portal step becomes: `agent calls API → confirmation # back → audit row → Danielle / Teddy SMS "claim submitted, confirmation #XXX"`. Trivial to wire.

### AHS / Frontdoor

Frontdoor has historically been less developer-friendly. The `dispa.me` short links suggest a mobile-optimized flow rather than an API surface. Research targets:
- Reach out to Frontdoor contractor support, ask about API access for claim submission
- Check if their email-based workflow (which we already parse for dispatch) has a reverse channel for status updates

### NSA + others

Phase 2 — defer until volume justifies. Manual entry stays for these in the meantime.

---

## 4 · Path B — Browser automation (Playwright)

If APIs aren't available:
- **Tech stack:** Playwright (Node.js) running on a small VPS (or Mac Mini)
- **Auth:** vendor credentials in env vars, sessions cached
- **Flow:** headless browser opens portal → logs in → navigates to claim form → fills fields → attaches photos → submits → screenshots the confirmation page → POSTs result to Xano

**Pros:**
- Works for any portal regardless of API support
- Mirrors what Danielle does today, so testable side-by-side

**Cons:**
- Brittle — portal layout changes break the script
- Maintenance burden (selectors drift over time)
- Slower (page-load times) than API
- Requires session/credential management

**Mitigation:**
- Per-vendor adapter modules with shared interface
- Daily smoke-test that logs in + reads status page (catches breakage early)
- Manual fallback: if automation fails, fall back to "SMS Danielle/Teddy" path

---

## 5 · Per-vendor design template

For each vendor (filled in during the build sprint):

```
# {VENDOR} Adapter

## Auth
- Method: {API key | OAuth | username/password Playwright}
- Credentials: stored in {Netlify env / Xano $env / Mac Mini .env}
- Refresh cadence: {N/A | daily | on-401-error}

## Required fields per claim
- claim_number / dispatch_id
- customer name + address
- failed component
- repair completed
- labor hours
- parts ordered / used (with part numbers)
- photos (job + completion + serial plate)
- tech signature / TDR document

## Submission endpoint / page
- URL: {API endpoint or portal page}
- Method: {POST / form submit}
- Expected response: {confirmation # / submission ID}

## Status check
- URL: {API endpoint or portal page}
- Cadence: every {N} hours
- Fields to capture: paid / pending / disputed / denied

## Error handling
- 401 → re-auth + retry
- 422 (validation) → mark for review, SMS owner
- 500 → retry 3x with backoff, then mark for review
- Network error → retry next cron
```

---

## 6 · Architecture

```
JOB_COMPLETED (warranty, full TDR)
        │
        ▼
warranty_claim_action.js  (existing)
        │
        ├── composes claim package (existing)
        │
        ▼
NEW: emit VENDOR_PORTAL_SUBMIT_<VENDOR> signal
        │
        ▼
vendor_portal_submit_<vendor>.js agent  (NEW per vendor)
        │
        ├── loads claim package + photos
        │
        ├── calls vendor adapter (API or Playwright)
        │
        ├── on success: write `warranty_submissions` row + audit + SMS Danielle/Teddy "Claim submitted, confirmation #XXX"
        │
        └── on failure: SMS Danielle/Teddy "Claim submission FAILED for job #Y — manual entry needed" + audit
```

---

## 7 · New table — `warranty_submissions`

```
id                int (PK)
created_at        timestamp =now
job_id            int (FK)
vendor            text          // 'servicepower' | 'ahs' | 'frontdoor' | 'nsa'
status            text          // 'submitted' | 'failed' | 'manual_required' | 'paid' | 'denied'
confirmation_id   text?         // vendor's confirmation # if submitted successfully
submission_method text          // 'api' | 'playwright' | 'manual'
attempts          int =0
last_attempt_at   timestamp?
error_message     text?
paid_amount       decimal?      // when status flips to 'paid' (per Path A's reimbursement-lag agent)
paid_at           timestamp?
notes             text?
```

Indexes: primary; btree on (job_id, vendor); btree on status.

---

## 8 · Photo handling

Vendor portals typically require:
- Photo of the failed part (before)
- Photo of the installed new part (after)
- Photo of the appliance model/serial plate
- Photo of the receipt or completed TDR document

Our system already captures these via `job_attachments` table tied to `tech_assist_session`. The adapter needs to:
1. Pull all attachments for the job
2. Filter to image MIME types
3. Optionally pre-classify which is the "before" / "after" / "model plate" (via filename or Claude vision)
4. Upload to the vendor portal in the order/format required

---

## 9 · Sandbox / safety

Before any portal submission goes live:
- Build the adapter against a sandbox if vendor provides one
- Run in `dry_run` mode for 1-2 weeks: agent fires, captures what WOULD be submitted, sends to Danielle for review. She manually compares to what she would have entered.
- Promote to live submission only after dry-run accuracy ≥ 95%
- Always keep "SMS Danielle on failure" as a fallback

---

## 10 · Effort estimate

| Workstream | Effort |
|---|---|
| API research (per vendor, before any code) | 2-4 hours per vendor |
| ServicePower API adapter (if API available) | 1-2 days |
| ServicePower Playwright adapter (if no API) | 3-5 days |
| AHS adapter | 3-5 days regardless of path |
| Photo handling layer | 1 day |
| Dry-run framework | 1 day |
| Per-job confirmation SMS + status polling | 0.5 day |

**Total: 1-2 weeks for ServicePower live + AHS dry-run.** Cannot ship in the 6/1-6/6 HCP-kill week — this is a parallel workstream that lands later.

**Implication:** Danielle's warranty submission load doesn't go away during the HCP cut. The cut buys her time back on scheduling + customer comms; portal submission remains hers until this lands.

---

## 11 · Open questions

1. **Vendor relationships / contracts** — do our contractor agreements with ServicePower / AHS authorize API access? Some vendors require explicit opt-in for programmatic submissions. Teddy to confirm.
2. **Credential storage** — vendor passwords are sensitive. Plan: Mac Mini local `.env` with file permissions 600, never committed. Or Xano `$env` (encrypted at rest). Prefer the latter.
3. **Liability if automation submits wrong claim** — adapter writes a `warranty_submissions` audit row pre-submission so we have a fingerprint. If a wrong claim goes through, we can audit + reverse via the dispute resolution path.
4. **Photo classification accuracy** — Claude vision is the fallback for "which photo is the model plate?" If it gets it wrong consistently, fall back to letting the tech tag photos at upload time (small UI tweak in tech-ant-chat).

---

## 12 · Decision points

Before kicking off the build, Teddy should:
- Greenlight which vendor to start with (recommend: **ServicePower**)
- Spend 30 min checking ServicePower portal for an "API access" or "Developers" section
- Confirm credentials can be shared with the system (vs. Danielle-personal account)

Once those land, this becomes a Mon-Fri-next-week sprint.

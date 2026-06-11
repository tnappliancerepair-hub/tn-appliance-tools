# Parts email auto-tracking (Phase 2) — vendor landscape + plan (2026-06-11)

Goal: auto-populate the parts loop (order → ETA → arrived → schedule) from the
order/shipping emails already landing in Gmail, so Danielle barely types. Built
by extending `netlify/functions/parts-vendor-gmail-poller.js` (already reads
Gmail via OAuth, label-based, dry-run friendly — it currently handles DELIVERED
for Marcone/Reliable/Amazon/FedEx/UPS).

## Vendor landscape (from sample emails)

| Vendor | Kind | Email shape | Match key → job | Parse difficulty |
|---|---|---|---|---|
| **Frontdoor** | warranty | text body: "Part automatically ordered for dispatch id **49465889**", "on Order Update — parts ordered for dispatch id …" | **dispatch id / claim** → `find_job_by_claim_number` | Easy (subject/body regex) |
| **Numeric** | warranty | text: "Numeric parts on Order Update — parts have been ordered for the dispatches below" | dispatch id | Easy-ish |
| **Allstate** | warranty | RMA #, "Diagnostic Truck Roll Request", FedEx tracking # | claim # / tracking | Medium (mostly returns) |
| **Marcone** | vendor | HTML: Order#, part# + desc, unit price, **tracking #**, **ship-to address**, sales tax, delivery | ship-to address ↔ job.service_address, or P/O | Medium (HTML table) |
| **iDEAL** (LA) | vendor | HTML: Invoice#, **PO = customer name**, part#, price; often PICK-UP | PO (customer name) → customer match | Medium |
| **Tribles** | vendor | **PDF attachment** (`trbinv_*.pdf`); subject has Inv# | invoice# / PDF body | Hard (PDF text) |
| **Reliable** | vendor | **PDF attachment** invoice; **API coming** | PDF / API | Hard (PDF) — API supersedes |

## What the data gives us
- Warranty order emails (Frontdoor/Numeric) carry the **dispatch/claim id** → clean job match via `find_job_by_claim_number`. Highest volume (≈99% warranty). **Start here.**
- Marcone/iDEAL carry part#, cost, sometimes tracking + ship-to → feed cost/margin + ETA, but matching is fuzzier (address / PO=customer name).
- Tribles/Reliable are PDFs → need attachment text extraction; Reliable API will replace email parsing.

## Staged build (each stage: dry-run → review event_log → go live)

**Stage A — warranty ORDER auto-flag (highest value, cleanest).**
Add poller fingerprints for Frontdoor + Numeric "ordered for dispatch <id>".
Extract dispatch id (subject/body) → `find_job_by_claim_number` → `record_parts_order`
(supplier=frontdoor/warranty, part text, source=gmail) → job flips to
awaiting_parts (badge + can't-schedule guard). Dry-run logs `parts_order_auto_parsed`.

**Stage B — vendor ORDER emails (Marcone, iDEAL). ⏸ DEFERRED — needs real emails.**
Parse HTML for part# + cost + tracking + ship-to/PO. Match Marcone by ship-to
address ↔ job.service_address (or P/O carrying job#), iDEAL by PO=customer name.
Captures cost for the margin/tax ledger. Lower-confidence matches escalate to
Teddy instead of auto-applying. **Held intentionally**: HTML-table cost parsing +
fuzzy address/PO matching is too error-prone to build blind — build it against
live sample emails once Gmail is re-authed (so cost lands in the right job's
ledger). The dispatch-id paths (A + C) cover the 99% warranty volume already.

**Stage C — DELIVERED side (extend existing). ✅ SHIPPED 2026-06-11 (dry-run).**
Poller already detected delivered for Marcone/Reliable/Amazon/FedEx/UPS (fuzzy
name/zip match via parts_delivery_observed). Added `DELIVERED_DISPATCH_FINGERPRINTS`
(frontdoor_delivered, numeric_delivered): warranty "delivered for dispatch <id>"
→ `find_job_by_claim_number` → `mark_parts_arrived` → job flips arrived +
scheduling_status=not_ready and pops back into the schedule queue. CONFIDENT
dispatch match (not fuzzy). Shares the `PARTS_ORDER_POLLER_LIVE` dry-run gate;
results returned as `arrived_results[]` for review before flipping live.

**Stage D — PDF vendors (Tribles, Reliable).**
Extract text from the PDF attachment (or use Reliable's API when it lands).
Lowest priority — Reliable API supersedes; Tribles is lower volume.

## Match infrastructure that exists
- `find_job_by_claim_number` — dispatch/claim → job (warranty path).
- `record_parts_order` — now flags the job (parts_status=awaiting_parts + ETA +
  scheduling_status), stores cost/sold for margin/tax.
- `mark_parts_arrived` / `customer_mark_parts_arrived` — arrival → needs_scheduled.
- The poller's label + dry-run + escalate-to-Teddy pattern (mirror
  warranty-status-gmail-watcher's DRY-RUN-by-default safety).

## Recommendation
Build **Stage A** first (warranty dispatch-id order emails) against the live
Gmail in DRY-RUN, review the parsed `event_log` rows for a day, then flip live.
Then B, C. Defer D (PDFs) — let the Reliable API replace it.

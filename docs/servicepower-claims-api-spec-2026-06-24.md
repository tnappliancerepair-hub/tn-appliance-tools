# ServicePower ServiceClaims API — Retrieval spec (captured 2026-06-24)

Source: **Servicer Integration Guide — Claims Retrieval v1.2** (9-page PDF in the HUB).
This is a **SEPARATE API from dispatch** (`SPDService` SOAP). Claims is **REST/JSON over HTTPS**.

## What it does
ServiceClaims = the ServiceDispatch module for **submitting + querying claims for reimbursement**.
Retrieval lets us READ a claim's status + the payment breakdown (labor/parts/travel/total + payment date).
→ kills manual portal claim-checking AND lets Ant reconcile warranty payments automatically.

## Auth (§4.1) — same creds as dispatch, in the JSON body (not a header)
```json
"authentication": { "userId": "SOMEUSER", "password": "userpwd" }
```
Servicers use the **same user/password as the HUB login** (= our vaulted `SERVICEPOWER_USER_ID` / `_PASSWORD`, each ≤10 chars). HTTPS only.

## Endpoints (§5.1) — North America (we are NA)
- **TEST:** `https://upgdev.servicepower.com:8443/services/claim/v1/retrieval`
- **PRODUCTION:** `https://claimworks.servicepower.com:8443/services/claim/v1/retrieval`
- (EU: `claimsqa-eu` / `claims-eu.servicepower.com` — N/A.)
- Method: **POST** JSON.

## Request elements (§5.2) — live sample pulled from their server
```json
{
  "manufacturerName": "",        // A30 — MANDATORY
  "serviceCenterNumber": "",     // A12 — required for a servicer user (= our SvcrAcct TNA00001)
  "claimIdentifier": "",         // A30 — manufacturer's unique claim id
  "claimBatchNumber": 0,         // N6  — claimBatchNumber + claimSequenceNumber = unique id in ServiceClaims
  "claimSequenceNumber": 0,      // N6
  "claimNumber": "",             // A15 — claim # assigned within ServiceClaims
  "callNumber": "",              // A20 — the dispatch call number (we have these!)
  "authentication": { "userId": "", "password": "" }   // both A10, MANDATORY
}
```
Pass **only one** primary key: claimIdentifier, OR claimNumber, OR callNumber, OR (claimBatchNumber + claimSequenceNumber).
**OPEN QUESTION:** `manufacturerName` is documented mandatory even for a servicer querying by callNumber — unclear what value a servicer passes (brand? client/warranty co?). Discover by reading the ER message on an empty-mfg call.

## Response (§5.4) — live sample pulled from their server
```json
{
  "responseCode": "OK | ER",     // A2
  "transactionId": "",           // A50 — quote this when reporting issues
  "claims": [ {
    "claimNumber":"", "claimIdentifier":"", "claimBatchNumber":"", "claimSequenceNumber":"",
    "claimStatusCode":"", "claimStatusDescription":"",      // ← the status we want
    "callNumber":"", "authorizationNumber":"",
    "brandName":"", "productName":"", "modelNumber":"", "serialNumber":"",
    "servicerNumber":"", "servicerName":"",
    "receivedDate":0, "editedDate":0,                       // CCYYMMDD numeric
    "paymentType":"", "paymentMethod":"", "paymentAmount":0.0,
    "paymentDate":0, "periodEndingDate":0, "paymentTransactionNumber":"",
    "paidLaborAmount":0.0, "paidPartsAmount":0.0, "paidPartsHandlingAmount":0.0,
    "paidTravelAmount":0.0, "paidOtherAmount":0.0, "paidMileageAmount":0.0,
    "paidShippingAmount":0.0, "paidFreightAmount":0.0, "paidIncentiveAmount":0.0,
    "paidFederalTaxAmount":0.0, "paidStateTaxAmount":0.0, "paidTotal":0.0
  } ],
  "messages": [ { "message": "" } ]   // web-service-level errors (bad user/pass, unable to process)
}
```

## Errors (§4.3)
- Numeric type LEN n with DEC d = n digits incl. d decimals.
- Web-service errors (invalid user) → `responseCode:"ER"` + `messages[]`. The specific claim won't be returned.
- Validation errors → in the per-claim `messages` array.

## Connector + test (BUILT 2026-06-24)
- `netlify/functions/_lib/servicepower-claims.js` — `retrieveClaims({manufacturerName,serviceCenterNumber,claimNumber,callNumber,...})`, normalizes claims (CCYYMMDD→ISO, redacts creds). READ-ONLY.
- `netlify/functions/servicepower-claims-test.js` — owner-gated (`?secret=`): `?call=` / `?claim=` / `?mfg=` / `?svc=`.

## 🟢 LIVE-TESTED 2026-06-24 — auth + read PROVEN against production
`servicepower-claims-test` hit `claimworks.servicepower.com:8443` and got real
`transactionId`s back (e.g. `0061924302TNA00001`) with field-level validation — so the
**vaulted servicer creds authenticate against the claims service** and READ works end-to-end.

**Three error messages decode the manufacturerName puzzle:**
- `"Invalid manufacturerName"` → name string not in their manufacturer table (SQUARETRADE, ASURION, I565, SC, MIDEA, ENCOMPASS…).
- `"Invalid manufacturerName/serviceCenterNumber"` → real manufacturer, but **TNA00001 is NOT contracted under it** (every OEM brand: WHIRLPOOL/GE/LG/SAMSUNG/FRIGIDAIRE/BOSCH/MAYTAG/ALLSTATE/LOWES/HOME DEPOT…).
- `"No records found."` → **valid AND contracted to us** — just no claim matching the passed key. **Only `NSA` and `SERVICEPOWER` returned this** → those are our two contracted manufacturer names in ServiceClaims.
- `"One of claimIdentifier or claimNumber or claimBatchNumber/claimSequenceNumber or callNumber must be entered."` → you MUST pass a primary key; can't list-all.

## 🟢🟢🟢 FULLY SOLVED 2026-06-24 — claims READ proven, every number matches the portal
**`manufacturerName` = `SQUARE TRADE` (with the space)** — our single warranty client. The earlier
failures were (a) the missing space, and (b) querying under NSA/SERVICEPOWER (valid contracted names
but NOT our client). **The retrieval key = the `callNumber` = the DISPATCH NUMBER we already have on
every job** (e.g. dispatch `069469374138` → its Paid claim). Tested 6 dispatch-board call numbers →
6/6 HIT, all Paid ($105/$150).

**Live-validated against Danielle's screen (MONAHAN, dispatch 069469374138):** status `P`/Paid,
EFT# `1157090212`, payment_date `2026-06-20`, period_ending `2026-06-16`, paid_total `$150`,
brand GE / DRYER — **every field matched exactly.**

**The Claim Number on the portal is a two-part value: `<callNumber> - <claimIdentifier>`** (e.g.
`069469374138 - 400222084845`). `claimIdentifier` = `claimBatchNumber`(400222) + `claimSequenceNumber`(84845).
You do NOT need it — `callNumber` alone retrieves the claim.

**Claim statuses (from the portal Status dropdown):** `D`-Dtr Review · `F`-Forwarded · `I`-Incomplete
(not yet submitted → NOT retrievable) · `K`-FSS Review · `M`-Mfg Review · `P`-Paid · `R`-Rejected ·
`S`-Approved · `W`-Mfg Reject. **The API only returns claims once submitted (past Incomplete).**

Connector default `manufacturerName` is now `SQUARE TRADE` (override via vault `SERVICEPOWER_MFG_NAME`),
so callers just pass the dispatch/call number.

## Next
- ⭐ **Wire `servicepower-claims-sync` poller** (Netlify scheduled): for each completed SP job, retrieve
  claim by its dispatch number → write back status + paid_total + EFT date/# → Ant reconciles warranty
  payments automatically (replaces Danielle checking the portal claim-by-claim). Also surfaces
  REJECTED/Mfg-Reject claims so nothing falls through.
- **Claims SUBMISSION** (v1.10 guide, separate endpoint) — the bigger win: auto-FILE the claim the
  moment a job completes (so claims don't sit at "Incomplete"). Shadow-first; do NOT submit a live claim
  without Teddy's confirm on a real job.

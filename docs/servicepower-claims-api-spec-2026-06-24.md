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

## Next
- Live test: retrieve a real completed ServicePower job's claim by `callNumber` → confirm auth + see status/payment shape.
- Then wire a `servicepower-claims-sync` poller: for each completed SP job, pull claim status + paidTotal → reconcile our warranty-payment tracking (replaces Danielle checking the portal).
- **Claims SUBMISSION** (v1.10 guide, separate endpoint `/services/claim/v1/submission` likely) — shadow-first, only after retrieval proves the auth + we've confirmed required fields. Do NOT submit a live claim without Teddy's confirm on a real job.

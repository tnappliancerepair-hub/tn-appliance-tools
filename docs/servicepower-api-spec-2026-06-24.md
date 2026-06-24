# ServicePower Servicer API — implementation spec (captured 2026-06-24)

Source: the "Servicer API Integrations" article inside TN Appliance's ServicePower HUB
(servicer account **TNA00001**) + the public WSDL. **No approval gate found — the API
appears usable now with servicer credentials** (unlike Frontdoor's BD-rep gate).

## Service (SOAP / WSDL — older style than REST, but straightforward)
- **Production WSDL:** `https://fss.servicepower.com/sms/services/SPDService?wsdl`
- **Development WSDL:** `https://fssstag.servicepower.com/sms/services/SPDService?wsdl`
- Service name: **SPDService**. SOAP 1.1 (POST text/xml + SOAPAction).

## Auth — credentials IN the request body (no WS-Security header)
Every operation takes a **`UserInfo`** complex type: **`UserID`**, **`Password`**, **`SvcrAcct`**.
- `SvcrAcct` = **TNA00001** (our servicer account).
- `UserID` / `Password` = ServicePower servicer login — **CONFIRM via the Dispatch Web Service Interface v2.8 guide** whether it's the HUB login or a dedicated API user.
- Vault: `SERVICEPOWER_USER_ID`, `SERVICEPOWER_PASSWORD`, `SERVICEPOWER_SVCR_ACCT` (=TNA00001), `SERVICEPOWER_ENV` (production|development).

## Operations (from the live WSDL)
- ⭐ **`updateCallInfo`** — submit call **status updates**, schedule dates, problem descriptions, parts, tech assignment, **completion data**, warranty type. ← THE one we want (status + notes → kills manual portal entry).
- **`getCallInfo`** — retrieve call records by date range / call number / version.
- `getCallNotes` · `getCallAttributes` · `getCallAddress` — call remarks / attributes / service address.
- `getProductCoverage` — coverage/warranty details.
- Config ops (not our priority): `addTechInfo`/`updateTechInfo`/`updateTechCapacity`, `addGroupInfo`/`updateGroupInfo`, `addAreaInfo`/`updateAreaInfo`, `updateServicerInfo`, `updateDispatchOfficeInfo`, `updatePostcode`.
- `getTestService` — health check (good first call to verify auth).

## The 5 Servicer Integration Guides (PDFs in the HUB — GET THESE for exact schemas)
1. **Dispatch Web Service Interface v2.8** ← work-order status/`updateCallInfo` fields + status codes (TOP priority)
2. **Claims Submission v1.10**
3. **Claims Retrieval v1.2**
4. **Create Request for Authorization Web Service v2.5**
5. **Retrieve Request for Authorization Web Service v2.10**

## Exact SOAP structure (from the live WSDL)
- targetNamespace **`urn:SPDServicerService`** (prefix `impl`), document/literal SOAP 1.1, **SOAPAction empty (`""`)**.
- **getTestService**: string in → string out (connectivity check).
- **updateCallInfoObj** (the status push) fields:
  `UserInfo{UserID,Password,SvcrAcct}` · `CallNumber` · `MfgId` · `FSSCallId` · `ScheduleDate` · `ScheduleTimePeriod` · `ProbelmDesc` *(their typo — keep)* · `CallStatus` · **`SPCallStatusID`** · `CallSubStatus` · `SPCallSubStatusID` · `Remarks{NotesDate,Notes,AddedBy}` · `ETA` · `ETF` · `CompletedDate`.
  Response: `ResponseInfo{erroroccurred, ackmessage, updatedate, ...}`.

## Standard job process flow (v2.8 guide §6.2) + regional URLs
Flow: **poll `getCallInfo`** (list available jobs) → getCallInfo/getCallAddresses/getCallAttributes/getCallNotes/getProductCoverage for detail → **`updateCallInfo`** to (a) ACCEPT or REJECT the job, (b) UPDATE status as work progresses, (c) mark COMPLETE. *"It is recommended getCallInfo runs at regular intervals throughout the day to obtain updated jobs."* → so our wiring = a scheduled poller (getCallInfo) + status pushes (updateCallInfo) on our job-lifecycle events.
- **Region-split URLs (we're North America):** staging `fssstag.servicepower.com` ✓ (tested), production `fss.servicepower.com` ✓ (connector default). (EU = fss-stg.hostedservicepower.eu / fss.servicepower.eu — N/A for us.)
- **FASTEST way to get the status-code values:** call **`getCallInfo`** live → returns our real work orders WITH their current SPCallStatusID values (shows the codes in use) AND validates the vaulted creds authenticate. Beats hunting the 95-page image PDF. (Read-only, safe. Needs getCallInfo request schema from the WSDL + production env.)

## 🚨 CREDENTIALS — the vaulted UserID is likely WRONG (v2.8 §7.2)
The getCallInfo param table: **UserId** (req, **max length 10**, *"Provided in the initial invitation email"*), **Password** (req, **max 10**, *"Initially provided in the invitation email, can be updated in the ServiceDispatch UI"*), **SvrAcct** (req, 10, servicer account #). → **The API UserID is a SHORT (≤10-char) ServiceDispatch ID from the registration/welcome email — NOT the gmail login.** We vaulted `SERVICEPOWER_USER_ID=tnappliancerepair@gmail.com` (27 chars) = almost certainly wrong. **FIX: get the ServiceDispatch User ID + password from the "Welcome to ServicePower / Here is Your Temporary Password" registration emails (guide Figures 1-3) and re-vault.** SvrAcct = TNA00001.

## Status codes (v2.8 §7.4)
- **Main `CallStatus`:** OPEN · ACCEPTED · COMPLETED · REJECTED · RESCHEDULED · CANCELED · CLAIMED. (`SPCallStatusID` = numeric id for these.)
- **Sub-status** (`CallSubStatus` / `SPCallSubStatusID`): "as outlined in §13.4", **mapped per servicer/client** → finer granularity (en route/arrived/parts/etc.). Get §13.4 later, or read live values via getCallInfo.
- **Process flow (§6.2):** poll getCallInfo (jobs OPEN) → updateCallInfo to ACCEPT → updateCallInfo to update status as work progresses → updateCallInfo to mark COMPLETE. (Reject = updateCallInfo REJECTED.)
- **getCallInfo request:** `getCallInfoSearch{ UserInfo{UserID,Password,SvcrAcct}, FromDateTime, ToDateTime, Callno }`; dates `mm/dd/yyyy HH:mm:ss`. **Response CallInfo** fields incl. CallNumber, FSSCallId, WarrantyType, ServiceType, ScheduleDate, ProblemType, ProbelmDesc, **CallStatus**, **SPCallStatusID**, CallSubStatus, SPCallSubStatusID, ConsumerInfo{name/address/phone}, ProductInfo{brand/model/serial}.

## Status / next
- Connector BUILT (dark): `netlify/functions/_lib/servicepower.js` (`getTestService` + `updateCallInfo` + SOAP envelope, UserInfo auth) + `servicepower-test.js` (owner-gated connectivity check).
- **TWO things to go live:** (1) **the `SPCallStatusID` status-code values** from the **Dispatch Web Service Interface v2.8** guide (PDF in the HUB) → map our lifecycle (en route / arrived / in progress / parts ordered / complete) to those IDs; (2) **vault `SERVICEPOWER_*` creds** (UserID, Password, SvcrAcct=TNA00001, ENV). Then `servicepower-test` for connectivity → a `getCallInfo` read to confirm auth → first real `updateCallInfo`.

## Sub-status codes (§13.4) — ACT## codes, sub of a main CallStatus
ACCEPTED main status sub-statuses: ACT01 ACCEPTED · ACT02 APPOINTMENT CONFIRMED · ACT03 APPOINTMENT SCHEDULED · ACT04 AUTHORIZATION OPENED · ACT05 AUTH RECEIVED · ACT06 AUTH REQ SUBMIT · ACT09 COMPLETED PER CUSTOMER · ACT10 CUSTOMER CONTACTED · ACT11 EN ROUTE · ACT13 LEAVING SITE · ACT14 ON SITE · ACT15 ORDER PARTS · ACT16 PARTS ON BACKORDER · ACT17 PARTS ORDERED · ACT18 PARTS RECEIVED · ACT19 PARTS SHIPPED · ACT24 REPLACEMENT PRODUCT ACCEPTED · ACT28 RESCHEDULED. Other mains: ACT30/31/32 RESCHEDULED-* · ACT33 TRIAGE · ACT34 WAITING ON AUTH · ACT35 WAITING ON PARTS · ACT36 WAITING ON CUSTOMER · ACT37 WAITING ON PRODUCT.
NOTE: live data showed SPCallSubStatusID=**1939** (numeric) for an ACCEPTED job — so OUR account's sub-status IDs may be NUMERIC (servicer-specific mapping), while the guide lists generic ACT## codes. "mapped to servicer/client" per §7.4.
THEORY for "Unable to Update": updateCallInfo may REQUIRE a sub-status (SPCallSubStatusID) — accept may need ACT01 (or our numeric equiv). STILL NEED the updateCallInfo REQUEST PARAMETERS table (required-fields) to confirm.

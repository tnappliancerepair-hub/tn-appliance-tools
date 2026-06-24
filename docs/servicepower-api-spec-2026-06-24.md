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

## Status / next
- Connector BUILT (dark): `netlify/functions/_lib/servicepower.js` (`getTestService` + `updateCallInfo` + SOAP envelope, UserInfo auth) + `servicepower-test.js` (owner-gated connectivity check).
- **TWO things to go live:** (1) **the `SPCallStatusID` status-code values** from the **Dispatch Web Service Interface v2.8** guide (PDF in the HUB) → map our lifecycle (en route / arrived / in progress / parts ordered / complete) to those IDs; (2) **vault `SERVICEPOWER_*` creds** (UserID, Password, SvcrAcct=TNA00001, ENV). Then `servicepower-test` for connectivity → a `getCallInfo` read to confirm auth → first real `updateCallInfo`.

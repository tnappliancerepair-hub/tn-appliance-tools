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

## Status / next
- Connector scaffolded (dark): `netlify/functions/_lib/servicepower.js` — UserInfo auth + SOAP envelope + `getTestService`/`getCallInfo`/`updateCallInfo`. The exact `updateCallInfo` field/status-code mapping is TODO pending the **Dispatch Web Service Interface v2.8** guide.
- TO GO LIVE: (1) get the v2.8 guide → fill the updateCallInfo body + status codes; (2) confirm + vault `SERVICEPOWER_*` creds; (3) test `getTestService` against dev (fssstag), then a real call status update.

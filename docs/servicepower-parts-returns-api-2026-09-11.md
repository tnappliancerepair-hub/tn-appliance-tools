# ServicePower API — parts list, return info, and API-native intake
**Measured live 2026-09-11 against real TN dispatches. Everything here is verified, not inferred.**

Teddy's direction: *"We need to utilize the ServicePower API for parts list and parts return
links, auto acceptance of jobs — and as the AHS API gets completed we need that to be capable
of the same."*

## TL;DR

| What he asked for | State |
|---|---|
| Parts list from the API | ✅ **Available + parser shipped.** Verified on live dispatches. |
| Parts **return** info | 🟡 **Partly.** API gives the return REQUIREMENT + tracking + the RMA portal URL. The per-part prepaid LABEL still only comes by email. |
| Auto-acceptance of jobs | ✅ **Already live** (20 accepts / 14 days) — but it does not create the Supabase job. |
| Same for AHS/Frontdoor | ⏳ Receiver built, DARK, and currently points at Xano not Supabase. |

## 1. The footgun that had all three detail ops dead

`getCallAttributes`, `getCallNotes`, `getProductCoverage` were written blind and **every call
faulted**:

```
org.xml.sax.SAXException: Invalid element in com.sp.service.spdservicer.CallAttributesInfo - CallNumber
```

They are real, reachable ops. They just reject `CallNumber`. Per the live WSDL
(`https://fss.servicepower.com/sms/services/SPDService?wsdl`):

| op | request type | accepted children |
|---|---|---|
| `getCallAttributes` | `CallAttributesInfo` | `UserInfo`, **`FSSCallId`** only |
| `getProductCoverage` | `ProductCoverageInfo` | `UserInfo`, **`FSSCallId`** only |
| `getCallNotes` | `CallInfoSearch` | `UserInfo`, `FromDateTime`, `ToDateTime`, **`Callno`**, `Versionno` |

⚠️ **`Callno` / `Versionno` are lowercase-"no".** `CallNumber` is rejected outright.
We already resolve `FSSCallId` from `getCallInfo`, so nothing new was needed to call them.

## 2. Where the parts actually live (NOT where the WSDL suggests)

The WSDL has a rich `PartsInfo` type (16 fields incl. `PartTrackingUrl`) and a `ShippingInfo`
type (incl. `ShipURL`, `ShipType`). **Both are write-side only** — `PartsInfo` appears solely as
element `Parts` inside `UpdateCall`. `CallInfo` declares `ShippingInfo` but came back empty on
every real dispatch tested.

**On the READ side the parts list arrives as text stanzas inside `getCallNotes`:**

```
Allstate part order details

Part Number: WE22X36197
Part Description: USER INTERFACE BOARD
Quantity: 1
If used during repair  requires return: No
Tracking Number: not yet available
```

Then, days later, separate `Allstate part tracking details` notes fill the tracking in.
A third note, `Allstate call created: model & issue details`, carries the issue text and the
return policy (7-day return window, label at `squaretrade.com/rma-request/`).

⚠️ **"If used during repair  requires return" has a DOUBLE space.** Match loosely on whitespace.

`_lib/servicepower.js partsFromNotes()` parses this: dedupes on part number, and lets a later
tracking stanza fill a field the order stanza left blank — never letting an empty value erase a
known one (same merge rule the email watcher needed).

`attributesFromRaw()` parses `getCallAttributes`, which returns the per-dispatch
**"Appointment completion form"** link — the SquareTrade wizard that IS their TDR.

## 3. The finding that justifies the whole thing

On claim **070570184134**, the email-parsed list and the API **disagree**:

| | part numbers |
|---|---|
| in both | WE04X30381, WE04X31007, WE04X31037, WE4M398 |
| email only | WE08X33119, WE4M448 |
| **API only — the email MISSED these** | **WE22X34377 (MAIN BOARD), WE22X36197 (USER INTERFACE BOARD)** |

A main board and a UI board that SquareTrade shipped are **not on the tech's parts tracker.**
SquareTrade's own policy: *"If parts are not returned or returned incorrectly or damaged, you
will not be paid for the repair and may be charged for the new part or core."*

Neither source is complete alone. **The API is the spine to merge onto — not a replacement.**

Also: the email path writes garbage into `job_part.number` —
`"THERMOSTAT HI LIMIT WE04X30381\nPart #WE04X30381"` with `name` NULL. The API keeps
`PartNo` and `PartDesc` separate and clean.

## 4. Return links — the honest split

| piece | source |
|---|---|
| Does this part have to go back? | ✅ API (`requires return` flag) |
| Outbound tracking number | ✅ API |
| Return policy + RMA portal URL | ✅ API (generic `squaretrade.com/rma-request/`) |
| **Per-part prepaid label + RMA number** | ❌ **Email only** (`rma_request@squaretrade.com` → `platform-rma-tee`) |

So the API tells us **what is owed back**; the email still delivers **the label**. That is
already a real win — today a part only becomes "owed back" if its email arrived and parsed.

## 5. API-native intake is fully within reach

`getCallInfo` returns a **complete job** — 19 of 21 fields populated on a live dispatch:
consumer name, address 1, city/state/zip, phone, email, brand, product, model, problem
description, problem type, schedule date, **schedule time period** (`8-10`), call status,
warranty type, install date.

That is everything needed to create a Supabase job with **no email at all**.

`servicepower-auto-accept.js` already accepts OPEN offers every 10 min (20 in 14 days, TN+LA
gated). It just doesn't create the platform job afterward — we still wait on the dispatch email.

## 6. What is NOT built

1. Merging API parts into `job_part` (read path is shipped; nothing writes yet).
2. Creating the Supabase job from `getCallInfo` after auto-accept.
3. Frontdoor/AHS: `frontdoor-webhook.js` is DARK (`FRONTDOOR_WEBHOOK_LIVE` ≠ 1) **and posts to
   Xano's `create_job_from_email`, not Supabase.** Flipping it live feeds Xano, not the platform.

## Verify
```
servicepower-call-detail?secret=<VAPI_ADMIN_SECRET>&call=<dispatch#>[&raw=1]
  -> { api_parts[], links{}, parts[], shipping[], sources{info,attributes,notes,coverage} }
```
Read-only. Never writes.

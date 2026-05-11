# Warranty intake automation vision — 2026-05-11

> Captured during the 2026-05-11 design conversation. Describes the FUTURE-STATE architecture for warranty job intake — the workstream with the highest leverage on replacing Dawn's role per docs/dawn-workflow-spec-2026-05-11.md.

## North Star

One unified intake pipeline. Whether the customer arrives via warranty company (90% of volume) or via self-pay chat (10% of volume), they go through the same Ant chat experience. Customer collects info, video, photos. Teddy reviews via cockpit. Parts pre-ordered. Tech arrives prepared.

## Future-state warranty intake — TWO integration paths

### Path 1 — AHS / Frontdoor email parsing

Most concrete path. Email format is parser-friendly (proven by 2026-05-11 dispatch email inspection — see dawn-workflow-spec-2026-05-11.md for parsed structure).
AHS dispatch email arrives at tnappliancerepair@gmail.com
Subject pattern: "New Dispatch Notification #[7-digit-dispatch-id]"
From: Frontdoor / "WARRANTY COMPANIES/AHS"
↓
Gmail forwarding rule OR IMAP monitor → Xano webhook
↓
Xano endpoint parses HTML email body

Extract: dispatch_id (becomes claim_number), member name(s), phone, email,
address, contract effective date, plan type, item/appliance, brand,
issue/problem, contact preference, vendor notes (incl. "DO NOT COLLECT
TRADE SERVICE FEE" flag)
↓
Create job in Xano (customer_type=warranty, warranty_company=AHS,
claim_number=dispatch_id, all fields populated)
↓
Automated SMS to customer (or email if contact_preference=Email)
"Hi [first_name], TN Appliance Exchange here. AHS sent us your [brand]
[appliance] repair. Tap here to get started: [Ant chat link]. Customers
who use our short chat get scheduled 3 days faster on average."
↓
Customer engages with Ant chat (same experience as self-pay)
↓
Teddy reviews via QC cockpit (Trigger 1 already shipped today fires)
↓
Automated scheduling (Philosophy B, capacity-aware)
↓
Tech dispatched (Tech Ant on-site with full TDR pre-filled)
↓
Job completed, TDR submitted
↓
Danielle updates AHS contractor portal (until portal API integration lands)


### Path 2 — ServicePower API integration

For SquareTrade and any other warranty company that routes through ServicePower.

ServicePower's API has multiple endpoints. Documentation library already exists in repo at docs/servicepower/ (committed 2026-05-07 in commit eaa9063).

- **Have:** Full ServicePower integration guide library at docs/servicepower/. Includes the Retrieve Request for Authorisation endpoint guide (Servicer_Integration_Guide_-_Retrieve_Request_for_Authorization_Web_Service_V2_10.pdf). Useful for parts/labor authorization requests AFTER a job exists.
- **Need to confirm:** Which existing endpoint in the docs/servicepower/ library is the dispatch/intake endpoint (probably "Retrieve Dispatched Calls" or similar — investigation required).
- **Need to confirm:** ServicePower API credentials active or need to be requested. May require coordination with Danielle.

Once dispatch endpoint identified and credentials in hand:

- Poll ServicePower (or webhook subscribe) → fetch new dispatched jobs
- Same downstream flow as Path 1 (create job in Xano → SMS customer → Ant chat → Teddy review → scheduling → tech dispatch)

## What gets eliminated when both paths land

- Meistertask as a scheduling queue (Xano scheduling_queue table replaces it)
- Dawn's Gmail button → Meistertask handoff
- Dawn's Meistertask → HCP copy/paste step
- Dawn's manual customer SMS via HCP
- Dawn's mental "areas/days" template (Philosophy B handles it)
- Dawn's second-trip re-queue (treated as first-class entities, priority-handled)

## What stays human

- Teddy's QC review and parts decisions (judgment work)
- Danielle's warranty portal updates (until APIs land)
- Edge case escalation to owner

## Strategic priority

Higher priority than customer transparency SMS triggers 2-4. This is the platform's center of gravity. Trigger 1 (shipped today, 2026-05-11) still serves the vision — it fires on cockpit load regardless of intake path.

## Open questions

1. **AHS Gmail forwarding rule mechanism.** Can Gmail forward to a webhook URL via filter? Or do we need a separate service (Make.com, Zapier, IMAP polling from Xano)?
2. **ServicePower dispatch endpoint.** Need to identify which existing PDF in docs/servicepower/ documents the dispatch/intake endpoint.
3. **ServicePower API credentials.** Active? Need to request? Who's the contact?
4. **DispatchMe details.** Worth keeping or eliminating entirely?
5. **HCP API for outbound messaging.** Should automated SMS go through HCP API (so Dawn-style conversation continuity for customer) or stay on +16292840444 (separate channel)? Strategic decision deferred.
6. **Contact preference handling.** AHS email contains "Contact Preference: Email" — should we honor by emailing the Ant chat link in addition to SMS?

## Next session workstream

Path 1 (AHS email parsing) is the concrete next workstream. Email structure documented, fields known, downstream flow defined. Path 2 (ServicePower) blocks on info gathering — credential confirmation + dispatch endpoint identification within existing docs/servicepower/ library.

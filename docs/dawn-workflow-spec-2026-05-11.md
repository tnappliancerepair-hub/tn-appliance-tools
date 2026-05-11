# Dawn workflow spec — 2026-05-11

> Captured during the 2026-05-11 design conversation that reframed the Ant platform's scope. Describes Dawn's CURRENT manual workflow as office coordinator at TN Appliance Exchange. Replacing this workflow is the platform's North Star. Dawn is retiring "whenever the system is ready" and is willing to go part-time during the transition.

## Roles

- **Danielle** — Warranty portal coordinator. Handles ServicePower portal submissions (for SquareTrade-routed jobs) and Frontdoor portal interactions (for AHS jobs). NOT same person as Dawn. Ongoing role, not being replaced.
- **Dawn** — Office coordinator. Manual customer scheduling and inbound call handling via HCP messaging on her laptop. Retiring. The Ant platform replaces Dawn's role.

## Current intake pipelines

### Approximately 90% warranty volume — TWO distinct channels

**Channel A: SquareTrade jobs (via ServicePower)**

1. ServicePower platform routes SquareTrade jobs to TN Appliance Exchange
2. Danielle accepts via ServicePower's interface (and via email Accept button)
3. Danielle uses Gmail button to push job to Meistertask "Needs to be Scheduled" column
4. Sometimes auto-pushes to HCP via DispatchMe; sometimes Dawn manually copy/pastes

**Channel B: AHS / Frontdoor jobs (direct email)**

1. Frontdoor sends "New Dispatch Notification #[dispatch_id]" email to tnappliancerepair@gmail.com daily
2. Email is structured HTML with parseable fields (member name, phone, address, appliance, issue, brand, plan type, contact preference)
3. Danielle uses Gmail button to push to Meistertask
4. Same downstream flow as Channel A

### Approximately 5% self-pay (and growing)

Customer visits tnapplianceexchange.net → Ant chat → Stripe → Xano job

### Approximately 5% cash and referral

Phone calls Dawn fields, manual HCP entry

## Systems involved

1. **ServicePower / ServiceDispatch** — third-party platform that distributes warranty work from multiple warranty companies (SquareTrade and others). API documented in docs/servicepower/ (full integration guide library committed 2026-05-07).
2. **AHS / Frontdoor** — sends dispatch notifications via structured HTML email directly to tnappliancerepair@gmail.com. Frontdoor is parent company of AHS. Has a contractor portal accessible via email links.
3. **Email (Gmail: tnappliancerepair@gmail.com)** — landing for AHS dispatches and some ServicePower notifications.
4. **Meistertask** — Kanban work queue between Danielle and Dawn ("Needs to be Scheduled" column is primary).
5. **DispatchMe** — third-party integration that sometimes auto-pushes from Meistertask to HCP. Routing is inconsistent — "some do and some don't."
6. **Housecall Pro (HCP)** — Dawn's primary tool. Job management + customer SMS messaging via HCP on her laptop + tech dispatch.
7. **Gmail button** — Danielle's tool for pushing from email to Meistertask. Exact technical mechanism (extension, Zapier, Make.com, etc.) TBD.

## Sample AHS dispatch email structure (parsed 2026-05-11)

Real email captured during 2026-05-11 design session:

- Subject pattern: "New Dispatch Notification #[7-digit-dispatch-id]"
- From: Frontdoor (categorized "WARRANTY COMPANIES/AHS")
- Structured HTML fields, all cleanly labeled and parser-friendly:
  - Dispatch ID (e.g., 42072309) — becomes claim_number
  - Vendor ID (e.g., 822218)
  - Dispatch Date (MM/DD/YYYY)
  - Dispatch Type (Original / Reschedule / etc.)
  - Member Name (handles co-names like "Robin Jones & Hosea Jones")
  - Contact Preference (Email / Phone / Text)
  - Primary phone number (in 504.235.4591 format, needs normalization)
  - Email
  - Property Address (multi-line: street, city, state, zip)
  - Years With Us (membership tenure indicator)
  - Contract Effective Date
  - Plan Type (e.g., "NATL SHIELDGOLD $100 RN")
  - Item / appliance type (e.g., "Refrigerator")
  - Brand (e.g., "GE Profile")
  - Issue / problem description (free text)
  - Attributes section (brand-specific notes)
  - Vendor Notes (sometimes contains "DO NOT COLLECT TRADE SERVICE FEE", customer text/email opt-in confirmations)
  - Property Notes (coverage exclusions list)
  - Coverage Notes (covered items and additional coverage flags)
  - Fax Notes (recall info, completion date reminders, refrigerant limits)
- Footer includes Frontdoor address and copyright

## Pain points surfaced 2026-05-11

1. **Techs hate the scheduling.** Dawn's scheduling logic is broken from the tech perspective. Whatever replaces Dawn must be BETTER, not just automated.
2. **Mental capacity template.** Dawn references "areas/days" entirely from memory — no real-time view of tech availability, sick days, route optimization, or appointment duration overlap.
3. **Second trips treated same as first trips.** Customers waiting on a return visit get thrown back into the queue with no priority. Customer already failed once; system doesn't know.
4. **Inconsistent auto-routing.** DispatchMe pushes some Meistertask cards to HCP automatically, others require Dawn's manual copy-paste. "Some do and some don't."
5. **Channel mismatch.** Dawn texts customers via HCP's built-in messaging. Our automated SMS triggers (e.g., Trigger 1) fire from +16292840444. Two different sender numbers create customer confusion if both fire on the same job.

## Dawn's broader responsibilities

- Inbound customer calls (scheduling)
- Inbound customer calls (status / parts info)
- General customer service for anything that comes in

## Strategic goal

The Ant platform replaces Dawn entirely. Post-Ant customer experience must be:

- Faster than Dawn's manual scheduling
- More transparent than Dawn's manual outreach
- Better at handling second trips, edge cases, capacity constraints
- Available 24/7 (vs Dawn's business hours)

Humans (Teddy, Danielle) handle only what requires judgment: diagnostic review, parts decisions, warranty portal submissions, real edge cases.

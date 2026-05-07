# Warranty Operations Strategy

**Last updated:** 2026-05-07  
**Owner:** James (Teddy) Pivacek  
**Status:** Living document — update as understanding evolves

---

## Purpose

This document captures TN Appliance Exchange's understanding of how 
warranty company dispatch systems work, what operational rules govern 
our relationships with them, and the strategy for managing dispatch 
volume against tech capacity.

This was previously tribal knowledge living in Dawn's and Danielle's 
heads. As of May 7, 2026, it's documented here.

---

## Warranty Companies We Work With

### 1. Allstate Protection Plans (formerly SquareTrade)

- **Platform:** ServicePower
- **Email sender:** Allstate Protection Plans
- **Subject pattern:** "New Dispatch Notification #<call_number>"
- **Job type:** Pre-diagnosed, parts already shipped to customer, 
  pre-scheduled appointment window
- **Description:** Easy execution — show up at scheduled time, install part
- **Operational note:** "Sought-after" jobs. High margin, low complexity.

### 2. AHS / Frontdoor (American Home Shield)

- **Platform:** Different from ServicePower (separate workflow)
- **Email sender:** Frontdoor
- **Subject pattern:** "Please Schedule Within 24 Hours" + dispatch ID
- **Job type:** Customer-reported failure, requires diagnosis + scheduling
- **Description:** More work — schedule customer, diagnose, possibly 
  order parts, complete repair
- **Backlog note:** As of May 7, 2026, ~141 aged jobs across the 
  warranty portal (see daily Frontdoor digest emails)

### 3. ServicePower (the platform itself)

- **Platform role:** Dispatch and scheduling backend used by Allstate 
  and potentially other warranty companies
- **Portal URL:** https://hub.servicepower.com
- **Daily activity:** Receive status reports, verify accepted jobs

---

## ServicePower Platform Mechanics

### How dispatch works

ServicePower auto-accepts work orders on our behalf based on our 
portal configuration. We do NOT make per-job accept/decline decisions. 
The dispatch happens upstream of our awareness.

The email we receive is a **notification of an already-accepted job**, 
not a request for our acceptance.

### Portal configuration model

The ServicePower portal has 7 sections covering all our service areas. 
Each section is mapped internally to one tech, but ServicePower itself 
has no awareness of individual techs — they only see "TN Appliance 
Exchange" coverage in each area.

Configuration is **per-area-per-day-per-shift**:

Each section (city/area):
Day-of-week (Mon-Sun):
Shift type (All Day 8-17, Morning 8-12, Afternoon 12-17, etc.):
Capacity (number of jobs we'll accept)

Example (Baton Rouge area, John Houk's territory):
- Mon: 0 (currently — but should be open per John's preference)
- Tue: 50 across all shifts
- Wed: 0 (currently — but should be open)
- Thu: 50 across all shifts

### The "max capacity" strategy

Current strategy: set capacity to "50" (effectively unlimited) on every 
day a tech is in that area. Rationale:

1. SquareTrade jobs are sought-after (good economics)
2. Volume is hit-or-miss across areas — only NOLA is consistently busy
3. Capping artificially loses revenue on the rare hot days
4. Most days, volume is well below capacity anyway

### Penalty rules (CRITICAL)

ServicePower's algorithm penalizes us for:

- **Rejecting dispatches:** Counts against future dispatch volume
- **Changing dates of accepted appointments:** Counts against us
- **Failing to show up:** Likely worse penalty (avoid)

These penalties affect dispatch ranking — we get fewer offers over time.

### What we CAN do without penalty

- **Adjust future portal availability:** Update capacity going forward 
  for upcoming days/shifts. ServicePower simply dispatches differently.
- **Mark off holidays:** Block specific dates from receiving dispatches.
- **Schedule customers within the appointment window:** Customer's 
  appointment is set when we accept; we schedule within their window.

### Reservation discipline (internal, not portal feature)

ServicePower has no built-in "reserved slots" feature. Reservation = 
internal discipline by Dawn/Danielle:

- Don't proactively fill all daily capacity with self-pay/AHS work
- Leave room for ServicePower auto-dispatches that arrive throughout 
  the day
- If ServicePower slots aren't filled by mid-afternoon, release for 
  same-day work

---

## ServicePower API Access

### Endpoints (SOAP/WSDL)
Development:
https://fssstag.servicepower.com/sms/services/SPDService?wsdl
Production:
https://fss.servicepower.com/sms/services/SPDService?wsdl

### Available integration guides (PDFs from help portal)

1. Servicer Integration Guide — Retrieve Request
2. Servicer Integration Guide — Create Request
3. Servicer Integration Guide — Claims Retrieval v1.2
4. Servicer Integration Guide — Claims Submission
5. Servicer Integration Guide — Dispatch Web Services

**Status:** PDFs need to be downloaded from ServicePower help portal. 
Source: help article "Servicer API Integrations" by Marianne Crawford 
(April 22, 2025).

### Authentication

**Status as of 2026-05-07:** Unknown. Need to either:
- Confirm credentials already issued to our account (check portal 
  Developer/API section)
- Request new credentials from ServicePower support
- See if credentials are embedded in the integration guide PDFs

### Critical capabilities (likely, per integration guide names)

- Read work orders
- Submit/retrieve claims
- Submit pre-authorizations
- Update dispatch responses (TBD — confirm in PDFs)
- **Update portal capacity** — likely via "Dispatch Web Services" 
  (TBD — this is what we want for dynamic capacity governor)

---

## Architecture Vision: Dynamic Capacity Governor

### Three-layer model
LAYER 1: Skeleton schedule (in Xano)

Each tech's weekly pattern
Per-day cluster assignment
Daily caps per tech
Day-shape rules (start time, late-day caps)
Lives in Ant Tech Scheduler memory + tech_availability

LAYER 2: Real-time load monitor (in Xano)

Pulls dispatches from all sources (SquareTrade, AHS, self-pay)
Per-tech daily job count, real-time
Tracks against skeleton's caps
Visible in dashboard

LAYER 3: Dynamic portal adjuster (Xano → ServicePower SOAP API)

Default: portal at max ("50") capacity per area
When tech approaches their cap, call SOAP API to reduce that
area's capacity to 0 for the rest of the day
Day rolls over → reset to max for next day
No human in the loop for normal operation
Manual override available (Teddy/Danielle)


### Why this works

- Captures sought-after volume when available (Layer 3 default = max)
- Protects techs from cross-cluster chaos (Layer 3 throttles when load hits cap)
- Respects ServicePower's penalty rules (we never reject — we 
  preemptively close capacity)
- Adapts to demand (responds to hot vs. cold weeks)

### Why static caps don't work

- Most weeks, volume is below capacity → caps don't help
- Hot weeks, capping = leaving money on the table
- Hot-week pain is from multiple areas hitting at once, not any single area
- Per-area cap doesn't solve cross-area pile-up across techs

---

## Tech-to-Area Routing (Internal)

ServicePower doesn't know about individual techs. We route internally 
when dispatches arrive. See `docs/tech-operational-profiles.md` for 
each tech's specific territory and preferences.

| Tech | Primary Coverage | Home Base | Day Strategy |
|---|---|---|---|
| Lee Harding | Davidson + Montgomery counties | Clarksville | Full-day commits, no zone mixing |
| Jimmy Pivacek | Sumner+Rutherford+Wilson+Davidson | Antioch | Linear progression toward home |
| Teddy (James) | TN primary, LA monthly trips | Antioch + LA trailer | Location-independent triage + selective field |
| Andre | LA primary, TN secondary | Hammond + TN houseboat | Linear progression, demand-following |
| Billy Savoy | Hammond LA / North Shore | Hammond, LA | TBD (interview pending) |
| John Houk | Walker LA / Baton Rouge | Walker, LA | Linear progression, BR-first |

---

## Operational Rules

### Hard rules

- **Never reject a ServicePower dispatch** (penalty)
- **Never change dates on accepted appointments** (penalty)
- **Williamson County is NOT in Jimmy's territory** despite portal 
  history of dispatches — needs to be removed from his section

### Soft rules

- Verify accepted jobs in portal daily (Danielle's task)
- Hold reserved slots internally for ServicePower auto-dispatches
- If demand exceeds capacity, escalate to Teddy or activate Andre 
  overflow trip (1 week lead time, 30-job minimum)

---

## Personnel Notes

### Danielle (Office Manager)

- Continues role indefinitely
- Knowledge transfer source for warranty operations (provided most 
  of this document's content)
- **No financial access** as of 2026-05-07
- ServicePower portal management (daily verification)

### Dawn (Contractor, Scheduling)

- $1,000/week
- Retiring within weeks
- Currently handles email-to-HCP-job creation, customer scheduling, 
  phone answering
- Knowledge transfer in progress

### Tech Operational Profiles

See `docs/tech-operational-profiles.md` for detailed tech preferences 
captured 2026-05-07.

---

## Build Roadmap

### Phase 1 — Foundation (current)
- Skeleton schedule lives in Ant Tech Scheduler (already built, dormant)
- Activate via tech onboarding conversations with Ant
- Build load monitoring dashboard
- HCP polling cron for real-time job count visibility

### Phase 2 — Email automation (week 2)
- Allstate / SquareTrade email parser → HCP job creation + tech 
  routing + customer SMS
- Frontdoor email parser (different format, more fields)

### Phase 3 — ServicePower API integration (week 3-4)
- Read 5 integration guide PDFs
- Confirm/obtain API credentials
- Build SOAP client smoke test
- Wire dynamic capacity governor (Layer 3)

---

## Lessons Learned

### 2026-05-07: ServicePower mechanics revealed

Discovered that ServicePower:
- Auto-accepts on our behalf based on portal config
- Has no per-tech awareness
- Penalizes rejection and rescheduling
- Has a real SOAP/WSDL API for vendor integration

Previously assumed we manually accepted/declined per email.

### 2026-05-07: "Max capacity" strategy is rational

Initially thought Danielle's "set 50 everywhere" was lazy. Actually 
deliberate volume-maximization in a hit-or-miss market. The chaos 
isn't from bad config — it's from accepting more than we can 
geographically execute on hot days.

### 2026-05-07: Schedule chaos costs more than capacity discipline

Lee at "5 spread-out jobs with 2.5hr drive time" earns less than 
"7 clustered jobs with 1hr drive time." Geographic discipline isn't 
just nice-to-have — it's the highest-margin lever in the business.

### 2026-05-07: Dual-state operation has structural advantages

Teddy + Andre operate as mirror dual-state roles with zero 
accommodation friction (LA trailer + TN houseboat). Combined with 
Teddy's location-independent Quick Check capability, the business 
operates with cross-state flexibility most service businesses can't 
match.

---

## Open Questions

- ServicePower API credentials: where stored / how to obtain?
- Does ServicePower API let us update portal capacity programmatically? 
  (Need to read PDFs to confirm)
- AHS / Frontdoor: do they have a vendor API or only email/portal?
- Other warranty companies on auto-dispatch we haven't mapped?

---

*This document captures the state of understanding as of 2026-05-07. 
Update as new information emerges.*

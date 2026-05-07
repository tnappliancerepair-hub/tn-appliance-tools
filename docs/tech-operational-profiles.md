# Tech Operational Profiles

**Last updated:** 2026-05-07  
**Source:** Direct conversations with Lee, Jimmy, Andre, John  
**Status:** Living document — refine as techs provide more input

---

## Purpose

Captures each technician's operational reality: home base, geographic 
preferences, day-shape rules, dealbreakers, and personal scheduling 
philosophy.

This information was previously undocumented and lived in Dawn's and 
Danielle's heads. As of May 7, 2026, it's captured directly from the 
techs themselves.

This data should eventually be migrated into Ant Tech Scheduler's 
per-tech personal memory. Until then, this doc is the source of truth.

---

## Lee Harding (Tech ID 4)

### Basics
- **Home base:** Clarksville
- **Coverage:** Davidson County (Nashville Metro), Montgomery County 
  (Clarksville), parts of West Nashville corridor

### Day shape
- **Start time:** 9:00 AM
- **Max jobs/day:** 7
- **Late-day rule:** Only 1 job after 3:00 PM

### Geographic strategy
- **Full-day commits in one zone** — does NOT mix zones same day
- "Full Nashville days OR full Clarksville days, no mixing"
- When commuting to Nashville, must be a FULL day (no short Nashville 
  days — not worth the drive otherwise)

### Volume preferences
- Most current work happens in Nashville (he's fine with that)
- Wants 2+ Clarksville days/week eventually (when volume supports)
- Acknowledges Clarksville volume is not yet there

### Special rules
- **Dickson:** Only as last-stop on the way home from West Nashville. 
  Never as a mid-day stop or destination job.

### Dealbreakers
- Hour drives between jobs (THE primary complaint)
- Short Nashville days (3-4 jobs only when commuting from Clarksville)
- Mixed-zone days

---

## Jimmy Pivacek (Tech ID 2)

### Basics
- **Home base:** Antioch (Davidson County)
- **Coverage:** Sumner + Rutherford + Wilson + parts of Davidson 
  (4 counties)
- **Relationship:** Teddy's brother

### Day shape
- **Start time:** TBD (assume 9:00 AM until confirmed)
- **Max jobs/day:** TBD (assume 7 until confirmed)
- **Late-day rule:** TBD

### Geographic strategy
- **Linear progression toward home** — start at FURTHEST point, work 
  back toward Antioch
- "Start in Goodlettsville/Hendersonville (Sumner), work south 
  through the day, end near home"

### Day-type preferences
- **Some days entirely local** — full day in Antioch / Davidson core, 
  no county trips
- **On non-local days, end-of-day jobs within 5-20 min of home**
- "It is nice to have that 5-20 minute drive home after work some days"

### Proposed week shape (DRAFT — needs Jimmy validation)
| Day | Focus | Strategy |
|---|---|---|
| Mon | Sumner County | Start Hendersonville, work south to home |
| Tue | Rutherford County | Start Murfreesboro, work north to home |
| Wed | Davidson core | Local day — Antioch/Hermitage/Donelson |
| Thu | Wilson County | Start Lebanon/Mt. Juliet, work west to home |
| Fri | Flex / overflow / catch-up | Variable |

### Dealbreakers
- **Sumner + Wilson + Williamson same day** (his cited "bad day")
- **Williamson County in his schedule** — not in his stated territory, 
  has been creeping in via portal config and manual overrides

---

## Andre (Tech ID 3)

### Basics
- **Home base(s):** Hammond, LA + TN (houseboat)
- **Coverage:** LA primary (Hammond, NOLA, North Shore, Slidell area) 
  + TN secondary (Antioch-area when needed)
- **Relationship:** Teddy's son
- **Multi-state:** YES — operationally seamless between states

### Living situation (operational asset)
- Trailer in LA (Andre + Teddy can stay)
- Houseboat in TN (Andre's, his to use)
- Can stay with Teddy when in TN
- **Zero accommodation friction** for state-switching

### Primary motivation
- **Maximum income** — wants as much work as possible
- Loves the work itself in both states
- Family business culturally invested

### LA day shape
- Start: 9 AM
- End: 6 PM
- Jobs/day: 6-7
- Strategy: Linear progression — start furthest, work back to Hammond

### TN day shape (when up here)
- Same general shape (9-6, 6-7 jobs)
- Pre-diagnosed warranty work preferred ("easy jobs" similar to NOLA)

### Geographic preferences within LA
- **NOLA preferred** — "easy jobs for the most part"
- Hammond core
- North Shore, Slidell area
- Coverage overlap with Billy (Hammond) — split TBD with Billy interview

### Deployment model
**Demand-following flex resource**, NOT just overflow.

- Default deployment: LA (where established customer base lives)
- TN trips triggered by:
  - TN backlog signals (capacity exceeded for 1+ weeks)
  - Strategic decisions (peak season, planned campaigns)
  - Combined Teddy+Andre travel (father-son work trips)
- Lead time: 1 week notice for trip planning
- Minimum viable trip: 6 jobs/day for ~5 days = 30 jobs

### Why this works
- Zero hotel cost (housing handled both ends)
- Both states are "home" — no fatigue penalty
- Maximum-income motivation aligns with deploying him to volume
- Father-son travel arrangement makes business trips relationship-positive

### Long-term planning signal
Andre's residence is **deliberately undecided**. He's not seeking a 
permanent home — he's optimizing for income across both states. This 
gives flexibility to scale either side without forcing relocation.

---

## John Houk (Tech ID 6)

### Basics
- **Home base:** Walker, LA
- **Primary territory:** Baton Rouge (30-45 min from home)
- **Secondary territory:** NOLA-area (with strong preferences)
- **Relationship:** Teddy's cousin

### Day shape
- **Leaves home:** 7:30 AM
- **Home by:** 3:30 PM (8-hour working window)
- **Max jobs/day:** 6

### Drive distances (from Walker home)
- Baton Rouge: 30-45 min ← primary, preferred
- Slidell (North Shore): 1+ hours ← acceptable fallback
- Metairie (South Shore): ~45 min ← prefer to avoid
- East NOLA: ~1.5 hours ← prefer to avoid

### Geographic strategy
- **Linear progression** — start furthest from home, work back to Walker

### Preference hierarchy (when given a choice)
1. **Baton Rouge** (always first preference, as much as possible)
2. **North Shore** (Slidell, Mandeville, Covington) — when no BR work
3. **South Shore** (Metairie, NOLA proper) — last resort only

### Operational principle
- "Doesn't want to be far away fighting traffic to get home"
- "BR as much as possible, NOLA as little as possible"

### Portal config note (as of 2026-05-07)
- Currently set to: BR Tue/Thu at 50 capacity, 0 other weekdays
- **Should be:** BR every weekday at high capacity, NOLA areas at 
  low capacity (fallback only)
- **Action item:** update portal during Phase 3 rollout (or sooner)

---

## Teddy (James) Pivacek (Tech ID 1)

### Basics
- **Home base:** Antioch (Davidson County, TN)
- **Secondary base:** LA trailer (used during regular trips)
- **Coverage:** TN primary, LA during scheduled trips
- **Mobility:** Cybertruck-equipped — can perform triage anywhere 
  with cell signal
- **Relationship to others:** Owner. Brother to Jimmy. Father to 
  Andre + Alec. Cousin to John.

### Role classification
**Dual-state, location-independent owner-operator.**

### Primary functions (always-on)
- **Quick Check** — review customer-submitted diagnosis videos, 
  approve/triage. Performable from ANYWHERE with cell signal 
  (Cybertruck mid-drive, LA trailer, anywhere).
- **Routing decisions** — dispatch override calls, escalations
- **System monitoring** — post-automation rollout
- **Customer escalation** — high-touch / owner-discretion accounts

### Field work
- TN: Light field work as needed for owner-discretion jobs
- LA: Field assistance during scheduled trips with Andre

### Travel pattern (regular)
- **LA trips:** Monthly to every 6 weeks
- **Purpose:** LA-side field assistance + business tasks
- **Synchronizes** with Andre when operationally beneficial
- **Accommodation:** LA trailer (no hotel cost)
- **Triage continues during travel** — Quick Checks happen from the 
  truck, the trailer, anywhere

### Day shape preferences
- **TBD** — needs reflection by Teddy

### Critical operational asset
**Quick Check is location-independent.** Unlike most service business 
owner-operators, Teddy's triage capability doesn't degrade with travel 
or geographic distance. This means:

- LA trips don't pause TN triage
- Field-day mornings don't block customer Quick Check reviews
- Systems can assume always-available remote owner without expecting 
  desk time
- Customer-facing SLAs for diagnosis review are decoupled from 
  Teddy's physical location

This is structurally different from a traditional owner-operator who 
must be "at the office" to triage. The system architecture should 
honor this — Quick Check workflows assume mobile-first owner.

---

## Billy Savoy (Tech ID 5)

### Status
**NOT YET INTERVIEWED** — was unavailable when called 2026-05-07 PM.

### Coverage (per memory, unconfirmed)
- Hammond, LA / North Shore

### Outstanding questions when reached
- How does he split Hammond coverage with Andre?
- Where does his North Shore work overlap with John's?
- Day shape (start time, max jobs, end time)
- Geographic strategy (linear like Andre/John, or different?)
- Any specific preferences/dealbreakers
- Volume reality (under or over-utilized?)

### Action
Re-attempt interview at next available opportunity.

---

## Universal Patterns Observed (5 techs)

Across the techs interviewed, common principles emerge:

1. **Early start preferred** — 7:30 to 9:00 AM range
2. **6-7 jobs/day cap** — universal sustainable limit
3. **Linear progression toward home** is the dominant strategy 
   (Jimmy, Andre, John use this; Lee uses single-zone commits instead)
4. **End-of-day proximity to home** is a universal concern
5. **Hour drives between jobs** is the universal complaint
6. **Drive time isn't paid** — techs absorb the cost; they're acutely 
   aware
7. **Direction of day matters** — none of the techs want to drive 
   away from home in the afternoon

These are foundation rules. Tech-specific variations apply on top.

### Strategy split

| Strategy | Who uses it |
|---|---|
| Linear progression (start far, work back) | Jimmy, Andre, John |
| Single-zone commits (full day in one area) | Lee |

---

## Cross-State Operational Architecture

### Mobility advantage
Teddy and Andre operate as **mirror dual-state** roles:
- Teddy: TN home, LA trips monthly+
- Andre: LA home, TN trips when demand justifies
- Combined coverage flexibility across both states with no hotel costs
- Quick Check (Teddy's primary triage role) is location-independent

This is a structural operational advantage most service businesses 
don't have.

### Family operator distribution
**Family operators (4 of 6 techs):**
- Teddy (owner)
- Jimmy (Teddy's brother)
- Andre (Teddy's son)
- John (Teddy's cousin)

**Senior employees (2 of 6 techs):**
- Lee Harding (TN)
- Billy Savoy (LA)

This affects deployment patterns:
- Family operators handle high-stakes, multi-state, customer-facing 
  escalation work
- Senior employees provide stable, predictable schedule coverage
- System routing logic should honor this distinction

---

## Routing Implications

ServicePower has no per-tech awareness — all routing happens 
internally on our side. Once the skeleton schedule is built, routing 
logic becomes:

1. Dispatch arrives for zip XYZ
2. Lookup: which cluster does that zip belong to?
3. Lookup: which tech is assigned to that cluster on this day?
4. Honor the tech's preferences (linear vs. cluster style)
5. Route to that tech in HCP, notify via SMS

For John specifically: BR dispatches always go to him, NOLA-area 
dispatches go to him only as fallback (Andre or Billy preferred for 
NOLA-area work).

---

## Migration Plan

When Ant Tech Scheduler is activated:

1. Each tech receives an SMS introducing the system
2. Ant initiates onboarding conversation with each tech
3. **Pre-loaded with their profile from this document** so the 
   conversation is "confirm and refine" not "start from scratch"
4. Tech reviews and adjusts in conversation with Ant
5. Profile updates flow into Ant's memory + tech_availability table
6. This document becomes a historical reference, not the live source

---

## Open Items

- [ ] Jimmy's day shape numbers (start time, max jobs, late-day cap)
- [ ] Teddy's day shape preferences (when not traveling)
- [ ] Validate Jimmy's draft week shape with Jimmy directly
- [ ] Validate Lee's profile with Lee
- [ ] **Interview Billy Savoy** (unavailable 2026-05-07)
- [ ] John's Mon/Wed/Fri activity confirmation
- [ ] John's furthest-first-job tolerance
- [ ] How Andre and Billy split Hammond coverage (need Billy)
- [ ] How Billy and John split North Shore coverage (need Billy)

---

*Captured 2026-05-07 during phone/text interviews with Lee Harding, 
Jimmy Pivacek, Andre, and John Houk; plus Teddy's own role 
articulation. Billy Savoy interview pending. Update as profiles 
are validated and refined.*

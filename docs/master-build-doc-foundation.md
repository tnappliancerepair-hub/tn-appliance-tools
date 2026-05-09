> Foundational vision and platform architecture document for TN Appliance Exchange / Ant Platform. Originating context predating the system-blueprint-v1.md (which is the running architecture + status). Contains the founding manifesto, Anthony origin story, pricing philosophy, long-term licensable platform vision, customer journey design, and working style notes. Recovered from local files on 2026-05-09 evening — should be treated as the canonical 'why' document that every future session reads first.
>
> Companion to:
> - docs/system-blueprint-v1.md (architecture + running status)
> - docs/system-blueprint-decisions-2026-05-09.md (locked decisions)
> - docs/handoff-2026-05-04-phase-0-8-completion.md (Tech Scheduler build handoff if committed)
> - docs/tech-scheduler-vs-assist-discovery-2026-05-09.md (Tech Scheduler vs Tech Assist discovery)
> - docs/unified-tech-tool-architecture-hypothesis-2026-05-09.md (Option B hypothesis, NOT for execution)
> - docs/week-1-execution-plan.md (placeholder)

---

# TN Appliance Exchange — Master Build Document

**Compiled:** April 28-29, 2026 (overnight session)
**Owner:** James "Teddy" Pivacek
**Status:** Foundation shipped, vision locked, marketplace v1 designed

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [The Manifesto](#2-the-manifesto)
3. [Architecture: Three Ants](#3-architecture-three-ants)
4. [Operating Philosophy](#4-operating-philosophy)
5. [What Shipped This Session](#5-what-shipped-this-session)
6. [Customer Ant — Scheduling Prompt](#6-customer-ant--scheduling-prompt)
7. [Ant Tech Scheduler — Full System Prompt](#7-ant-tech-scheduler--full-system-prompt)
8. [Operations Flow Map](#8-operations-flow-map)
9. [Build Queue (Priority Order)](#9-build-queue-priority-order)
10. [Required Xano Endpoints](#10-required-xano-endpoints)
11. [Schema Reference](#11-schema-reference)
12. [Dev Meeting Playbook](#12-dev-meeting-playbook)
13. [Reference Data](#13-reference-data)
14. [Open Questions / Future Work](#14-open-questions--future-work)

---

# 1. Executive Summary

TN Appliance Exchange is building the first **AI-orchestrated two-sided marketplace for local service work**. Customers state real preferences. Techs set real hours. AI matches them.

The platform replaces the rigid 3-hour-window dispatch model that has dominated field service since the 1980s with **honest pacing, mutual respect, and tech agency**.

**Core differentiation:**
- 2-5 day delivery vs 10+ day industry average
- Pre-diagnosis before tech dispatch (right part, right truck, first visit)
- Tech-set hours via SMS-based AI scheduler
- Job broadcasts to cluster techs for flexible customers (marketplace dynamics)
- Mutual respect rules: trip fees for customer no-shows, automatic late SMS for techs

**Three product surfaces:**
- **Self-pay direct** ($50 Quick Check, $90 Premium, $100 In-Home) — primary growth lane
- **Warranty bridge** (95% of current volume, handled by external dev team's HCP+MeisterTask scheduler)
- **Future licensing** — platform applies to any local service vertical

---

# 2. The Manifesto

> *"Match people who need help with people who have the know-how to help them, efficiently for everyone.*
>
> *Customers state real preferences. Techs set real hours. AI does the matching.*
>
> *Old guys want early shifts? Let them. Some want to work all the time? Let them.*
>
> *Not all jobs are good jobs — techs aren't forced to take what doesn't work.*
>
> *Old rules were made before today's tools. Times change, we evolve.*
>
> *Faster, more affordable, better. Automate to elevate, not cut."*

---

# 3. Architecture: Three Ants

The platform has three AI agents, each with a distinct role:

## Ant Inbound (existing, live)
- **Role:** Customer-facing voice + chat agent
- **Channels:** Web chat, +16292607111 voice (Vapi)
- **Voice:** Heisenberg (11labs)
- **Brain:** Claude Sonnet via `chat/reply2` endpoint #94
- **Job:** Collects problem, model number, photos, video, customer schedule preference
- **Key behavior:** Educates customers that "flexible = faster"

## Tech Ant (existing, live)
- **Role:** Field technician TDR collection
- **Surface:** `tech-ant.html?job_id=X&tech_id=Y`
- **Job:** Walks tech through Technician Decision Report (symptom, failed component, parts used, etc.)
- **Notifies:** Danielle SMS + HCP notes on submission

## Ant Tech Scheduler (NEW, to build)
- **Role:** Tech-facing schedule manager + job broadcaster
- **Channel:** SMS-only (dedicated Twilio number)
- **Brain:** Claude Sonnet via Xano endpoint
- **Identifies tech by:** phone number match in `technicians.phone`
- **Job:** Inbound schedule changes + outbound broadcast offers
- **Key innovation:** Marketplace dynamics — first qualified tech to respond wins flexible jobs

---

# 4. Operating Philosophy

## Customer Model — Two Tier

### Must-Time Customers (rigid)
- Customer specifies a real time constraint
- Examples: "Has to be Friday 10-11:30," "After 9am only," "Tuesday morning before noon"
- **Booked first**, lock the slot "within reason"
- Form the geographic backbone of each tech's day

### Open-Schedule Customers (flexible)
- Customer is flexible: "Anytime," "I work from home," "Whenever you can come"
- **Filled in around must-times** for route optimization
- Eligible for ASAP broadcast model
- Get faster service because they're route-optimized
- Self-select via Customer Ant intake messaging

## "Within Reason" Rule

Must-time bookings are honored unless they would force unreasonable routing:
1. **Travel feasibility** — can tech physically get there from previous stop?
2. **Daily capacity** — does adding this break 6-7 jobs/day?
3. **End-of-day rule** — would this force a long drive after 4pm?

If any fails → AI offers nearby alternatives with explanation, doesn't force booking.

## After-4 Cross-Cluster Decline

After 4pm local, AI declines bookings that require a tech to drive across the cluster.
- **Why:** No rush-hour ping-pong, techs go home
- **Customer messaging:** Honest explanation + alternatives
- **Tech messaging:** AI never asks them to fight traffic home

## Capacity Math

Each tech's daily cap = **7 weighted units**:
- Standard job = 1 unit
- Long job (sealed system, compressor swap, multi-appliance) = 2 units
- All-day job (full install) = 7 units (eats whole day)

**Per-window math:**
- 2 standard jobs allowed per 3-hour window
- 1 long job per window (consumes both slots)
- All-day blocks the whole day

## The Honest Timeline

**Reality of the operation:**
- Pre-diagnosis: hours (Teddy reviews video)
- Parts ordering: 1-2 days (Marcone)
- Scheduling: 1-3 days
- **Total: 2-5 days** (vs 10+ day industry average)

**Don't promise same-day. Don't promise tomorrow.**
**Promise honest, faster-than-competitors.**

## Mutual Respect Rules

**Customer to tech:**
- Be home when you said you'd be home
- No-show = trip fee (waiver established)
- Customer commits explicitly during intake

**Tech to customer:**
- On-time arrival
- 30-min-out SMS automatic
- Running-late SMS BEFORE original ETA, not after
- Geographic clustering = no ping-pong driving

**Platform enforces:**
- Auto-comms for both sides
- Trip fee logic for no-shows
- Late detection via HCP work_status
- AI Ant nudges tech if updates missed

## Tech Agency

- **Techs set their own hours** via Ant Tech Scheduler (SMS)
- **AI consults tech via SMS** for tight bookings (not just dictate)
- **Techs choose broadcast jobs** they want to take
- **Schedule lock rules are conversational** (Ant explains impact, escalates to office, doesn't refuse)
- **Extending hours always allowed** (more capacity = good)

---

# 5. What Shipped This Session

## HCP Webhook — Fully Synced
**Endpoint:** `hcp_job_webhook` (POST, intake group)

- ✅ CREATE branch: HCP-origin jobs auto-create in Xano with full payload
- ✅ UPDATE branch: HCP wins on technician_id reassignment (Option A)
- ✅ Customer.* events handled gracefully (no more 500 errors)
- ✅ Customer matching by phone (no duplicates)
- ✅ `service_eta_window` populated for slot detection
- ✅ Customer auto-creation when phone doesn't match
- ✅ Appliance type derived from HCP tags
- ✅ Comprehensive event_log audit trail

**Test results:**
- Customer.created → "Customer event ignored" ✅
- New job CREATE → jobs row 200 created with technician_id=2 (Jimmy) ✅
- UPDATE rescheduling → technician_id flipped to 4 (Lee) ✅
- service_eta_window populated as "2-5" on UTC 15:00 booking ✅

## Slot Endpoint v1
**Endpoint:** `get_available_slots` (GET, intake group)

- ✅ Multi-tech availability (loops all active cluster techs)
- ✅ Reads `tech_availability` as master schedule (per-tech, per-date)
- ✅ Capacity rule enforced (7 weighted units max/day)
- ✅ Mon-Fri only (Saturday + Sunday off)
- ✅ Window-fits-tech-hours check
- ⚠️ **Needs Philosophy B rewrite** — currently uses zone-configured fixed windows

## Tech Schedule Bootstrap
**Endpoint:** `bootstrap_tech_schedule` (POST, scheduling group, one-time)

- ✅ 384 rows created (6 techs × ~64 weekdays × 90 days)
- ✅ Default: Mon-Fri 8am-4pm
- ✅ Idempotent (safe to re-run)
- ✅ Skips weekends
- ✅ `tech_availability` is the master schedule source

## Schema Additions

**`jobs` table — new fields:**
- `hcp_assigned_to` (text) — HCP's pro_id (for Option A reassignment tracking)
- `pre_diagnosis_complete` (bool, default false) — gates dispatch
- `job_time` (text, default "standard") — capacity weighting (standard/long/all_day)

**`technicians` table — confirmed populated:**
- `hcp_id` column matches all 6 techs to their pro_ids

## Vision Locked in Memory

Per memory edit #7 (manifesto), #3 (Three Ants vision), #30 (scheduling philosophy).

---

# 6. Customer Ant — Scheduling Prompt

This addition layers onto the existing Ant chat brain (`chat/reply2` endpoint #94).

```
SCHEDULING PHILOSOPHY (when collecting customer availability):

Don't ask for a 3-hour window. Ask how flexible they are. Frame:

"What's your schedule looking like? Here's how we work, and why we're 
typically way faster than other repair shops:

Step 1 - You finish sending me the model number, a photo, and a quick 
video of the problem.

Step 2 - Our senior tech Teddy reviews it and pre-diagnoses the issue. 
Usually within a few hours.

Step 3 - We identify the exact part you'll need and order it. Parts 
usually arrive in 1-2 days.

Step 4 - Once parts are ready, I check which techs are working in your 
area and find someone to grab the job. The more flexible your schedule, 
the faster I can place you.

Total time, start to finish, is usually 2-5 days. Most other shops in 
town are booked 10+ days out. We're faster because we pre-diagnose 
before sending a tech, so they show up with the right part the first time."

Capture from their response:
1. customer_preference_text: their actual words ("anytime this week", 
   "Tuesday morning only", "after 9am Friday before 2pm")
2. scheduling_type: classify as one of:
   - "open_schedule" — flexible, anytime — eligible for ASAP broadcast
   - "must_time" — specific constraint
   - "emergency" — urgent (water leak, food spoiling)

NEVER offer 3-hour windows like "8-11" or "11-2".
NEVER promise same-day.
NEVER commit a time before pre-diagnosis + parts confirmed.

GATING RULE — Pre-diagnosis required before broadcast:
You CANNOT offer broadcast/ASAP service until ALL of these are true:
- Model number captured
- Photo of appliance + photo of model tag uploaded
- Video of the problem uploaded
- Customer payment received (Quick Check $50, Premium $90, etc.)
- Teddy has completed pre-diagnosis (job has pre_diagnosis_complete = true)
- Part is identified and known to be available

If customer pushes for faster:
"I hear you. Most jobs are done in 2-5 days, already 2x faster than 
average. Pre-diagnosis a few hours, parts 1-2 days, then we schedule 
you. Be flexible with your time so we can fit you in whenever a tech 
is in your area."

If pre-diagnosis is complete AND customer is flexible:
"OK — Teddy diagnosed it as [issue], part [part_number] is in stock. 
Going to ping our techs in your area now. Whoever can get there fastest 
will reach back to me, and I'll text you with a real ETA usually within 
an hour. If no tech can grab it sooner, no worries — I'll lock you into 
our next available slot. Either way you'll get a real time."

If customer has a must-time constraint:
"Got it — let me check what techs are available [their constraint]. 
One sec."
[call get_available_slots with their preference]

If customer is emergency:
"That sucks, sorry you're dealing with that. Let me flag this as urgent — 
Teddy is going to text you directly to figure out the fastest path. 
Expect a text in the next 5-10 minutes."
[escalate to owner SMS]

NEVER COMMIT TO A TIME without confirming:
- Pre-diagnosis is done
- Tech accepted (for broadcasts) OR slot is locked (for must-times)

Always say "I'll get back to you with a real ETA" if waiting on broadcast 
response.
```

---

# 7. Ant Tech Scheduler — Full System Prompt

```
You are Ant Tech Scheduler, a friendly SMS assistant for TN Appliance 
Exchange technicians. You're talking exclusively to techs, never customers.

PERSONALITY:
- Casual, direct, no corporate speak. Sound like the smart dispatcher 
  who's worked the field.
- Use tech language ("got it", "you're set", "no worries", "lemme check")
- Brief texts. Techs are in trucks. Don't make them scroll.
- One question at a time when you need info.
- Never moralize or lecture. Flag things to office, don't refuse.
- Get to the point. Respect their time.

YOUR JOBS:
1. Schedule changes (block days, change hours, take time off)
2. Broadcast job offers (present open jobs, capture response)
3. Schedule lookups ("how many jobs Friday")
4. Emergency escalations (sick, family emergency, vehicle)
5. Job details (address, customer info)

CRITICAL RULE — TECH IDENTIFICATION:
At start of every conversation, identify tech via lookup_tech_by_phone. 
If number doesn't match active tech: "Sorry, I can only help registered 
TN Appliance technicians. If you're a tech, text from your registered 
number. If this is a mistake, text Teddy at 615-485-5795."

CRITICAL RULE — NEVER COMMIT WITHOUT CONFIRMING:
You CAN update tech_availability directly. But for emergency escalations 
or close-date changes, MUST tell tech you're escalating to office before 
confirming.

==========================
SCHEDULE CHANGES
==========================
Tools: get_tech_schedule, update_tech_hours, mark_tech_off, 
count_bookings_for_tech_date, escalate_to_office

LOCK RULES (soft, conversational):
- More than 3 days out: just confirm and update.
- Within 3 days, no bookings: confirm and update casually.
- Within 3 days, customers booked: do NOT auto-update. Tell tech you're 
  flagging Teddy + Danielle. Use escalate_to_office. Frame as heads-up, 
  not refusal.
- Tech can ALWAYS extend hours (more capacity = good). No lock.

Examples:
Tech: "Take next Tuesday off"
You: "Done — you're off Tuesday. Catch you Wednesday."

Tech: "Make me 6am-2pm next week"
You: "Got it — Mon-Fri 6am-2pm next week. Anything else?"

Tech: "Off this Friday" (2 days out, 3 jobs booked)
You: "Friday's pretty close — 3 customers on the books. Pinging Teddy 
and Danielle to figure out coverage. What's going on, you ok?"
[escalate to office]

==========================
BROADCAST JOB OFFERS
==========================
Format:
"🐜 Open job — interested?
[appliance] [problem]
Pre-diagnosed: [diagnosis] / Part: [part_number]
Zip: [zip] ([area name])
Customer: flexible, pre-diagnosis done, parts ready
[tier — Quick Check $50 / Premium $90 / Warranty]

Reply with when you can go, or 'pass'."

Responses you handle:
- Specific time → accept_broadcast_job → if accepted: "You got it. 
  Sending you the address now." → send_job_details
- "pass" → decline_broadcast_job → "No worries, I'll find someone else."
- "more info" → get_job_summary → send full info
- No response 10 min → system tries next tech (you don't act)
- Already accepted by another → "Just got snapped up by another tech. 
  Catch you on the next one."

==========================
SCHEDULE LOOKUPS
==========================
Tech: "How many jobs Friday?"
You: [get_tech_schedule] 
"Friday you've got 4: 9am Bellevue (fridge), 11am Nashville (dryer), 
1pm Antioch (dishwasher), 2:30pm Mt Juliet (washer). Want details on any?"

==========================
EMERGENCIES
==========================
On "I'm sick" / "family emergency" / "broke down":
1. Empathy: "Take care of yourself — we got this."
2. escalate_to_office with emergency=true
3. Confirm: "Just texted Teddy and Danielle. They'll handle re-routing 
   and customer comms. Don't worry about anything except getting better."
4. DO NOT update schedule yourself. Office handles it.

==========================
RULES YOU NEVER BREAK:
- Never reveal customer info to a different tech
- Never confirm schedule changes within 3 days without escalation
- Never refuse extending hours
- Never moralize, lecture, or guilt-trip
- Never share other techs' schedules unless Teddy asks
- Critical distress (suicide, severe distress) → escalate priority=critical
  → "Hey, sounds like a hard moment. Teddy is on the way to call you. 
  You matter. Hold tight."

==========================
TONE EXAMPLES:

GOOD: "Got it — you're set. Catch you Wednesday."
BAD: "Your schedule has been successfully updated. Please confirm receipt."

GOOD: "That sucks, sorry. Pinging Teddy now."
BAD: "I have noted your absence and will alert management."

GOOD: "Friday's pretty tight, lemme flag it."
BAD: "Per company policy, schedule changes within 72 hours require 
manager approval."

You're not a corporate tool. You're the smart dispatcher friend who 
happens to be available 24/7.
```

---

# 8. Operations Flow Map

```
┌─────────────────────────────────────────────────────────────┐
│                    CUSTOMER INTAKE                           │
│                                                              │
│  Customer reaches out (web chat / inbound call / SMS)        │
│         │                                                    │
│         ▼                                                    │
│  Ant Inbound (Customer Ant)                                  │
│  - Asks problem                                              │
│  - Collects model number, photos, video                      │
│  - Asks "how flexible is your schedule?"                     │
│  - Captures customer_preference_text                         │
│  - Classifies: open_schedule / must_time / emergency         │
│         │                                                    │
│         ▼                                                    │
│  Job created in Xano (jobs table)                            │
│  - scheduling_type set                                       │
│  - customer_preference_text saved                            │
│  - dispatch_status = "awaiting_dispatch"                     │
│  - pre_diagnosis_complete = false                            │
│  - Stripe payment SMS fires (paid tiers)                     │
│                                                              │
└────────┬─────────────────────────────────────────────────────┘
         │
         │ (waits for payment + Teddy pre-diagnosis)
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                  TEDDY PRE-DIAGNOSIS                         │
│                                                              │
│  Teddy reviews via Teddy Tool                                │
│  - Watches video                                             │
│  - Identifies failed component                               │
│  - Identifies verified part number                           │
│  - Marks pre_diagnosis_complete = true                       │
│  - Triggers parts ordering (parts_status updates)            │
│                                                              │
└────────┬─────────────────────────────────────────────────────┘
         │
         │ (waits for parts to arrive — usually 1-2 days)
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                  DISPATCH DECISION                           │
│                                                              │
│  When ALL gates pass:                                        │
│  - pre_diagnosis_complete = true                             │
│  - parts_status = "ready"                                    │
│  - payment received (paid tiers)                             │
│  - dispatch_status = "awaiting_dispatch"                     │
│                                                              │
│  IF scheduling_type = "must_time":                           │
│    → call get_available_slots filtered by their constraint   │
│    → if tech available within reason → book directly         │
│    → if tight → AI consults tech via Ant Tech Scheduler      │
│                                                              │
│  IF scheduling_type = "open_schedule":                       │
│    → broadcast to cluster techs via Ant Tech Scheduler       │
│    → first qualified tech to accept wins                     │
│                                                              │
│  IF scheduling_type = "emergency":                           │
│    → SMS to Teddy directly                                   │
│    → Teddy decides override / direct dispatch                │
│                                                              │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              ANT TECH SCHEDULER (SMS)                        │
│                                                              │
│  OUTBOUND BROADCAST:                                         │
│  "🐜 Open job — interested?                                  │
│   [appliance] [problem]                                      │
│   Pre-diagnosed: [diagnosis] / Part: [part]                  │
│   Zip: [zip] ([area])                                        │
│   Customer: flexible, parts ready                            │
│   Reply with when you can go, or 'pass'."                    │
│                                                              │
│  Tech replies:                                               │
│  - Specific time → accept_broadcast_job → confirm + send addr│
│  - "pass" → decline → next tech tried                        │
│  - "more info" → send full job details                       │
│  - No response 10min → system tries next tech                │
│                                                              │
│  INBOUND from techs:                                         │
│  - Schedule changes (block days, change hours)               │
│  - Lookups ("how many jobs Friday")                          │
│  - Emergencies (sick, vehicle, family)                       │
│  - Job details requests                                      │
│                                                              │
└────────┬─────────────────────────────────────────────────────┘
         │
         │ (tech accepts, AI books)
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                       BOOKING LOCK                           │
│                                                              │
│  - Xano writes: scheduled_start, technician_id, status       │
│  - HCP API call: create/update job in HCP                    │
│  - HCP webhook fires back → Xano confirms via hcp_job_webhook│
│  - Customer SMS: "Lee accepted — will be there ~11am"        │
│  - Schedule 30-min-out SMS to customer                       │
│  - Schedule reminder SMS to tech                             │
│                                                              │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXECUTION + WRAP                           │
│                                                              │
│  Day-of:                                                     │
│  - 30 min before: customer SMS "Lee on the way"              │
│  - If tech late detected: SMS to customer BEFORE original    │
│    ETA with new time                                         │
│  - Tech arrives → marks "in progress" in HCP                 │
│  - Tech does work → completes Tech Ant TDR                   │
│  - HCP marks job completed → webhook fires                   │
│                                                              │
│  Post-job:                                                   │
│  - 2hr after completion: feedback SMS to customer            │
│  - Reply 5 → review link sent                                │
│  - Reply 0 → owner alert + apology SMS                       │
│  - Negative followup forwarded to Teddy                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

# 9. Build Queue (Priority Order)

## Priority 1 — Customer Ant Update (30 min)
**Why first:** Marketing impact immediately, no infrastructure dependencies.

Update `chat/reply2` endpoint #94 system prompt with the scheduling philosophy from Section 6.

Test by chatting with Ant on the website and confirming:
- ✓ Doesn't offer 3-hour windows
- ✓ Explains 4-step workflow
- ✓ Captures preference in own words
- ✓ Classifies as open_schedule / must_time / emergency

## Priority 2 — Add jobs Table Fields (15 min)
Run via Xano agent:

```
Add to jobs table:
- scheduling_type (text): values "must_time" / "open_schedule" / "emergency"
- customer_preference_text (text): customer's actual words
- estimated_duration_minutes (int, default 60)
- dispatch_status (text): values "awaiting_dispatch" / "broadcasting" / 
  "accepted" / "confirmed"
- broadcast_sent_at (timestamp)
- accepted_by_tech_id (int)
- accepted_at (timestamp)
```

## Priority 3 — Build Ant Tech Scheduler (3-4 hours)
**The marketplace centerpiece.**

**Architecture:**
- Twilio inbound SMS webhook → Xano endpoint
- Claude Sonnet brain with tool calls
- Dedicated phone number (~$2/mo from Twilio)
- SMS-only in v1 (no voice)

**System prompt:** Section 7 above.

**Build sequence:**
1. Provision dedicated Twilio number for techs
2. Build the 11 Xano endpoints (Section 10)
3. Wire Twilio webhook → Xano endpoint
4. Test conversational flows with Teddy's number
5. Onboard techs with welcome SMS

## Priority 4 — Slot Endpoint v2: Philosophy B (3 hours)
**Replace fixed-window logic with dynamic generation.**

Rewrite `get_available_slots`:
- Input: zip, customer preference text, date range, duration estimate, scheduling_type
- Output: ranked list of specific time options ("Lee Tuesday around 10am") — NO fixed windows
- Logic:
  - Read each tech's hours from tech_availability
  - Find gaps that fit duration + travel buffer
  - Apply geographic clustering (don't ping-pong)
  - Apply after-4 cross-cluster decline rule
  - Return ranked options

## Priority 5 — Booking Endpoint v2 (2 hours)
Build `book_appointment_v2`:
- Validates against current bookings
- Must-time tight booking → triggers AI consultation via Ant Tech Scheduler
- Open-schedule → fires broadcast model
- Writes to Xano + HCP via API
- Customer confirmation SMS

## Priority 6 — Mutual Respect Comms (3 hours)
- 30-min-out SMS cron (queries upcoming bookings)
- Late-tech detection (compare HCP work_status to scheduled_start)
- Auto-SMS BEFORE original ETA when tech late
- No-show flow with trip fee SMS
- Updated customer confirmation language with mutual respect framing

---

# 10. Required Xano Endpoints

For Ant Tech Scheduler to function:

| # | Tool Name | Purpose | Inputs | Returns |
|---|-----------|---------|--------|---------|
| 1 | `lookup_tech_by_phone` | Identify tech from inbound SMS | phone (text) | tech_id, name, active status |
| 2 | `get_tech_schedule` | Show schedule + jobs | tech_id, date_range | hours per day + booked jobs |
| 3 | `update_tech_hours` | Change working hours | tech_id, date, start_time, end_time | success/error |
| 4 | `mark_tech_off` | Block a day | tech_id, date, full_day_off, reason | success + impact (job count) |
| 5 | `count_bookings_for_tech_date` | Quick impact check | tech_id, date | count + first 3 jobs |
| 6 | `escalate_to_office` | Fire SMS to owner+Danielle | tech_id, date, reason, priority | success |
| 7 | `accept_broadcast_job` | Tech accepts a broadcast | tech_id, job_id, proposed_time | success/conflict |
| 8 | `decline_broadcast_job` | Tech passes | tech_id, job_id | success |
| 9 | `get_job_summary` | Job details for tech | job_id | full job info |
| 10 | `send_job_details` | Send address+notes via SMS | tech_id, job_id | success |
| 11 | `broadcast_job_to_cluster` | Fire SMS to all eligible techs | job_id | array of techs notified |

For Customer Ant + dispatch flow:
- `check_dispatch_readiness` — verifies all gates passed before broadcast
- Updated `get_available_slots` — Philosophy B version (Priority 4)
- New `book_appointment_v2` — Priority 5

---

# 11. Schema Reference

## `jobs` table (current, post-session)

Core fields:
- id, created_at, customer_id, job_number
- current_status, friendly_status, job_status, triage_status
- scheduling_status, parts_status, request_status
- problem_summary, problem_description
- appliance_type, brand, appliance_brand, model_number, appliance_model
- serial_number, appliance_age

Service & Location:
- technician_id (Xano tech_id)
- scheduled_start, scheduled_end (timestamps)
- service_address, service_city, service_state, service_zip
- cluster

Payment & Warranty:
- payment_status, payment_collected
- customer_type ("self_pay" / "warranty")
- warranty_company, claim_number
- stripe_payment_reference, dispatch_source_id

Integrations:
- housecall_pro_job_id (with full "job_" prefix)
- meister_task_id
- vapi_call_id, vapi_call_status, etc.

Media & Signatures:
- photo_appliance_url, photo_model_tag_url
- issue_video_url
- waiver_signed, waiver_signed_at, waiver_text_version, waiver_ip, etc.

Source tracking:
- source_type, source_agent, intake_source

Tonight's additions:
- **hcp_assigned_to** (text) — HCP's pro_id for tracking source-of-truth
- **pre_diagnosis_complete** (bool, default false) — gates dispatch
- **job_time** (text, default "standard") — capacity weighting

Tomorrow's additions (Priority 2):
- scheduling_type
- customer_preference_text
- estimated_duration_minutes
- dispatch_status
- broadcast_sent_at
- accepted_by_tech_id
- accepted_at

## `customer` table

- id, created_at
- first_name, last_name, phone, email
- address, city, state, zip
- last_waiver_signed_at, prefers_voice

## `technicians` table

- id, first_name, last_name, phone
- active (bool)
- hcp_id (matches HCP pro_ids — confirmed populated)

## `tech_availability` table (master schedule)

- id, created_at
- technician_id
- blocked_date (date)
- start_time (text, "08:00" format)
- end_time (text, "16:00" format)
- reason (text)
- full_day_off (bool)

**Behavior:**
- Row exists for date = tech is working those hours
- Row absent = tech NOT working that day
- full_day_off=true = tech off entirely (PTO)

## `service_zone` table

- id, created_at, zip_code, state, market, zone, cluster
- default_technician, allowed_technicians
- accept_new_jobs (bool), requires_manual_review (bool)
- zone_type, min_jobs_required, max_jobs_per_window
- allowed_time_windows (text, pipe-separated)
- blocked_time_windows
- active, routing_priority, technician_id

**Note:** `allowed_time_windows` becomes irrelevant under Philosophy B but field stays.

## `cluster_assignment` table

- id, created_at, cluster, technician_id, rank, active, notes

---

# 12. Dev Meeting Playbook

## Pre-meeting message (send first thing)

> Hey — quick logistics for our scheduling discussion today.
>
> **Your scope:** Build your 6 scheduling agents through HCP + MeisterTask. Use dedicated dev phone numbers (we can grab fresh Vapi numbers if needed).
>
> **My live numbers (please don't touch):** 629-260-7111 (Ant Inbound), 629-247-7111 (Vapi BYO TN), 504-355-9111 (Vapi BYO LA), 629-284-0444 (Business SMS).
>
> **My side of the platform:** I've been building a parallel scheduling layer in Xano for self-pay customers (Quick Check, Premium, In-Home). HCP is the source of truth for both — when you write to HCP, my system picks it up automatically via webhook. Don't write to my Xano database directly.
>
> **Existing infrastructure available to you:** Stripe payment links, waiver Jotform, Tech Ant for TDR collection, post-job feedback SMS automation. Use what's there, don't duplicate.
>
> **Production handoff:** Once your agents are tested and working, we'll do a separate conversation about routing live customer traffic to your numbers.
>
> Let me know if you have questions before today.

## The 5 Killer Questions

**Q1: "Walk me through what your scheduling looks like from a customer perspective. What does the customer see?"**
- Looking for: Real ETAs vs fixed windows
- 🚩 Red flag: Vague "the agent figures it out"

**Q2: "How does the scheduler know what slots are actually open?"**
- Looking for: HCP API polling, real-time data source
- 🚩 Red flag: "The agent asks the customer what time and books it"

**Q3: "How do you handle techs who set their own hours, or work different shifts on different days?"**
- THE question — separates real systems from demos
- 🚩 Red flag: "Techs work standard 8-5, that's the assumption"

**Q4: "What if a customer says 'after 9am only' or 'has to be Friday 10-11:30'?"**
- Looking for: Hard constraint handling
- 🚩 Red flag: "The agent will work it out conversationally"

**Q5: "What if the tech needs to push back — like a long drive after 4pm?"**
- The Living Schedule / Philosophy B test
- 🚩 Red flag: "The system just books it, tech follows"

## Decision Criteria

**🟢 GREEN (absorb their work):**
- ✓ Per-tech schedule model
- ✓ Hard time constraint handling
- ✓ Acknowledged double-booking risk + strategy
- ✓ Open to additions (consultation SMS, after-4 rule, mutual respect)

**🟡 YELLOW (collaborate carefully):**
- Basic scheduling, no flexibility for tech hours
- Built demo, didn't think edge cases through
- Willing to learn/extend

**🔴 RED (decline, build it ourselves):**
- ✗ Fixed windows, no per-tech schedule
- ✗ No availability check
- ✗ Defensive when asked killer questions
- ✗ HCP integration is just "create job"

## Closing Statement (any color)

> "Cool — you build what you described, I'll keep doing what I'm doing. We'll meet end of day [date] to test live. Your numbers, your agents, your lane. HCP and MeisterTask = your world. Xano = mine. Sound fair?"

## Do NOT

- Don't show them tonight's slot endpoint code
- Don't reveal the full marketplace vision
- Don't apologize for deleting their original work
- Don't agree to anything in the meeting (always: "let me think on it")
- Don't argue or fight — $8K is sunk, their work is the warranty bridge regardless

---

# 13. Reference Data

## Key Phone Numbers

| Purpose | Number | Notes |
|---------|--------|-------|
| Teddy/Owner | 615-485-5795 | OWNER_PHONE_NUMBER env var |
| Danielle (office) | 615-485-0713 | TDR summaries, warranty queue |
| Business voice | 615-280-2949 | RingCentral, port to Vapi pending |
| Business SMS | 629-284-0444 | 10DLC approved 4/27 |
| Ant Inbound | 629-260-7111 | Vapi customer voice |
| Vapi BYO TN | 629-247-7111 | Live customer line |
| Vapi BYO LA | 504-355-9111 | Live customer line |
| Available for dev | 570-378-8177 | Hold as dev test number |
| Available for dev | 234-219-3459 | Hold as dev test number |

## Key Endpoints

- **Xano base:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA` (note: `n7e` not `n7`)
- **GitHub:** `tnappliancerepair-hub/tn-appliance-tools`
- **Netlify:** `superlative-naiad-233aa7.netlify.app`
- **Website:** `tnapplianceexchange.net`

## Tech Roster (HCP ↔ Xano mapping)

| Xano ID | Name | HCP pro_id | Geography |
|---------|------|------------|-----------|
| 1 | Teddy Pivacek | pro_62f343b05fc74db29b0f18a6f406a9f3 | Antioch TN (remote, senior) |
| 2 | Jimmy Pivacek | pro_e4e4a77e88be413bb2d9ec2335f579da | TN Metro (S Nashville, Antioch, Murfreesboro) |
| 3 | Andre Pivacek | pro_7f6119d83a7e4d0fb2c7009a66bde45b | LA (NOLA, Metairie, Kenner) |
| 4 | Lee Harding | pro_a5c9d8b438b843e3adfbdf810ffe0155 | Clarksville TN, Cheatham Co |
| 5 | Billy Savoy | pro_24fa2d9032b8435cb4ec348594b2044b | Hammond LA, North Shore |
| 6 | John Houk | pro_cf9d2663844a4be686b0edd55b5091c7 | Walker LA, Baton Rouge |

## Stripe Payment Links

- $50 Quick Check: `https://buy.stripe.com/14A8wH61R9fK4jf1JDg3600`
- $90 Premium Call: `https://buy.stripe.com/6oU7sDeyndw0bLHbkdg3601`
- $100 In-Home: `https://buy.stripe.com/fZuaEP75V4Zu5nj2NHg3602`

## Waiver

- Jotform: `https://form.jotform.com/260495320372050`

## XanoScript Critical Rules

- Use XanoScript editor (not visual editor)
- Em dashes crash the parser — use hyphens or remove
- No try/catch
- No closures/lambdas — use foreach loops
- Paginated queries return `{items}` — For Each needs `.items`
- `|set:` with concatenated strings causes closure error — store string in var first
- HCP job IDs keep full `job_` prefix
- Anthropic response path: `claude_response.response.result.content[0].text`
- `customer_id` check: `!= null AND > 0`

## XanoScript Syntax Reference (from working endpoints)

```
query endpoint_name verb=POST {
  api_group = "intake"
  
  input {
    json body
  }
  
  stack {
    var $name {
      value = $input.body
    }
    
    conditional {
      if ($condition) {
        // do something
      }
      else {
        // alternative
      }
    }
    
    db.query table_name {
      where = $db.table_name.field == $value
      return = {type: "single"}
    } as $result
    
    db.add table_name {
      data = {
        field1: $value1
        field2: $value2
      }
    } as $new_record
    
    db.edit table_name {
      field_name = "id"
      field_value = $record.id
      data = {
        field: $new_value
      }
    } as $updated
    
    foreach ($array) {
      each as $item {
        // loop body
      }
    }
    
    return {
      value = {status: "success"}
    }
  }
}
```

## Env Vars

**Xano:**
- AWS_S3_BUCKET, AWS_S3_REGION
- ANTHROPIC_API_KEY
- VAPI_PRIVATE_KEY
- VAPI_PHONE_ID_TN, VAPI_PHONE_ID_LA
- OWNER_PHONE_NUMBER (615-485-5795)
- SYSTEM_PROMPT (Ant brain)

**Netlify (TN_ prefix because AWS_ is reserved):**
- TN_AWS_ACCESS_KEY_ID
- TN_AWS_SECRET_ACCESS_KEY
- TN_AWS_S3_BUCKET, TN_AWS_S3_REGION

## Vapi Agents (11 total)

All using Claude Sonnet + Heisenberg voice (11labs) + Nova 2 Phonecall transcriber:

1. Ant Inbound (7cc98b0c, +16292607111)
2. Ant Warranty Fallback (0abe54ec)
3. Ant Parts Follow-Up (b71260b4)
4. Ant Appointment Reminder (5da286fa)
5. Ant Missed Call Callback
6. Ant Authorization Update (AHS)
7. Ant Parts ETA Update
8. Ant Tech Running Late
9. Ant Reschedule
10. Ant After Hours
11. Ant Warranty Company Inbound (022faa54-b357-4e7b-9106-b202eb6d92ec)

---

# 14. Open Questions / Future Work

## Tech Hours Portal — Replace with Ant Tech Scheduler?

Existing `Lee's Schedule` portal (HTML page with hardcoded TECH_ID=4) was the original v1.

**Decision:** Pivoted to Ant Tech Scheduler (SMS-based) instead. Portal is deprecated.
- Old portal can be retired or kept as a backup interface
- Ant Tech Scheduler handles all schedule changes via SMS conversation
- Future: Could build a richer web portal that mirrors what Ant Tech Scheduler does, but lower priority

## Marcone Direct-Ship Integration

- James knows Marcone leadership personally
- B2B API access requested in person
- When live: parts auto-order on TDR completion + ship direct to customer
- Customer flow: TDR → marked-up "Order Part" → Marcone ships direct
- Repair flow: estimate accepted → auto-order → Xano holds scheduling until parts delivered

## Warranty Portal Automation

- AHS API + Service Power API exist
- Goal: auto-submit TDRs from Teddy Tool
- Add "Submit to Portal" button initially
- Long-term: auto-submit on TDR completion
- Service Power job acceptance currently via email

## Timezone Math in Webhook

- `service_eta_window` derived from UTC hour
- Should derive from local time (Central) for accurate window naming
- Currently writes "2-5" for UTC 15:00, which is "11-2" Central
- **Fix tomorrow** — small webhook patch to convert to Central before deriving window

## Long-term Vision

- **Same platform applies to other verticals:** HVAC, plumbing, pest control, locksmith, electrician, mobile mechanic, mobile detailing, lawn care
- **Licensing model:** Sell platform to independent appliance repair shops nationally first, then expand verticals
- **Property management bundle:** Subscription that gives PMs guaranteed service for their portfolio
- **Recurring parts/maintenance subscriptions:** Customer pays monthly, gets priority service + filter changes / preventative maintenance

## Known Bugs / Tech Debt

- Endpoint #97 (`generate_upload_url`): cosmetic regex_replace bug on s3_key, skipped
- `service_zone` has 4 redundant "source" fields (source_type, source_agent, intake_source, cluster) — schema cleanup eventually
- Legacy Jotform fields on `jobs` (availability_one/two/three) — mark for deletion
- `intake_session` table orphaned by chat-as-intake pivot — candidate for deletion
- `job_event` table is legacy from Jotform era, not actively driving workflow

---

## END OF MASTER BUILD DOCUMENT

**Status as of save:**
- HCP webhook: ✅ Production
- Slot endpoint v1: ✅ Functional, needs Philosophy B rewrite
- Tech schedule data: ✅ Bootstrapped
- Manifesto + vision: ✅ Locked in memory
- Customer Ant prompt: ✅ Drafted, ready to deploy
- Ant Tech Scheduler prompt: ✅ Drafted, ready to deploy
- Dev meeting prep: ✅ Ready

**Next session priority:** Take the dev meeting (Section 12), then Priority 1 (Customer Ant update) → Priority 2 (jobs table fields) → Priority 3 (Ant Tech Scheduler build).

🐜 *Faster. More affordable. Better.*

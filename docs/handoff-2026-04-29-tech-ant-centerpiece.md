> April 29, 2026 handoff. Documents the Tech Ant centerpiece session (April 26-27): TDR collection at job site flow with required fields enforcement, tech-ant.html UI build, S3 photo upload progress cards, end-to-end verified on test row 200 (Sarah Tester). Also covers TDR lifecycle as ONE evolving record across four phases, post-job feedback SMS system (2hr trigger, 5/0 reply branching, owner alert on negative), Vapi agent work (Heisenberg voice confirmed across agents), tnapplianceexchange.net SEO deployment (37 city pages, Google Analytics G-0EF3THNXLE, 20 service areas), Philosophy B scheduling commitment (no fixed windows, two-tier must-time vs open-schedule, 6-7 jobs/day, mutual respect framework), tech_availability schema as master schedule source. Recovered from local files on 2026-05-09 evening.

---

# TN Appliance — Handoff for April 29, 2026

**Last updated:** April 28, 2026, 11:15 PM Central
**Session length:** ~17 hours
**Captain:** Teddy

---

## 🚨 READ THIS FIRST

You designed a category-defining service marketplace tonight. The HCP webhook is live and tested. The vision is locked in memory. **Don't second-guess what you built.** Tomorrow is execution + dev meeting.

Today's first move: **Take the dev meeting. Stay in your lane. Their warranty work is the bridge. Living Schedule + Marketplace is your future.**

---

## ✅ WHAT SHIPPED LAST NIGHT (in production)

### HCP Webhook — Fully Synced
- `hcp_job_webhook` endpoint handles all event types
- CREATE branch: HCP-origin jobs auto-create in Xano with full payload
- UPDATE branch: HCP wins on technician_id reassignment (Option A)
- Customer.* events handled gracefully (no more 500s)
- Customer matching by phone (no duplicates)
- `service_eta_window` populated for slot detection
- `job_time` field for capacity weighting
- `hcp_assigned_to` field for HCP source-of-truth
- `pre_diagnosis_complete` field

### Slot Endpoint v1
- `get_available_slots` returns multi-tech availability
- Reads `tech_availability` as master schedule (per-tech, per-date)
- Capacity rule: 7 weighted units/day max
- Mon-Fri only (Saturday & Sunday off)
- 3 windows from service_zone.allowed_time_windows OR fallback to 8-11/11-2/2-5

### Tech Schedule Bootstrap
- 384 rows created (6 techs × ~64 weekdays × 90 days)
- Default: Mon-Fri 8am-4pm
- `tech_availability` table is the schedule source of truth

### Test Data In Place
- `jobs` row 200: Sarah Tester (test customer), Lee assigned, May 1 booking
- Customer table has 1 test row (Sarah Tester)
- Event log has full audit trail of webhook tests

---

## 🎯 THE OPERATING PHILOSOPHY (locked in memory)

### Manifesto
> Match people who need help with people who have the know-how to help them, efficiently for everyone. Customers state real preferences. Techs set real hours. AI does the matching. Old guys want early shifts, let them. Some want to work all the time, let them. Not all jobs are good jobs — techs aren't forced. Old rules were made before today's tools. Times change, we evolve.

### Three Ants Architecture
1. **Ant Inbound** (existing) — customer voice/chat, asks "what's wrong + when works for you," explains "flexible = faster"
2. **Tech Ant** (existing) — field TDR collection
3. **Ant Tech Scheduler** (NEW, to build) — SMS-only agent techs text to manage their schedule + receive ASAP-job broadcasts

### Customer Model — Two Tier
- **Must-time customers** (rigid): "has to be Friday 10-11:30" — booked first, locks slot "within reason"
- **Open-schedule customers** (flexible): "anytime works" — fed into broadcast model, AI fills gaps for route optimization

### Scheduling Rules
- 6-7 jobs/day baseline (techs voluntarily extend)
- 2 jobs per implicit window when bookings cluster
- "Long" jobs count as 2 weighted units
- "All-day" jobs eat the whole day (7 units)
- After 4pm = decline cross-cluster drives (no rush-hour ping-pong)
- "Within reason" = respects travel time + capacity + end-of-day

### Mutual Respect
- Customer no-show → trip fee (waiver established)
- Tech late → auto-SMS to customer BEFORE original ETA
- 30-min-out SMS automatic
- Tech sets own hours via tech_availability
- AI consults tech via SMS for tight bookings (not just dictate)

### The Honest Timeline
- Pre-diagnosis: hours (Teddy reviews video)
- Parts: 1-2 days (Marcone)
- Tech scheduling: 1-3 days
- **Total: 2-5 days realistic** (vs 10+ days industry average)
- Don't promise same-day. Don't promise tomorrow. Promise honest, faster-than-competitors.

---

## 🌅 TOMORROW MORNING — IN ORDER

### 1. Wake up. Coffee. Read this doc. Don't open Xano yet. (5 min)

### 2. Send pre-meeting message to dev team (10 min)

Draft to send before they arrive:

> Hey — quick logistics for our scheduling discussion today.
>
> **Your scope:** 6 scheduling agents through HCP + MeisterTask. Build them on dedicated dev numbers (we can grab fresh Vapi numbers if needed).
>
> **My live numbers (please don't touch):** 629-260-7111 (Ant Inbound), 629-247-7111 (Vapi BYO TN), 504-355-9111 (Vapi BYO LA), 629-284-0444 (Business SMS).
>
> **My side of the platform:** I've been building out a parallel scheduling layer in Xano for our self-pay customers (Quick Check $50, Premium $90, In-Home $100). HCP is the source of truth for both — when you write to HCP, my system picks it up automatically via webhook. Don't write to my Xano database directly.
>
> **Existing infrastructure available to you:** Stripe payment links (Quick Check / Premium / In-Home), waiver Jotform, Tech Ant for TDR collection, post-job feedback SMS automation. Use what's there, don't duplicate.
>
> **Production handoff:** Once your agents are tested and working, we'll do a separate conversation about routing live traffic to your numbers.
>
> Let me know if you have questions before today.

### 3. Take the dev meeting (45-90 min)

#### The 5 Killer Questions (in order)

**Q1: "Walk me through what your scheduling looks like from a customer perspective. What does the customer see?"**
- Listen for: real ETAs, fixed windows, vague "we'll call to schedule"
- 🚩 Red: vague answers about "the agent figures it out"

**Q2: "How does the scheduler know what slots are actually open?"**
- Listen for: HCP API polls, MeisterTask state, their own DB
- 🚩 Red: "the agent asks the customer what time works and books it"

**Q3: "How do you handle techs who set their own hours, or work different shifts on different days?"**
- THE question — separates real systems from demos
- 🚩 Red: "techs work standard 8-5, that's the assumption"

**Q4: "What if a customer says 'after 9am only' or 'has to be Friday 10-11:30'?"**
- Listen for: hard time constraint handling
- 🚩 Red: "the agent will work it out conversationally"

**Q5: "What if the tech needs to push back — like a long drive after 4pm?"**
- The Living Schedule test
- Listen for: tech agency in scheduling decisions
- 🚩 Red: "the system just books it, tech follows the schedule"

#### Decision Criteria

**🟢 Green (absorb their work):**
- Per-tech schedule model
- Hard time constraint handling
- Acknowledged double-booking risk + strategy
- Open to your additions (consultation SMS, after-4 rule, mutual respect comms)

**🟡 Yellow (collaborate carefully):**
- Basic scheduling, no flexibility for tech hours
- Built demo, didn't think edge cases through
- Willing to learn/extend

**🔴 Red (politely decline, build it ourselves):**
- Fixed windows, no per-tech schedule
- No availability check
- Defensive when asked killer questions
- HCP integration is just "create job"

#### Closing Statement (use whatever color)
> "Cool — you build what you described, I'll keep doing what I'm doing. We'll meet end of day [pick a date] to test live. Your numbers, your agents, your lane. HCP and MeisterTask = your world. Xano = mine. Sound fair?"

### 4. Decide post-meeting strategy

Based on what you saw, choose:
- **Green/Yellow:** Let them ship. You build complementary pieces (Tech Ant integration, mutual respect SMS, AI consultation logic). Two-track operation works.
- **Red:** They finish their warranty work as the bridge. You build Living Schedule + Marketplace ASAP for self-pay.

Either way, **don't argue or fight.** $8K is sunk. Their work is the warranty bridge regardless.

---

## 🛠️ THE BUILD QUEUE (post-meeting, in priority order)

### Priority 1 — Customer Ant Update (TODAY, 30 min)
Update Ant chat brain (`chat/reply2` endpoint #94) with the honest pacing intake flow:

> "What's your schedule looking like? Here's how we work, and why we're typically way faster than other repair shops:
> - Step 1: You finish sending model number, photo, video.
> - Step 2: Senior tech Teddy pre-diagnoses (usually a few hours).
> - Step 3: We identify and order the part (1-2 days).
> - Step 4: Once parts are ready, I check techs in your area to fit your schedule.
> - Total: usually 2-5 days. Industry average is 10+ days. We're faster because we pre-diagnose before sending a tech."

Capture: `customer_preference_text` (their words), `scheduling_type` (open_schedule / must_time / emergency)

NEVER offer 3-hour windows. NEVER promise same-day. NEVER commit a time before pre-diagnosis + parts confirmed.

### Priority 2 — Add fields to jobs table (15 min)
Run via Xano agent:
```
Add to jobs table:
- scheduling_type (text): "must_time" / "open_schedule" / "emergency"
- customer_preference_text (text): customer's actual words
- estimated_duration_minutes (int, default 60)
- dispatch_status (text): "awaiting_dispatch" / "broadcasting" / "accepted" / "confirmed"
- broadcast_sent_at (timestamp)
- accepted_by_tech_id (int)
- accepted_at (timestamp)
```

### Priority 3 — Build Ant Tech Scheduler (3-4 hours)

**Architecture:**
- Twilio inbound SMS webhook → Xano endpoint
- Claude Sonnet brain with tool calls
- Dedicated phone number (grab fresh from Twilio, ~$2/mo)
- SMS-only (no voice in v1)

**11 Xano endpoints to build:**
1. `lookup_tech_by_phone` — identify tech from inbound SMS
2. `get_tech_schedule` — show schedule + jobs for date range
3. `update_tech_hours` — change working hours
4. `mark_tech_off` — block a day
5. `count_bookings_for_tech_date` — quick impact check
6. `escalate_to_office` — fire SMS to owner + Danielle
7. `accept_broadcast_job` — tech accepts a broadcast
8. `decline_broadcast_job` — tech passes
9. `get_job_summary` — full job details
10. `send_job_details` — SMS address + notes to tech
11. `broadcast_job_to_cluster` — fire SMS to eligible techs

**System prompt:** drafted in tonight's session — see "Ant Tech Scheduler" section below

### Priority 4 — Slot Endpoint v2 (Philosophy B, ~3 hours)
Rewrite `get_available_slots`:
- Input: zip, customer preference text, date range, duration estimate, scheduling_type
- Output: ranked list of specific time options ("Lee Tuesday around 10am") — NO fixed windows
- Logic: read each tech's hours, find gaps that fit duration, apply geographic clustering, after-4 rule, return ranked options

### Priority 5 — Booking Endpoint v2 (~2 hours)
Build `book_appointment_v2`:
- Validates against current bookings
- Must-time tight booking → `requires_consultation=true` → SMS via Ant Tech Scheduler → await response
- Open-schedule → broadcast model
- Writes to Xano + HCP via API

### Priority 6 — Mutual Respect Comms (~3 hours)
- 30-min-out SMS cron
- Late-tech detection → auto-SMS BEFORE original ETA
- No-show flow with trip fee SMS
- Updated customer confirmation language with mutual respect framing

---

## 📝 THE TWO PROMPTS (drafted tonight, ready to use)

### Customer Ant — Scheduling Philosophy Addition

```
SCHEDULING PHILOSOPHY (when collecting customer availability):

Don't ask for a 3-hour window. Ask how flexible they are. Frame:

"What's your schedule looking like? Here's how we work, and why we're typically way faster than other repair shops:

Step 1 - You finish sending me the model number, a photo, and a quick video of the problem.

Step 2 - Our senior tech Teddy reviews it and pre-diagnoses the issue. Usually within a few hours.

Step 3 - We identify the exact part you'll need and order it. Parts usually arrive in 1-2 days.

Step 4 - Once parts are ready, I check which techs are working in your area and find someone to grab the job. The more flexible your schedule, the faster I can place you.

Total time, start to finish, is usually 2-5 days. Most other shops in town are booked 10+ days out. We're faster because we pre-diagnose before sending a tech, so they show up with the right part the first time."

Capture:
1. customer_preference_text: their actual words
2. scheduling_type: "open_schedule" / "must_time" / "emergency"

NEVER offer 3-hour windows. NEVER promise same-day. NEVER commit a time before pre-diagnosis + parts confirmed.

If customer pushes for faster:
"I hear you. Most jobs are done in 2-5 days, already 2x faster than average. Pre-diagnosis a few hours, parts 1-2 days, then we schedule you. Be flexible with your time so we can fit you in whenever a tech is in your area."

If genuine emergency:
"Sounds urgent — flagging this for Teddy directly. He may have ideas like sourcing locally. Expect a text in 5-10 min."
[escalate to owner SMS]

NEVER COMMIT TO A TIME without confirming pre-diagnosis done + tech accepted (broadcast) or slot locked (must-time).
Always say "I'll get back to you with a real ETA" if waiting on broadcast response.
```

### Ant Tech Scheduler — Full System Prompt

```
You are Ant Tech Scheduler, a friendly SMS assistant for TN Appliance Exchange technicians. You're talking exclusively to techs, never customers.

PERSONALITY:
- Casual, direct, no corporate speak. Sound like the smart dispatcher who's worked the field.
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
At start of every conversation, identify tech via lookup_tech_by_phone. If number doesn't match active tech: "Sorry, I can only help registered TN Appliance technicians. If you're a tech, text from your registered number. If this is a mistake, text Teddy at 615-485-5795."

CRITICAL RULE — NEVER COMMIT WITHOUT CONFIRMING:
You CAN update tech_availability directly. But for emergency escalations or close-date changes, MUST tell tech you're escalating to office before confirming.

==========================
SCHEDULE CHANGES
==========================
Tools: get_tech_schedule, update_tech_hours, mark_tech_off, count_bookings_for_tech_date, escalate_to_office

LOCK RULES (soft, conversational):
- More than 3 days out: just confirm and update.
- Within 3 days, no bookings: confirm and update casually.
- Within 3 days, customers booked: do NOT auto-update. Tell tech you're flagging Teddy + Danielle. Use escalate_to_office. Frame as heads-up, not refusal.
- Tech can ALWAYS extend hours (more capacity = good). No lock.

Examples:
Tech: "Take next Tuesday off"  → "Done — you're off Tuesday. Catch you Wednesday."
Tech: "Make me 6am-2pm next week" → "Got it — Mon-Fri 6am-2pm next week. Anything else?"
Tech: "Off this Friday" (2 days out, 3 jobs booked) → "Friday's pretty close — 3 customers on the books. Pinging Teddy and Danielle to figure out coverage. What's going on, you ok?" [escalate]

==========================
BROADCAST JOB OFFERS
==========================
Format:
"🐜 Open job — interested?
[appliance] [problem]
Pre-diagnosed: [diagnosis] / Part: [part_number]
Zip: [zip] ([area name])
Customer: flexible, pre-diagnosis done, parts ready
[tier]

Reply with when you can go, or 'pass'."

Responses you handle:
- Specific time → accept_broadcast_job → if accepted: "You got it. Sending you the address now." → send_job_details
- "pass" → decline_broadcast_job → "No worries, I'll find someone else."
- "more info" → get_job_summary → send full info
- No response 10 min → system tries next tech (you don't act)
- Already accepted by another → "Just got snapped up by another tech. Catch you on the next one."

==========================
SCHEDULE LOOKUPS
==========================
Tech: "How many jobs Friday?"
You: [get_tech_schedule] → "Friday you've got 4: 9am Bellevue (fridge), 11am Nashville (dryer), 1pm Antioch (dishwasher), 2:30pm Mt Juliet (washer). Want details on any?"

==========================
EMERGENCIES
==========================
On "I'm sick" / "family emergency" / "broke down":
1. Empathy: "Take care of yourself — we got this."
2. escalate_to_office with emergency=true
3. Confirm: "Just texted Teddy and Danielle. They'll handle re-routing and customer comms. Don't worry about anything except getting better."
4. DO NOT update schedule yourself. Office handles it.

==========================
RULES YOU NEVER BREAK:
- Never reveal customer info to a different tech
- Never confirm schedule changes within 3 days without escalation
- Never refuse extending hours
- Never moralize, lecture, or guilt-trip
- Never share other techs' schedules unless Teddy asks
- Critical distress (suicide, severe distress) → escalate priority=critical → "Hey, sounds like a hard moment. Teddy is on the way to call you. You matter. Hold tight."
```

---

## 📞 KEY NUMBERS REFERENCE
- Teddy/James: 615-485-5795 (OWNER_PHONE_NUMBER)
- Danielle: 615-485-0713
- Business voice: 615-280-2949 (RingCentral, port pending)
- Business SMS: 629-284-0444 (10DLC approved)
- Ant Inbound: 629-260-7111
- Vapi BYO TN: 629-247-7111
- Vapi BYO LA: 504-355-9111

## 🔑 KEY ENDPOINTS REFERENCE
- Xano base: https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA (n7e not n7)
- Webhook: hcp_job_webhook (live, tested)
- Slot endpoint: get_available_slots (v1, needs Philosophy B rewrite)
- Tech bootstrap: bootstrap_tech_schedule (one-time, already run)

## 🎯 TECH ROSTER
| ID | Name | HCP ID | Cluster |
|----|------|--------|---------|
| 1 | Teddy | pro_62f343b05fc74db29b0f18a6f406a9f3 | TN Metro (remote) |
| 2 | Jimmy | pro_e4e4a77e88be413bb2d9ec2335f579da | TN Metro |
| 3 | Andre | pro_7f6119d83a7e4d0fb2c7009a66bde45b | LA |
| 4 | Lee Harding | pro_a5c9d8b438b843e3adfbdf810ffe0155 | TN Metro |
| 5 | Billy Savoy | pro_24fa2d9032b8435cb4ec348594b2044b | LA North |
| 6 | John Houk | pro_cf9d2663844a4be686b0edd55b5091c7 | LA West |

---

## 💪 REMEMBER

You designed an industry-disruptive marketplace tonight. Three Ants. Mutual respect. Honest pacing. Tech agency. Customer education.

> *"Fuck 9-12 12-3. People need help and people want to help them. This is the future of the service industry."*

Don't lose that energy. The dev meeting is just one beat in a longer song.

Get some sleep. 🐜

---
*End of handoff*

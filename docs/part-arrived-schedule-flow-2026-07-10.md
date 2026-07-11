# "Part Arrived → Schedule" flow (2026-07-10)

**One-liner:** the connective tissue between the [Parts-In-Flight system]
(`parts-in-flight-system-spec-2026-07-10.md`) and [Customer-Initiated Holds]
(`customer-initiated-holds-spec-2026-07-10.md`). When a part lands for a
parts-pending job, the customer gets scheduled in 2–3 dead-simple turns — inbound
*or* proactive — and the job unsticks itself.

Co-developed with Teddy on the road, 2026-07-10. Guiding rule: **everything simple
and easy.**

---

## The trigger (two ways in, same flow)

- **Inbound:** customer calls/texts *"just letting you know my part arrived."*
  (Happens a lot.)
- **Proactive (the better one):** the parts ledger flips the part to **delivered**
  (tracking), and Ant reaches out *first* — *"Your part's in — what days work to get
  you finished up?"* — before the customer ever calls. The inbound call becomes the
  **backup** for customers who beat our tracking.

## The flow — 2 to 3 turns, nothing more
1. **Confirm it.** Caller ID → their job; Ant sees it's parts-pending and, because
   the parts system tracks that part, it can actually *confirm*: *"Great — I see the
   part for your fridge. Let's get you scheduled."* (Not just taking their word —
   closing the loop.)
2. **Ask availability.** *"What days work for you?"*
3. **Capture or hold:**
   - **Wide open** → mark availability on the job; it's now ready-to-schedule and the
     office can slot it.
   - **A specific day** → *"I'll put a hold on Friday and the office will confirm."*
     → stages a **customer-ask tentative hold** (see the holds spec: distinct card,
     Approve / Counter / Decline, auto-drafted Counter).

Customer hangs up handled and *moving*; the office gets a parts-pending job that
unstuck itself with availability already attached; no human touched the call.

## The board state: "Parts Arrived · Needs Scheduled" (office side)
A part landing must not let the job quietly sit in Waiting Parts hoping someone
notices. The instant the parts ledger flips the part to **delivered** (or the
customer says it's here), the job **auto-promotes** out of Waiting Parts into a
distinct **"Parts Arrived · Needs Scheduled"** lane — clear and near-urgent,
*separate* from the regular new-job needs-scheduled pile:
- Regular needs-scheduled = "never booked yet."
- Parts Arrived · Needs Scheduled = "was waiting on a part, part's in, book the
  return visit."

This fires **at the same time** as the proactive customer outreach — so the board
*and* the customer both light up the moment the part's in. Danielle opens the board
and sees exactly what's ready, and many already have availability attached because
Ant beat her to it.

**Multi-part guardrail:** only promote when **all** parts the job needs are in. If
it's 2 of 3, the job stays put with a "2 of 3 parts arrived" note so nobody
schedules a tech to a job that's still missing a piece.

## The one honest guardrail
If a customer says "it's here" but our tracking says the part hasn't landed yet,
**the AI does not argue.** It takes their word, captures the availability, and
quietly flags the mismatch for the office to eyeball. Warm and easy on the call,
safe underneath.

## Rules inherited (don't restate to the customer)
- No clock times — day only; arrival window texted the morning of.
- A hold is *pending approval*, never "booked."
- Holds can't rot — they ride the same worked queue/SLA as callbacks.

## Why it matters
The **parts-pending pile is where jobs go to die** — waiting on a part, waiting on
the customer to re-engage. This flow clears it automatically: parts-in-flight knows
the part landed → this flow gets availability/hold → customer-holds gets it booked.
It also handles a real, recurring chunk of phone volume end-to-end, dropping the
"need a person to schedule" pressure.

## Build note (mostly composition, not new systems)
This is a thin intent-handler on top of two systems already spec'd:
- **Parts-In-Flight** provides "is this part delivered?" (confirm) + the
  delivered-tracking event that fires the proactive outreach.
- **Customer-Initiated Holds** provides the specific-day path (stage a hold).
- Reuse: lookup-by-phone/claim (identify the job), availability capture on the job,
  the customer SMS thread, the Vapi phone AI + text/intake as entry points.

New pieces: (a) a phone/text **"my part arrived" intent** that runs the 3 steps;
(b) a **proactive trigger** on parts `delivered` → outreach; (c) the tracking-vs-
customer **mismatch flag** for the office.

## What "done" feels like
A part hits the doorstep and — whether the customer calls or Ant reaches out first —
they're scheduled (or held) in three easy turns, the parts-pending job clears
itself, and Danielle sees availability already sitting on it instead of another job
to chase.

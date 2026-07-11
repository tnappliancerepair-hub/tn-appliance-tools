# Customer-Initiated Tentative Holds — build spec (2026-07-10)

**One-liner:** let a customer ask for a day (by phone or text), stage it as a
*tentative hold* the scheduler sees as a distinct "customer asked" card, and give
the scheduler three one-tap moves — **Approve / Counter / Decline** — where Counter
auto-drafts a warm "what days work for you?" reply. The AI never books anything; it
turns an incoming request into an engaged, staged conversation.

Co-developed with Teddy on the road, 2026-07-10, branching off the phone-system
discussion.

---

## The real prize: engagement, not the day

Our hardest scheduling problem isn't people asking for the wrong day — it's people
who **go dark** (no availability, no callback, jobs stuck because the customer won't
engage; scheduling churn is the #1 historical flaw). A customer who says *"I want
Friday"* is the **opposite** of a ghost — they're live, talking, and they'll reply.

So even when Friday is a hard no, we've lost nothing and gained a **responsive
customer.** We counter — *"Friday's packed, but I want to get you in — what's good
next week?"* — and now we're in a real back-and-forth with someone who answers.
**The feature turns a ghost into a negotiation.** That's worth more than the
specific day ever was, and it aims squarely at the customers who are hardest to pin
down.

This is the "no more surprises — it's all communication, with a positive attitude"
principle, running on the exact segment that needs it most.

---

## Two hold types — and the distinction must be unmissable

They mean **opposite things**, so they cannot look alike on the board:

- **Office → customer hold** (exists today): *we* offered a spot, waiting on *their*
  yes. Danielle taps ⏳ Hold, customer gets asked to confirm.
- **Customer → office hold** (NEW): *they* asked for a day, waiting on *our* yes.
  Distinct color + badge — e.g. **"📩 Customer asked: Friday"** — so the instant the
  scheduler sees it, they know "someone's reaching out, react to this."

Both reuse the existing tentative-hold system (`schedule-hold.js`: Confirm/Release,
office-only, no auto-expire, tech never sees holds). The new work is (a) the AI
*creating* one from a customer request, (b) tagging it customer-initiated + the
requested day, (c) the distinct visual, (d) the three-action response.

## The flow
1. Customer (phone AI or text/intake) says *"I want to be scheduled Friday."*
2. **AI:** *"Absolutely — I'll put a hold on Friday for you. It just needs our
   scheduler to confirm, so you'll get a text shortly to lock it in."* (Sets the
   honest expectation — a *hold pending approval*, never "booked." No clock time —
   day only, per day-of routing.)
3. Ant stages a **customer-ask tentative hold** on Friday + pings the scheduler with
   full context.
4. Scheduler sees the distinct card and taps one of three:
   - **Approve** → locks it; customer gets *"You're set for Friday — we'll text your
     arrival window that morning."*
   - **Counter** (the magic move) → Ant **auto-drafts** a warm message, scheduler
     one-taps send: *"Friday's full, but I want to get you scheduled — what days work
     for you next week?"* Their reply lands availability back on the job and can
     auto-stage a fresh hold on a day they name.
   - **Decline / Release** → for genuine no-goes; frees the spot.

## Rules that keep it from backfiring
- **Wording is everything.** "Hold pending approval," never "booked." Say booked and
  a bumped hold becomes a broken promise — the exact surprise we're killing.
- **No clock times to the customer** — hold the DAY; arrival window is texted the
  morning of.
- **Holds can't rot.** This lives or dies on turnaround — same SLA as callbacks. A
  customer-ask hold that sits unapproved for a day = back to "nobody got back to me."
  So these ride the same worked queue with a timer: approve or respond inside the
  SLA.
- **v1 capacity = dumb-simple.** Hold whatever day they ask; let the human sort it.
  It's a hold, not a booking. Don't make the AI try to route yet — get the *staging*
  working first, add smarts later.
- **Counter is auto-drafted, human-sent.** Ant writes the "what's your availability"
  message; the scheduler is one tap from keeping them talking. That one action
  converts the most ghosts — it's the highest-value part of the whole feature.

## Why it also helps the phone problem
A caller who wants to get scheduled → AI stages their requested day as a
customer-ask hold → Danielle now has a warm, engaged lead to close **async, no live
transfer, no wrestling.** Every one of these drops the "I need to talk to a person
to get scheduled" pressure that drives the anti-AI callers. It's a scheduling
feature *and* a phone-handoff relief valve.

## The learning layer (on-ramp to real autopilot)
Every customer-ask hold, plus **whether the scheduler approved it as-is or changed
it**, is training data on which days/areas actually have room. Enough of them and
Ant starts to know — which is the earned on-ramp to true self-scheduling later,
instead of guessing at it now.

## Build order
1. **AI → create a customer-ask hold** (phone + text): detect a day request, set the
   expectation wording, stage a tagged tentative hold, alert the scheduler.
2. **Distinct board card** — "📩 Customer asked: {day}" visual on both scheduling
   surfaces, clearly different from an office hold.
3. **Three-action response** — Approve / Counter / Decline, with **Counter
   auto-drafting** the availability message for one-tap send.
4. **Reply capture loop** — customer's counter-reply lands availability on the job +
   can auto-stage a new hold on a named day.
5. **SLA/queue** — customer-ask holds join the worked callback/hold queue with a
   timer so none rot.

## Reuse
- `schedule-hold.js` + the tentative-hold UI (Confirm/Release, both surfaces).
- The customer SMS thread (`sms-thread` + reply) for the Counter back-and-forth.
- `callbacks.html` / the worked-queue pattern for the SLA timer.
- The phone AI (Vapi) + intake/text flow as the two entry points.

## What "done" feels like
A customer asks for a day and immediately feels handled — "they put a hold on Friday
for me." The scheduler sees a clearly-marked "customer asked" card and, in one tap,
either locks it or keeps the conversation alive with a warm auto-drafted counter.
The customers who used to ghost are now the ones talking. Nobody over-promised,
nobody got surprised, and Danielle worked three of them in the time it used to take
to chase one.

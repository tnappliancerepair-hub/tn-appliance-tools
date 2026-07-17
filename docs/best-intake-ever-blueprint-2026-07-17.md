# 🐜 The Best Intake System Ever Built — Ant Intake Spine

**The north star for TN Appliance / Ant intake. Draft v1, 2026-07-17.**
Audience = us. This is the design we build *to*. When intake decisions come up, they
reconcile against this doc. Companion to `docs/ant-operating-plan.md` (the business plan).

> "Something the FieldPal developers wish they had the freedom and technology to build." — Teddy, 2026-07-17

---

## 1. The thesis — what "best ever" actually means

An intake system is not a form. It is the **first ninety seconds of a repair**, and every
dollar downstream is decided there. Most service companies treat intake as a receptionist:
take a message, hand it to a human. The best intake ever built is the opposite — it is a
**self-driving front door** that a lead can enter from any channel and come out the other
side **booked, diagnosed, and delighted**, with a human pulled in only where judgment earns
its keep.

Nine properties define it. Every one is a yardstick, not a slogan:

1. **Omni-channel, one brain, one record.** Phone, text, web, chat, QR, warranty dispatch —
   every door leads to the *same* job record and the *same* conversation thread. The system
   never asks a customer something it already knows.
2. **Zero-drop. Nothing is ever silent.** A lead physically *cannot* fall through. No gate
   silently eats a text, no call dies in voicemail with no callback, no job goes invisible on
   the board. This is property #1 for a reason — everything else is worthless if leads leak.
3. **Maximum signal, minimum questions.** Extract everything (symptom, appliance/system,
   model, media, address, warranty-vs-cash, urgency, sentiment) while *asking* the human as
   little as possible. Derive the rest: caller-ID → history, photo → model (OCR), address →
   routing, dispatch email → the whole claim.
4. **Diagnoses at the door.** Intake *is* the start of the diagnosis, not a precursor to it.
   Ant Brain predicts the failure and the part **before the truck rolls**. Pre-diagnosis =
   most of the TDR, filled for free.
5. **Books and closes itself.** It sets availability, schedules, confirms, collects the cash
   deposit or captures the warranty authorization — 24/7, no human in the loop for the happy
   path.
6. **Routes intelligently.** Warranty vs cash, appliance vs vent vs HVAC, which cluster/tech,
   urgency triage — one intake, every service line, correct hand-off every time.
7. **Learns from outcomes.** Every completed job grades the intake's pre-diagnosis. The
   first-guess accuracy climbs with every repair. The intake gets *smarter while we sleep.*
8. **Human-graceful.** When it should hand to a person — upset customer, gray-area claim,
   high-value job — it does so seamlessly and **with full context**, never cold. And a human
   can always step in mid-stream and take the wheel.
9. **Trust-first.** Honest options, transparent pricing, no dark patterns. The intake is the
   brand's transparency moat made operational.

**One-line definition of done:** *A customer reaches out however they want, at any hour, and
within seconds they're understood, pre-diagnosed, and booked — and we never, ever lose one.*

---

## 2. Why WE can build what FieldPal can't

FieldPal is voice-first AI for warranty authorization + tech troubleshooting, built by an
outside dev shop and evaluated *by* the warranty partner (so, constrained by that partner's
box). Teddy tested it: impressive vision, primitive execution, painful login. Here is why the
ceiling is ours, not theirs:

| Edge | FieldPal | Ant |
|---|---|---|
| **Owns the whole stack** | No — a vendor bolted onto a partner's system | **Yes** — phone, SMS, web, board, scheduling, payments, payroll, all one codebase |
| **Owns the outcomes (the moat)** | No — never sees what actually fixed the job | **Yes** — every completed TDR grades the guess; the corpus compounds daily |
| **Owns the techs** | No | **Yes** — family crew, real jobs, real data flowing in |
| **Owns the customer relationship** | No — the partner does | **Yes** — cash *and* warranty, direct |
| **Freedom to build** | Boxed by a corporate partner's requirements | **None of that** — we ship what's right, today |
| **Real distribution today** | Sandbox PoC | **A live shop + 500-page footprint** funneling real leads now |

FieldPal can clone a screen in 30 days. It **cannot** clone eight years of repair outcomes,
a crew that feeds the machine, or the freedom to make the whole funnel one system. That's the
game.

---

## 3. The architecture — One Front Door, One Brain, One Record

```
  PHONE        SMS (AI 588-9500)     WEB FORMS        WARRANTY          QR / chat
  (Vapi)       + human 857-8800   (intake pages)   (AHS/ST/NSA email)   (future)
    \_______________|_________________|_________________|__________________/
                                      │
                         ┌────────────▼────────────┐
                         │   THE INTAKE BRAIN       │   ← one classifier, one context,
                         │  (classify · derive ·    │     one set of rules
                         │   pre-diagnose · route)  │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │   ONE JOB RECORD         │   ← job-truth spine: every channel
                         │  (single source of truth │     reads + writes the same record,
                         │   + one conversation)    │     lens-filtered per role
                         └────────────┬────────────┘
                                      │
        ┌──────────────┬─────────────┼──────────────┬───────────────┐
     BOOK/CLOSE     PRE-DIAGNOSE   ROUTE          NOTIFY          LEARN
    (schedule,     (Ant Brain →   (warranty/cash, (never-silent,  (grade the
     deposit,       part+conf)     tech/cluster)   zero-drop)      guess → moat)
     confirm)
```

**The five jobs of the intake** (every channel must do all five, or hand off cleanly):
**Capture → Diagnose → Book/Close → Route → Learn.**

---

## 4. Zero-Drop is Phase 0 — the non-negotiable foundation

You cannot call an intake "the best ever" if it drops leads. So the **first** work is the
lead-leak audit already in flight (2026-07-17), and its findings are the Phase-0 punch list.
Confirmed live at time of writing:

- **121 real jobs invisible on the board** (stuck in `needs_more_info`, which the board feed
  doesn't render) — jobs that can't be seen can't be finished, invoiced, or paid.
- **The customer-SMS intake gate** silently drops any customer text whose `context_tag` isn't
  allowlisted. `book-repair` was fixed 2026-07-17; latent senders (`parts_arrived_ack`,
  `instant_status_answer`, `satisfaction`, …) are being mapped so they never vanish when they
  fire.
- **Inbound-call + inbound-SMS dead-ends** (voicemail with no callback captured; a known
  customer texting the AI line getting neither an AI reply nor a reliably-caught human) — being
  traced.

**Zero-Drop guarantee (the standard we hold the system to):**
> Every inbound contact produces (a) a record, (b) a response within seconds, and (c) a next
> action that is owned by the system or a named human. If any of the three is missing, that's a
> P0 bug, not a nice-to-have.

A live **drop-watch** (already partly built: `lead-text-block-watch`, `board-audit`,
`accepted-not-scheduled-watch`) becomes the always-on immune system: any silent drop pages a
human within minutes. Target metric: **drop rate = 0.**

---

## 5. What already exists (we're ~80% there)

The bones of the best-ever intake are *already built*. The work is hardening + unifying, not
starting over:

- **Phone:** Vapi "Ant Inbound" — one unified assistant, audience detection, lookups, callback
  capture, multilingual.
- **SMS:** two-lane (AI 588-9500 books cold leads 24/7 · human 857-8800), inbound routing,
  translation bridge, opt-out compliance.
- **Web intake:** `appliance-ai.html` ($50 Quick Check — video + model pic → **OCR reads the
  model automatically**), `warranty-intake.html`, `vent-intake.html` ($80 pay-to-book),
  `book-repair.js` speed-to-lead text-back, `apartment-vent-inspection.html`, staged HVAC pages.
- **Warranty auto-intake:** AHS/SquareTrade/NSA dispatch emails → jobs, address backfill,
  auto-accept.
- **The brain + spine:** Ant Brain (`predict` / `grade` / `score` — the learning loop exists),
  `job-truth` unified lens (one record, four seats), `ant-spine.js` (cross-surface thread).
- **Media never-lost:** Cloudflare Stream video + proxy photo upload + finish-upload safety net.

**The gaps (what turns 80% into best-ever):** zero-drop hardening (Phase 0); one *truly*
unified intake brain (today the channels each have their own logic); self-closing on every
channel (booking + deposit/auth without a human); and the learning loop wired to *fire on every
job* so the moat compounds automatically.

---

## 6. The build plan (phased, each phase shippable)

- **Phase 0 — Zero-Drop.** Fix every leak the audit finds; stand up the always-on drop-watch.
  *Nothing enters the "best ever" conversation until a lead cannot fall through.* (In progress.)
- **Phase 1 — One Brain, One Record.** Every channel classifies + derives + writes through the
  *same* intake brain into the *same* job record. Kill per-channel divergence and double-entry.
- **Phase 2 — Self-Closing.** Every channel books, confirms, and takes the deposit (cash) or
  captures the authorization (warranty) with no human on the happy path. 24/7.
- **Phase 3 — Diagnose-at-the-Door + Learn.** Ant Brain fires a pre-diagnosis on *every* new
  job; every completion grades it; first-guess accuracy is a number on the wall that climbs.
  This is the moat FieldPal can't touch.
- **Phase 4 — Every Service Line.** One intake spine cleanly handles appliance + vent + HVAC +
  warranty, routing each to the right playbook, pricing, and crew.

---

## 7. The scorecard — how we know it's the best ever

Not vibes. Numbers on the wall:

- **Drop rate → 0** (the whole game)
- **Time-to-first-touch** (inbound → first response): seconds, any hour
- **Lead → booked %** (of real leads, how many self-book)
- **% self-booked** (booked with zero human touch)
- **First-visit-fix rate** (pre-diagnosis working → parts on the truck)
- **Inbound calls per 100 jobs** (friction proxy — falls as the intake gets better)
- **Ant Brain first-guess accuracy** (the moat, climbing monthly)

When those move, we're winning. When drop rate is zero and self-booked is high and first-guess
accuracy climbs every month, we've built the thing they wish they could.

---

## Changelog
- **2026-07-17 (v1):** Created. Sparked by the "best intake ever built / future of service
  intake" direction and the live lead-leak audit. Phase 0 = the audit findings.

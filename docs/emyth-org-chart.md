# TN Appliance Exchange — Org Chart & Position Contracts (E-Myth)

*Internal working document · v0.1 draft (2026-08-02) · edit freely as roles firm up*

Built the E-Myth way (Michael Gerber, *The E-Myth Revisited*): the company is
designed around the **work it must do**, not the people who happen to do it.
Every result the business must produce gets a **box**; every box gets an
**owner** and a written **standard**; the goal is a business that runs on
**systems**, not on Teddy — the Franchise Prototype / Turn-Key model
("systems run the business, people run the systems").

The rendered, theme-aware version is a private Artifact:
`https://claude.ai/code/artifact/e8bf4f40-935c-492c-97c7-257ef9930f6b`
(re-publish `scratchpad/emyth-org.html` to that URL to update it).

---

## Primary Aim (Teddy — DRAFT, his words)
> Build the most trusted, most advanced troubleshooting brain in appliance
> repair — so the business funds the family's freedom and carries Anthony's
> name, and runs whether or not I'm in the truck.

## Strategic Objective (DRAFT — the yardstick every position serves)
> A repair company where every job flows through Ant: pre-diagnosed, parts
> staged, scheduled, closed, and warranty-filed with no owner intervention —
> the model shop that becomes the product for every other shop.

---

## Status legend (the real story of each box)
- 🤖 **Automated** — Ant runs it
- 🤝 **Human + Ant** — Ant assists, a person decides
- 🧍 **Human** — still fully manual
- ⚠️ **Depends on Teddy** — single point of failure, design out first

---

## The Organization Chart

```
TIER 0 — OWNERSHIP
  Shareholder / Owner ............ Teddy (sets Primary Aim & Strategic Objective)
        │
TIER 1 — LEADERSHIP
  President / COO ⚠️ ............. Teddy today — the seat to design out first
        │
TIER 2 — the three jobs every business runs
  ┌───────────────────┬───────────────────┬───────────────────┐
  OPERATIONS          MARKETING           FINANCE
  ─ Field Repair 🧍    ─ Lead Gen 🤖        ─ Invoicing/Collections 🤝
    Jimmy·Andre·Lee·     Ant (SEO·social·     Office + Ant
    John·Teddy           GBP·ads)
  ─ Scheduling &      ─ Phones & Comms 🤝  ─ Payroll & Commissions 🤝
    Dispatch 🤝          Ann (AI)+human       Office + Ant + Alyse
    Danielle+Ant
  ─ Parts &           ─ Conversion/Intake 🤝 ─ Bookkeeping/P&L/Tax 🧍
    Inventory 🤖        Ant intake + office    Alyse + CPA
    Ant
  ─ Warranty          ─ Reputation/         ─ Vendor Payables 🧍
    Processing 🤝        Reviews 🤖            Office
    Danielle+Ant        Ant
  ─ Quality &
    Follow-up 🤖
    Ant
  └───────────────────┴───────────────────┴───────────────────┘
```

A name in a box is who wears that hat **today** — one person can wear several.
The status color is the point: how much of the box Ant already runs.

---

## Position Contracts

A position contract is not a job description — it's the **result** the seat is
accountable for, the **standard** it's measured against (E-Myth
"quantification"), and — unique to this shop — **how Ant takes it over** so the
box stops depending on a person.

### LEADERSHIP

**President / COO** — held by Teddy — ⚠️ Depends on Teddy
- *Accountable for:* the whole company hitting its weekly numbers without the owner touching every decision.
- *Standard:* weekly revenue vs target · first-visit-fix % · CSAT ≥ 4.7 · zero dropped jobs · cash green.
- *Key:* own the scoreboard and act on the one red number; approve the week's plan; keep every box staffed to standard.
- *Path to remove Teddy:* Ant's scorecards/watchdogs already surface the red number nightly. Promote a lead (or Ant) to run the weekly plan off those numbers so Teddy reviews an exception report. **#1 seat to design out.**

### OPERATIONS

**Field Repair Technician** — Jimmy, Andre, Lee, John (+ Teddy) — 🧍 Human
- *Accountable for:* appliance fixed right first visit, job documented before leaving.
- *Standard:* first-visit-fix % · complete TDR every stop · on-time route · CSAT/job.
- *Key:* run the route; diagnose/repair; file the TDR; offer honest add-ons + record declines.
- *Path:* hands stay human; Ant removes Teddy from *supporting* the tech (pre-diagnosis, part #+price, tech-sheets/recalls, talk-to-Ant scribe). Goal: every tech self-sufficient with Ant, zero owner phone-a-friend.

**Scheduling & Dispatch** — Danielle + Ant routing — 🤝 Human + Ant
- *Accountable for:* every ready job on the right tech's right day, routed tight, customer told what to expect.
- *Standard:* zero unscheduled ready jobs by EOD · zone-correct tech · ≤6 stops/day/tech · no wrong-day texts.
- *Key:* work the board, confirm/override Ant's suggested tech+day; fill route gaps; hold/confirm tentative slots.
- *Path:* already off Teddy. Ant cluster-suggests tech+day and warranty auto-routes. Next: auto-place routine, leave Danielle the exceptions.

**Parts & Inventory** — Ant (Marcone/ERP/Amazon) — 🤖 Automated
- *Accountable for:* right part identified, priced, sourced cheapest-reliable, on its way before the tech needs it.
- *Standard:* first-guess part accuracy · staged before visit · OEM→aftermarket→Amazon fallback · returns tracked (no chargebacks).
- *Key:* predict part from model+symptom, confirm live Marcone cost/stock; order to the door; log returns.
- *Path:* fully off Teddy. Open loops: **secure ERP aftermarket source** (Amazon = true last resort), reconcile Marcone net-cost field for exact pricing.

**Warranty Processing** — Danielle + Ant pre-fill — 🤝 Human + Ant
- *Accountable for:* every claim filed complete + fast, paid in full, parts returned.
- *Standard:* filed ≤24h of completion · $ paid vs billed · rejections chased · return labels closed on time.
- *Key:* submit claim from finished TDR (the TDR *is* the claim); track paid/pending/rejected; return supplied parts before chargeback window.
- *Path:* off Teddy. Ant pre-drafts on TDR submit + reconciles payments. Next: **auto-submit** the wizard/API claim, Danielle approves exceptions.

**Quality & Follow-up** — Ant — 🤖 Automated
- *Accountable for:* no job closes half-done; every finished customer checked on before problems become reviews.
- *Standard:* 100% TDR-complete before pay · 24h satisfaction check on every completion · 👎 caught privately, 👍 → reviews.
- *Key:* enforce TDR-completeness gate; fire 24h "how'd we do?"; flag callbacks/repeat-visit risk.
- *Path:* fully off Teddy — running agents, no owner touch.

### MARKETING

**Lead Generation** — Ant (SEO·social·GBP·ads) — 🤖 Automated
- *Accountable for:* steady qualified lead flow into intake at a known cost per booked job.
- *Standard:* leads/week by source · cost per booked job · pages indexed/ranking · map-pack position.
- *Key:* maintain the 13-language SEO/lander portfolio + GBP; post everywhere; run content + review-card engines; run ads profit-governed.
- *Path:* off Teddy for production; he stays in on strategy + spend approval (a weekly glance via self-reporting).

**Phones & Communications** — Ann (AI) + human line — 🤝 Human + Ant
- *Accountable for:* every call/text answered accurately 24/7; no caller leaves without the right answer or a callback.
- *Standard:* daily trust score · 0 false statements · 0 dropped lookups · after-hours captured · warranty reps → Danielle.
- *Key:* look up the real job record, tell the truth or take a callback; route to the right human in-hours; text intake links.
- *Path:* Ann answers 24/7 with no owner touch. Next: **Ann on text** with guardrails for known-customer texts.

**Conversion / Intake** — Ant intake + office — 🤝 Human + Ant
- *Accountable for:* every lead turned into a complete, scheduleable job (video, model #, address, availability, payment path).
- *Standard:* lead→booked % · % with media+model at intake · $50/$100 collected before schedule (self-pay).
- *Key:* run self-routing intake (warranty free / cash paid); capture video+model (OCR), availability, waiver; create clean job record + stamp source.
- *Path:* off Teddy — a page + agents; office handles shrinking exceptions.

**Reputation / Reviews** — Ant — 🤖 Automated
- *Accountable for:* rising public rating; every review answered in the shop's voice (the map-pack moat).
- *Standard:* review volume/week · average stars · reply rate · negatives caught privately first.
- *Key:* ask at the right moment; draft warm replies, flag negatives for a human; feed reviews into content.
- *Path:* off Teddy. Full auto-reply on positives when GBP API clears; negatives always get a human glance by design.

### FINANCE

**Invoicing & Collections** — Office + Ant (Stripe) — 🤝 Human + Ant
- *Accountable for:* every completed job invoiced correctly and paid; nothing slips unbilled/unpaid.
- *Standard:* days to invoice · % paid online · AR aging · zero completed-but-unbilled on the board.
- *Key:* log invoice (labor+parts+tax); text invoice + pay-now link, auto-mark paid; chase unpaid; never a warranty job to a pay screen.
- *Path:* Ant texts link + auto-marks paid + notifies. Next: auto-log invoice from finished TDR, office confirms.

**Payroll & Commissions** — Office + Ant + Alyse — 🤝 Human + Ant
- *Accountable for:* every tech paid the right commission on time on collected dollars — no re-keying, no disputes.
- *Standard:* pay accuracy vs invoices · paid 3rd & 18th · pay-on-collection honored · zero manual spreadsheet math.
- *Key:* compute per-tech commission from logged invoices; release warranty EFT payouts as they land; feed bookkeeping.
- *Path:* Ant computes owed vs paid off the invoice spine. Next: auto-notify + one-tap release, retire the spreadsheet.

**Bookkeeping / P&L / Tax** — Alyse + CPA — 🧍 Human
- *Accountable for:* clean books, honest P&L, taxes filed right and on time.
- *Standard:* reconciled monthly · P&L by the 10th · sales tax remitted per state (TN/LA) · CPA-ready at year end.
- *Key:* categorize income+expense (Digits), separate owner draw; track sales tax by state; hand CPA clean numbers.
- *Path:* already off Teddy → Alyse. Ant pushes income+margin+tax-collected into the ledger to lighten the close and retire the outside bookkeeper.

**Vendor Payables** — Office — 🧍 Human
- *Accountable for:* suppliers + recurring services paid on terms; no late fees, margin protected.
- *Standard:* bills paid within terms · part cost reconciled to job · no service interruptions.
- *Key:* pay Marcone/ERP/software/phone on terms; match part invoices to jobs (cost vs charged); flag margin drift.
- *Path:* least-automated finance box. Next: pull part costs into P&L from the parts ledger so payables self-reconcile, office approves.

---

## How to use this
This is the E-Myth **Organizational Strategy**: the chart is the org you're
building *toward*, and the position contracts define each seat's accountability
**before** you hire — the system defines the role, not the person.

**Read the colors as a to-do list.** Every 🧍 and ⚠️ is a box still leaning on a
person (most of all, Teddy). The work of the business is turning those into 🤝,
then 🤖 — one box at a time — until the model shop runs itself and becomes the
product every other shop buys.

*v0.1 draft — Primary Aim, Strategic Objective, and every "held by" are Teddy's
to edit. Names reflect current hats, August 2026.*

# Parts-In-Flight System — build spec (2026-07-10)

**One-liner:** every part heading toward a job — whoever sent it — gets listed on
that job automatically, tracked to arrival, and closed out with one tap from the
tech, so the crew never rolls up missing a part, we never eat a chargeback, and we
never leak a reimbursement.

Co-developed with Teddy on the road, 2026-07-10 (the night he saw a SquareTrade
stop that already had all its parts listed and said "can we do that on all of
them?"). This is the answer.

---

## The thesis — one problem, three feeders, two exits

It looks like three different things — SquareTrade ships parts, AHS ships some
parts, and soon *we* pre-order parts on Amazon — but it's the same problem every
time: **a part is in flight toward a job, and someone needs to know what it is,
where it is, and what happens to it.** One system, three feeders.

The **exit** is where the two warranty vendors split, and this is the backbone of
the whole design:

- **AHS = the markup machine.** AHS ships only ~20% of parts; we buy the other
  ~80% and they **pay us for them** (we mark them up within their allowed
  schedule). The risk here is a *silent one*: a part we install but never bill =
  pure money gone, and nobody notices a missing bill.
- **SquareTrade = the chargeback machine.** ST ships ~99% of the parts; our whole
  job is to **manage them and return the cores/unused ones.** The risk: an
  un-returned part = lost pay on the repair **and** a core charge.

Same parts flowing in. Opposite money mechanics on the way out. **The tech should
never have to know or care which is which** — he does one simple thing and Ant
routes the money underneath.

### Values that shape this (Teddy, 2026-07-10)
- We win on **volume through trust, not markup through gouging.** Save the warranty
  companies money + fix it right the first time → they send us more jobs. The
  markup on AHS parts is normal-and-fair, kept inside their schedule — not an
  Amazon-part-billed-at-OEM squeeze on every job. Transparency is the strategy.
- **It never benefits the tech to charge more for parts.** The tech's incentive is
  fixing it fast and right, not upselling. Keep it that way.
- **The trust bar is completeness + accuracy, not features.** The moment a tech
  catches the parts list being wrong once, he stops trusting it — and a
  half-trusted list is worse than none. Perfect = every part, every job, every
  time, or it's flagged, never silently dropped.

### Why now
AHS hasn't been impressed with us lately — we've got KPIs to climb back on. The
KPIs that matter are **first-visit-fix** and **turnaround**, and "every part on the
truck before the tech knocks" moves both directly. **Developing this system *is*
the path back into AHS's good graces**, not a side project from it. And the moment
the Amazon Ordering API goes to production, our own pre-orders become the third
feeder and this turns into a profit + speed engine on the self-bought parts too.

---

## Architecture

### The core object: one parts ledger per job
Every job carries a list of parts, each with:

| field | notes |
|---|---|
| source | `squaretrade` \| `ahs` \| `our_amazon` \| `our_marcone` |
| part_number | |
| description | |
| our_cost_cents | for parts we buy (null for vendor-shipped) |
| billed_cents / paid_cents | AHS branch — what we billed vs. what landed |
| claim / dispatch id | matching keys |
| tracking + carrier | inbound (to us) and, for ST, the return leg |
| eta | so "not here yet, ETA Thu" can render |
| status | see lifecycle below |
| disposition | `used` \| `returned` \| `not_needed` (tech's one tap) |

This is the single source of truth every surface reads: the tech's stop, the
office board, the warranty submission, the P&L.

### Feeders (intake)
1. **Vendor parts emails** — ST return-label emails (`rma_request@squaretrade.com`)
   and AHS parts-shipment emails. Already half-built: `squaretrade-rma-watch.js`
   parses ST's per-part return labels today. Generalize the same idea to AHS.
2. **Vendor APIs** — ServicePower (ST) and Frontdoor (AHS) can list authorized
   parts; cross-check against the emails so nothing's missed and duplicates
   collapse.
3. **Our own orders** — Amazon Ordering API + Marcone/mSupply order confirmations
   flow straight in the moment we pre-order (gated on Amazon going production).

### Parsing — read it, don't regex it
Vendor email templates drift; brittle pattern-matching is why it's "only some"
today. Have Ant **read the email like a person** and pull part #, description,
tracking, and claim off *any* layout. Template changes stop breaking us.

### Matching engine — this is what turns "some" into "all"
For each incoming part, attach to a job by the strongest signal available:
1. **Claim number** (primary — usually on the email).
2. Fall back to **customer name + address**, then **phone**, then **dispatch #**,
   then **model**.
3. **Orphan pool (the big unlock):** a part that can't find a job right now — most
   often because it arrived *before* the job exists in Ant — goes into a "parts
   looking for a job" pool instead of being dropped. **Every new/updated job
   re-runs matching against the pool**, so a part that lands Monday snaps onto a
   job that appears Wednesday.
4. **Human catch:** anything that still can't confidently match surfaces to the
   office as "this part came in — which job?" → one tap to assign. **Nothing is
   ever silently lost.** This is what makes the list trustworthy.

### Status lifecycle
`expected` → `ordered` → `shipped` (tracking) → `in_transit` (eta) → `arrived` →
`on_truck` → `used` | `returned` | `not_needed` → `closed`.

Plus an **"expected but not received"** flag derived from the dispatch/auth (we
often know parts are coming before they ship): tells the tech to hold, tells the
office to chase if it's late.

---

## The tech experience (the whole point)
On the stop, a **"Parts for this job"** panel:
- Every part, clearly: what's **here**, what's **still coming** (with ETA), what's
  missing.
- **One tap per part: "used it" or "sending it back."** That is the entire ask on
  the tech. No forms, no vendor codes, no thinking about markup or returns.

## Closeout routing (Ant does the money paperwork)
The tech's one tap routes by the part's source:

**AHS job — "used it":**
- Ant assembles the AHS parts bill (part #, our cost, marked-up price within their
  schedule), queues/submits it, then **watches for the reimbursement to land and
  reconciles it against what we billed.**
- Closes the leak: *a used part that never got billed = invisible lost money.*
  Every used AHS part gets billed and gets paid — unpaid ones flagged after N days.

**SquareTrade job — "sending it back":**
- Ant drops it onto the **return worklist** with the prepaid label + RMA it already
  captured, and **tracks the FedEx return to "delivered"** — that timestamp is the
  chargeback shield.
- Closes the leak: *an un-returned part = lost pay + core charge.* Every one tracked
  to delivered; anything past its return window not-yet-shipped gets screamed about.

**Our own part (Amazon/Marcone) — "not needed":**
- Route to restock (our inventory) or Amazon return, cost tracked, so a wrong/unused
  self-bought part is never a silent P&L hit.

## Scoreboards (both should trend to zero)
- **AHS: billed vs. paid** — anything billed-not-paid is margin walking out the door.
- **SquareTrade: owed-back vs. confirmed-delivered** — anything owed-not-returned is
  a pending chargeback.
- **Our money at risk** — self-bought parts unused and not yet returned/restocked.

---

## Build order
1. **Matching foundation** (highest leverage — this is "some → all"): smart-read
   parsing + claim-first-with-fallback matching + the **orphan re-match pool** +
   the office one-tap "which job?" catch. Everything else bolts onto a complete,
   trusted parts list.
2. **AHS email feeder** — generalize `squaretrade-rma-watch` to read AHS
   parts-shipment emails into the same ledger.
3. **Tech panel + one-tap disposition** — the "Parts for this job" card with
   used/return; wire to the existing `tech-job.html` parts card.
4. **ST return closeout** — return worklist + FedEx-to-delivered tracking + past-
   window alerts (extends the existing RMA tracker + chargeback-killer work).
5. **AHS bill + reimbursement reconcile** — build/submit the parts bill, track EFT,
   flag unpaid.
6. **Our-order feeder + pre-order from Teddy Tool** — Amazon (once production) +
   Marcone confirmations auto-list; pre-diagnosis fires the order. **Gated on the
   Amazon Ordering API going production.**
7. **Scoreboards** — billed-vs-paid, owed-vs-delivered, money-at-risk.

## Reuse (much of this already exists — this connects + hardens it)
- `squaretrade-rma-watch.js` — ST per-part return-label parser (the seed of #1/#2).
- `warranty-parts.js` + `warranty-review.html` — supplied-parts display + write-in.
- `tech-job.html` "📦 Parts for this job" card + returns workflow (used/return/not-here).
- Marcone/mSupply connector (`_lib/msupply.js`), Amazon connector
  (`_lib/amazon-business.js`), ServicePower + Frontdoor connectors.
- The money-system parts work (cost-vs-charged, `parts_orders` ledger, Danielle's
  cost÷.75 rule).

## Dependencies / open items
- **Amazon Ordering API → production** is the keystone for the pre-order feeder
  (feeder #3) and the whole "fire it off the Teddy Tool" pre-diagnosis flow. Parked
  on Amazon promoting the SPP app Sandbox→Production + a current default card.
- **Frontdoor/AHS API** (Brian) — clears the AHS email dependency for feeder #1/#2
  and enables status push; still waiting on sandbox key authorization.
- Confirm the exact identifiers reliably printed on AHS + ST parts emails (claim #
  confirmed "usually" present — fallbacks cover the rest).

## The flywheel (why this compounds into a moat)
Every completed job ties a part-in-flight to an outcome ("this model + this symptom
→ this part actually fixed it, and this part got returned unused"). Enough of those
and Ant learns **which part to pre-order** (stop wasting our own money on wrong
guesses) and **which parts are safe-aftermarket vs. must-be-OEM** (stop cheaping out
on the ones that come back). More volume → more outcomes → sharper predictions →
faster + cheaper → more volume. The relationship, the margin protection, and the
moat are all the same flywheel.

## What "done" feels like
Teddy walks up to *every* stop — SquareTrade or AHS — and the parts are already
listed, right, and complete. The tech taps used/return and drives on. The returns
send themselves. The AHS bills send themselves and get paid. Nobody re-keys
anything, nothing's sloppy, and no money leaks out the back. The parts headache
stops being a job and becomes a byproduct of the crew doing good work.

# Payment strategy — one durable link, simple to send (plan, 2026-08-05)

**Teddy 2026-08-05:** "The current payment setup is sloppy, hard to execute, and expires —
I want simple and easy to send." This is the plan to get there. Design first (it's money
code); build in phases with a $1 test before anything touches real customers.

## The problem (today)
- Links are **Stripe *Checkout Sessions* (`cs_live_…`) that expire in 24h.** A customer who
  pays later hits a dead link (Jennifer Roher — wanted to pay, links expired).
- They're **ugly + hard to send**: a giant raw `checkout.stripe.com/…` URL, generated ad hoc
  from four different places (tech add-on card, office invoice worksheet, customer portal,
  manual Teddy text), **one link per add-on** (two $50s instead of one $100).
- **No single "what this customer owes."** No stable place to resend. No re-pay if lost.

## The north star (two properties)
1. **DURABLE** — the link never expires. Send once; they pay tonight, this weekend, whenever.
2. **SIMPLE** — one tap to send from anywhere; one clean branded page for the customer; card
   or Apple Pay; itemized total; a receipt after.

## The core idea (this is what kills expiry)
**Stop texting the customer a Stripe link. Text them a stable link to OUR page.**

`tnapplianceexchange.net/pay?job=<id>&t=<token>` →
- **Never expires** (it's just a URL to our page).
- Shows **what they owe, itemized** (labor · parts · add-ons · tax · minus already-paid),
  branded, plain-English.
- **"Pay Now" mints a FRESH Stripe Checkout session the instant they tap** (card + Apple Pay).
  So the session is always brand-new — the customer never sees an expired anything.
- **Same URL every time** — resending is trivial and idempotent; they can bookmark it.
- After paying → "Paid ✓" + downloadable receipt; board flips to paid; office + tech texted.

This sidesteps the whole expiry problem AND the Stripe-Payment-Links complexity: the durable
thing is *our page*, and the Stripe session is generated on demand, so it's always fresh.

## What we REUSE (this is mostly connecting, not rebuilding)
- `create-stripe-payment-link.js` — the session minter (already computes tax; warranty-safe).
- `verify-payment.js` + `stripe-payment-webhook.js` + `_lib/record-payment.js` — records the
  payment, fulfills add-ons, marks the board paid, texts office/tech. **Works today.**
- `customer-portal.html` (partial pay UI) + `pay-thanks.html` (success) — starting points.
- The board invoice worksheet, add-on cards, tip jar — the amount sources.

## What we BUILD (the thin new layer)
1. **`pay.html`** — the one branded pay page. Reads `?job=&t=`, shows the itemized total,
   "Pay Now" (fresh session on tap), "Paid ✓" + receipt when done. Never expires.
2. **A server "what's owed" resolver** — one endpoint that returns the job's real balance:
   cash/self-pay = labor+parts+tax from the invoice; warranty = the out-of-pocket add-ons;
   minus anything already paid. Single source of truth = one number, itemized.
3. **A tokenized short link** — `?job=&t=<token>` (token = the same tokenization the portal
   already uses, so it's shareable but not guessable). No new table needed for v1.
4. **One "💳 Send pay link" button, everywhere** — office board drawer, tech job page — that
   texts the customer the SAME short pay link. Retire the raw-checkout-URL texts.

## Warranty safety (unchanged, non-negotiable)
The page charges **out-of-pocket only** — add-ons on a warranty job, or the full invoice on a
cash job. It **never** charges a covered warranty repair. (Same guard `create-stripe-payment-
link` already enforces: `kind:'invoice'` refuses warranty; add-ons are out-of-pocket.)

## Phased build (each phase testable, money-safe)
- **Phase 1 — the pay page + resolver.** Build `pay.html` + the "what's owed" endpoint.
  Verify with a $1 test job end-to-end: open page → pay → records → board flips paid → receipt.
- **Phase 2 — one-tap send.** Add "💳 Send pay link" to the office drawer + tech job page;
  texts the short pay link. Prove resend = same URL, no regeneration.
- **Phase 3 — make it THE way.** Point the AI/office payment texts at the pay link; retire the
  ad-hoc raw-checkout-URL sends. Add "pay all add-ons as one total" (kills the per-$50 problem).
- **Phase 4 — polish.** Bookmarkable receipt, "you still owe $X" gentle reminder for unpaid
  balances (opt-in), Apple-Pay-first layout, partial payments if ever needed.

## Decisions to lock before Phase 1
1. **Link shape:** `pay?job=X&t=token` (no new table, ship now) vs a pretty short code
   `/p/AB12` (needs a code→job map). → Recommend `pay?job=X&t=token` for v1.
2. **One consolidated total per job** (labor+parts+add-ons+tax, minus paid) — yes? → Recommend yes.
3. **Durable mechanism:** the page-mints-fresh-session pattern (recommended — simplest/safest)
   vs the gated Stripe *Payment Links* I built today (keep as a fallback option, not the default).
4. **Retire the old sends** once the pay link is proven, or leave them as backup? → Recommend
   retire the raw-URL texts; keep the underlying minter.

## Open questions for Teddy
- Should the pay page also show the **job/repair summary** (what we did) so it doubles as the
  invoice/receipt the customer keeps? (Leans toward the "Quote → Invoice → Receipt one-doc"
  vision already in CLAUDE.md.)
- **Tips** — surface the tip-jar on the pay page too, or keep separate?
- **Deposits / partial pay** (e.g. in-home $100 deposit) — in scope now or later?

## The one-liner
*The customer gets one short TN Appliance link that never dies; they tap it whenever, see what
they owe, pay with a thumb, and get a receipt — and we send that same link with one tap from
anywhere.*

# The Drop-Ship Store — ready-to-fire plan (waiting on Amazon Business Ordering API)

**Status:** PLAN ONLY — nothing live. **Trigger to execute:** Amazon Business Ordering API
**production authorization** lands (the pending approval; `amazon-api-watch` is armed to text
Teddy when the email arrives; nudge sent — `docs/amazon-api-nudge-2026-07-17.md`).

**One-line vision (Teddy, 2026-07-18, lake brainstorm):** turn the 1,300-page SEO site from a
lead funnel into *a store too*. A visitor on "Samsung dryer not heating" (or the dryer-vent
pages) can **buy the exact part / a vent kit right there** — we upcharge it, the distributor
drop-ships it to their door, and **we never talk to them or touch a box.** Local repair stays
2 states; **parts + kits ship to all 50.** "Probably sell a million parts."

---

## The model (Teddy's, verbatim intent)
Sell on **our** site at **our** price → we place the order with the supplier → **supplier
drop-ships straight to the customer** → we keep the spread. Zero inventory, zero fulfillment,
zero phone calls. Better than affiliate: **we own the customer + set the price** (affiliate =
pennies + Amazon owns the buyer).

- **Margin:** Danielle's rule — **cost ÷ 0.75** (~25% on top) at $30+, cost + $10 under $30,
  plus a flat shipping line. Already the pricing logic in the cash-parts flow.
- **The customer never learns the part number until they've bought it** (standing rule — no
  side-shopping). The page sells the *diagnosis + confidence*, then the part.

---

## What's ALREADY built (this is wiring, not a from-scratch build)
The cash-TDR "ship-you-the-part" work already stood up the whole drop-ship spine:
- **Amazon Business connector** — `_lib/amazon-business.js`, `amazon-business-order.js`
  (real `placeOrder` **ship-to-customer**, TrialMode-safe, env-gated `AMAZON_BUSINESS_ENV`
  default sandbox so no real order can fire). Auth **proven in sandbox**; only prod
  authorization missing. `amazon-business-test.js` verifies.
- **Marcone / mSupply drop-ship** — LIVE + proven (real order #74992380, ship-from nearest
  branch, ship-to customer). A second live drop-ship source *today* (see Phase 1 shortcut).
- **Checkout** — Stripe live (`create-stripe-payment-link.js`, `verify-payment.js`,
  `stripe-payment-webhook.js` + `_lib/record-payment.js` idempotent-by-session).
- **Order pipeline** — `create-parts-order.js` → `parts_orders` table (supplier-tagged,
  ship-to-customer address, `order_status:'to_order'`) → office To-Order board
  (`parts-orders.html`) → the Amazon "order via Business API" button.
- **The catalog brain** — Ant Brain predict-the-part (`ant-brain-predict.js`) + Marcone live
  cost/stock lookup + model# OCR → resolves **model → exact part**.
- **The pages** — 1,300 SEO landers + the `/fix/` authority pages (HowTo/FAQ schema) already
  rank + explain the repair. GSC connected (`gsc-queries.js`) to find which pages actually
  get impressions.
- **The auto-placer gap** — the one loop-closer: a paid + ship-to-customer + not-yet-placed
  `parts_orders` row should auto-fire the supplier order with NO human. Designed, not fully
  built (Path A Netlify auto-placer; route around the `part_number:"TBD"` seam bug).

**Net:** ~80% of the plumbing exists. The Amazon prod approval + the auto-placer + the
buy-widget on the pages are the remaining pieces.

---

## PHASE 0 — the moment the API clears (go-live checklist, ~1 day)
1. **Vault the prod creds** (via `admin-secrets.html`): `GROUP_ID`, `BUYER_EMAIL`,
   `PAYMENT_REF` (+ prod LWA creds if new). Then flip **`AMAZON_BUSINESS_ENV=production`**.
2. **Prove it safe:** run `amazon-business-test?env=production&order=1&real=1` in **TrialMode**
   (validates, buys nothing) until it returns 200 on real data.
3. **One real low-cost test order** shipped to a known address (a vent kit — cheap). Confirm
   it lands.
4. **Wire the auto-placer** (Netlify scheduled fn): watch PAID + ship-to-customer + not-placed
   `parts_orders`, fire `amazon-business-order` / `marcone-order place`, idempotent + logged +
   kill switch. Route around the `TBD` part-number seam (read the resolved part off the row).
5. **Launch the buy-widget on the first N pages** (Phase 1).

## PHASE 1 — Vent kits first (easiest, safest, universal) — can partly start pre-API via Marcone
Why first: **no model-number matching** (one rotary-brush kit fits ~every dryer), **impulse
price** ($15–40), **huge search volume** ("dryer vent cleaning kit"), **zero danger** (no gas/
240V/refrigerant → no safety gate needed). The frictionless proof of the whole thesis.
- **Source it:** check if **Marcone stocks a vent kit** → if yes, live TODAY on the existing
  drop-ship pipe (no Amazon wait). Else it's an Amazon-API SKU at go-live.
- **Where:** `dryer-vent-cleaning.html` + `property-management.html` +
  `apartment-appliance-repair.html` + the dryer-vent city pages. A clean **"🧹 DIY vent kit —
  buy now, ships to your door"** card at our price.
- **The flywheel (don't undercut the service):** the kit cleans the *vent* but **can't open
  the dryer** where lint really packs up. So the same card says: *"Great for the vent. For the
  full job — the part the kit can't reach — we'll do it right, and we price-match."* Product
  sale + service upsell reinforce each other and *prove* the "we open the dryer, they won't"
  line. The kit buyer is also a warm future lead.

## PHASE 2 — Repair parts on the symptom pages (the "million parts" engine)
- **Where:** the ranking symptom+brand pages ("Samsung dryer not heating", etc.) + `/fix/`.
- **The widget:** *"Tell me your model number → I'll find your exact part."* Model# → Ant
  Brain / Marcone resolves the specific part → live price → **Buy now** → Stripe → drop-ship.
  The model# gate is what **kills wrong-part returns** (the #1 DIY-parts margin killer) AND is
  the transparency brand made literal.
- **Explanation on every page:** honest how-it-works + which of the likely parts + a safe
  self-test (the `/fix/` authority content — also compounds SEO).

## PHASE 3 — Scale + own it
- **Branded "TN Appliance" vent kit** (private-label / FBA): full margin, we own the customer,
  and **every kit is our logo in a home nationwide** with an insert card — *"scan to book ·
  leave a review · we answer 24/7."* Brand-building that pays for itself. A real L3 product.
- **Roll the buy-widget to every ranking page**, expand the part corpus, add accessory SKUs
  (hoses, filters, coil brushes, anti-tip kits — many already priced in `ant-addons.js`).

---

## Safety gates + honest edges (bake in from day 1)
- **Danger gate:** gas, 240V, sealed-system/refrigerant, anything unsafe → the page says
  **"this one needs a pro,"** no DIY buy. Protects people + us. TOS "educational, not
  professional advice" (see `docs/consumer-platform-*`). Vent kits + most swaps are safe.
- **Wrong-part mitigation:** the model# gate + "not sure? our AI confirms your exact part
  free" before checkout. A clear return policy (drop-ship returns eat margin — minimize buys
  of the wrong thing up front).
- **Target the pages that RANK first.** ~800 of the 1,300 landers get ~0 impressions (thin
  doorway pages). Pull GSC → launch on the top ~50 that actually get traffic → "a million
  parts" becomes a measured number, not a guess. National reach is the real multiplier.
- **Price competition** (Amazon/PartSelect/RepairClinic sell the same parts): we win on
  **capturing the click at the moment of intent** (we're the page that ranks + explains +
  hands them the exact part), not on being cheapest. We drop-ship too, so we can stay
  competitive.

## The moat angle
Every part/kit sold + every "did that fix it?" follow-up **trains the symptom→part engine**
(Ant Brain) — so the thing that makes money is the same thing that deepens the moat a ChatGPT
copycat can't clone. The store *is* the data flywheel.

## Metrics to watch at launch
Click-to-buy conversion per page · avg margin/order · wrong-part return rate · which pages
convert · attach rate of service upsell on vent pages · repeat buyers.

## Open decisions for Teddy (no rush — for when we build)
1. **Branded kit vs pure drop-ship** to start — nickel machine vs national brand play.
2. **Marcone vent-kit shortcut** — do we launch vent kits pre-API if Marcone stocks one?
   (I can check their catalog when you want.)
3. Which page set goes first (recommend: top GSC-impression dryer-vent + a handful of
   high-traffic symptom pages).

---
*Reconcile the winning pieces of this into `docs/ant-operating-plan.md` (L3 consumer layer)
once we commit to building — this is the consumer platform seeded on ranked real estate we
already own, funded by nothing extra.*

**Changelog:** v1 — 2026-07-18, lake brainstorm (Teddy). Plan captured; awaiting Amazon
Business Ordering API production approval to execute Phase 0.

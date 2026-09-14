# TN Appliance / Ant — briefing for a Claude Project

*Upload this file to a Claude Project's knowledge base. It is the durable picture of the
business, not a changelog. Re-upload every few weeks as things change.*

Last updated: 2026-09-14

---

## Who you're talking to

**James "Teddy" Pivacek** — owner of **TN Appliance Exchange LLC** (Antioch, TN, est. 2012,
family-owned). He is a working appliance technician, not a desk operator: he runs jobs, does
pre-diagnosis for the crew, and builds the software. Talk to him like a colleague who's caught
up, not like a consultant.

The company's AI assistant is named **Ant** — after Teddy's son **Anthony**. That name carries
weight; it is not a cute product name.

**Alyse** is Teddy's wife and handles the books.

---

## The business

- **~95% of work is warranty**, dispatched by home-warranty companies. Roughly:
  **SquareTrade/Allstate 60% · AHS/Frontdoor 27% · NSA 13%.**
- The remaining slice is **cash / self-pay**, which is the growth direction — it's the only
  work where the shop controls price, speed, and the customer relationship end to end.
- **Two states.** Middle Tennessee (Nashville metro, Clarksville, Murfreesboro) and Louisiana
  (North Shore / Baton Rouge and New Orleans / South Shore).
- **4.5★ across ~1,100 Google reviews.** Licensed, insured, Google Guaranteed.
- Warranty work pays flat per job and is dispatched to us; cash work has to be *earned* through
  phones, ads, the map pack, and reputation.

### The crew

| Who | Role | Area |
|---|---|---|
| Teddy | Owner + tech | Antioch TN |
| Jimmy Pivacek | Tech | South Nashville |
| Andre Pivacek | Tech | South Shore LA (NOLA, Metairie, Kenner, Gretna) |
| Lee Harding | Tech | Clarksville TN |
| John Houk | Tech | North Shore LA + Baton Rouge |
| Danielle | Office / dispatch | — |
| Sofia | Office | — |
| Carrie | Office | — |

(Billy Savoy left the company. Do not reference him as crew.)

---

## The three-layer arc (the actual strategy)

1. **Layer 1 — TN Appliance is the proving ground.** Every feature earns its keep on a real
   shop with real techs and real money before it ships to anyone else.
2. **Layer 2 — Ant as SaaS for other shops.** Multi-tenant platform: a shop signs up, gets its
   own AI phone receptionist, office board, tech app, customer portal, and can import its book
   from Housecall Pro / Jobber / Workiz. This is live and sellable today.
3. **Layer 3 — the consumer platform.** A homeowner photographs a broken appliance and gets an
   honest answer: DIY it (here's the part, shipped), or here's a vetted pro. Much larger TAM;
   deliberately *not* being chased yet.

The canonical long-form plan lives in the repo at `docs/ant-operating-plan.md`.

### The north star above everything

> "The most powerful troubleshooting brain is what's gonna dominate this market. My goal is to
> be that most advanced troubleshooting brain." — Teddy

The moat is knowledge nobody else has: ~49k archived Housecall Pro jobs, every technician report
the crew closes, and the deepest fault-code / part-number library in the trade. **Improve the
repair knowledge base every day.** Anything that makes the diagnostic brain deeper, more
grounded, or more reliable wins over anything that doesn't.

---

## Two systems — know which one is being discussed

| | **Xano** (old) | **Supabase** (new) |
|---|---|---|
| What it is | The legacy system the shop ran on for years | The multi-tenant Ant platform |
| Status | Being retired; kept as a backup during cutover | **As of 2026-09-14, all stops run here** |
| Who uses it | Fading | Techs, office, customers |

The cutover to 100% Supabase started 2026-09-14. All six crew members have working logins.
Techs land on a tech app; office lands on a kanban board; the owner has a money/ops view;
customers get a tokenized portal with their job status and a two-way text thread.

---

## Standing rules — these are non-negotiable

These exist because each one was learned the hard way.

1. **No proactive customer texts.** Don't text unless texted first. The exceptions are narrow
   and explicitly approved: warranty/cash intake links, availability asks, appointment
   confirmations, review requests. An automated system that starts messaging people is the
   single fastest way to lose trust.
2. **Never share Teddy's personal cell** with a customer, a tech, or in any message body.
   Customer-facing numbers only.
3. **Never share part numbers with customers.** It invites side-shopping. The shop sells the
   part; the customer picks a tier.
4. **Warranty customers never see a payment screen.** Ever. Out-of-pocket add-ons are separate.
5. **Schedule by DAY, not by clock time.** The shop runs routed days. Customers get "you're one
   of Jimmy's stops Thursday, we text a live window that morning" — never "we'll be there at 10."
   Promising a time means either the customer waits or we're late.
6. **Never gate must-have intake media (video, model-number photo) behind a payment.**
   Capture first, charge second.
7. **Danielle owns the live schedule board.** Automation assists; it doesn't overrule her.

---

## The parts pricing model

Cash customers get **four honest options**, always shown side by side, never with a
recommendation:

|  | OEM part | Aftermarket / Amazon-equivalent |
|---|---|---|
| **You install** | $ | $ |
| **We install** | $ + labor | $ + labor |

All four require the part purchased through us. We do not price-match; we set our own prices on
both tiers. Warranty defaults: 90 days on OEM, 30 on aftermarket.

The positioning matters: most shops in the trade shame customers who price-shop Amazon. **We
don't.** Transparency is the strategy, not a weakness. Their loss is our gain.

Labor is priced **flat per job** (calibrated to roughly $100/hr equivalent), not hourly. Parts
are marked up cost ÷ 0.75 at $30+, or cost + $10 below that.

---

## What's already built (so you don't propose it again)

- **AI phone receptionist** that recognizes the caller before they speak, reads their real job
  status off the database, books a day, takes a callback, texts a link, or transfers to a human
  during business hours.
- **Office board** — kanban by tech, drag to move, invoice worksheet, full customer text thread.
- **Tech app** — the day's route, per-machine reports, photos, parts, pay tracking.
- **Customer portal** — status, two-way messaging, pay by card, request a day.
- **Warranty automation** — dispatch emails parse into jobs automatically for all three vendors;
  claims file through the ServicePower API; parts-return obligations are tracked so the shop
  isn't charged back.
- **Marketing engine** — Google Ads, Local Services Ads, Google Business Profile auto-posting,
  review requests, ~1,300 SEO pages.
- **Books** — connected accounting, per-tech commission, sales tax by state, owner P&L.

---

## Open questions worth thinking through in a Project

These are decisions, not code. This is exactly what a Project is for.

1. **The reseller deal with TK Cousins** — commission percentage and duration are still unset.
   He refers appliance shops; the platform IP stays Teddy's.
2. **ERP (Exact Replacement Parts) distributor account** — they want a $20,000/yr purchase
   commitment and stocked inventory, which cuts against the per-job drop-ship model.
3. **Where the next advertising dollar goes.** Local Services Ads runs about $17 per lead and is
   at ~8% of its budget ceiling; search runs about $105 per ringing phone and is at capacity.
4. **Whether to pursue a home-warranty white-label deal.** Teddy has real relationships with AHS
   / Frontdoor. Licensing Ant to a warranty company is the largest single revenue lever on the
   table and has never been formally pitched.
5. **The towing business** for Teddy's sister Melissa — same platform, different trade.
6. **Replacing the bookkeeper.** The accounting automation is far enough along that Alyse could
   likely take it over with a CPA for filings.

---

## How to be useful to him

- **Lead with the decision, not the options survey.** He moves fast and will tell you if he
  disagrees.
- **Be honest about what a number actually says.** He would rather hear "that's a 30-day average
  that hides a fix you already made" than a clean-sounding wrong answer.
- **Segment before you conclude.** Trailing averages, raw row counts, and vendor-reported totals
  have all misled decisions here before.
- **Don't confuse activity with outcome.** "8 conversions" that are all *phones ringing* is not
  8 booked jobs.
- He works long days in the field and builds at night. Respect that the time is real.

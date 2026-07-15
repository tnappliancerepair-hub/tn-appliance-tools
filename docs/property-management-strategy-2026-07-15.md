# Property Management — Go-To-Market Strategy (2026-07-15)

**Why this is the biggest near-term growth lever.** One property management (PM) company
= dozens to hundreds of recurring work orders a year, on a relationship instead of a
one-time search. It's the opposite of chasing individual homeowners through ads: land one
PM account and you get a steady, predictable stream of jobs at a low cost of acquisition,
for years. Marshall Reddick Real Estate alone (~3,000 units nationally, 200+ in Nashville,
TN offices in Nashville/Clarksville/Brentwood — job #20436 was our foot in the door) is the
proof this is real.

**The unfair advantage we already have:** every other local shop treats a PM like another
homeowner — phone tag, one-off invoices, no visibility. We have the *tech* (Ant) to serve a
PM like a national vendor: direct tenant texting, a portfolio work-order portal, and
consolidated billing. That's a moat a two-truck shop can't copy.

---

## 1. Positioning — the pitch in one line

**"You manage doors. We keep the appliances running."**

One vendor for the whole portfolio: we text the tenant directly, coordinate access, fix it
right, and you see every work order in one portal with one monthly statement. We take the
appliance headache — and the phone tag — completely off the PM's plate.

The three things a PM actually buys (in priority order):
1. **Reliability + speed** — a broken appliance is a turn risk / renewal risk / habitability
   issue. They need it handled fast and handled right (no callbacks).
2. **Less work for their team** — they do NOT want to be the middleman between tenant and
   vendor, and they hate processing one-off vendor invoices.
3. **Visibility + clean books** — status they can see, invoices itemized by property/unit for
   owner reports.

We win on all three. Price matters but is rarely #1 for a PM — trust and low-hassle win.

---

## 2. Who to target (the account list)

Tiered by size — the sales motion differs by tier.

- **Tier A — Regional/large PMs (100–2,000+ units):** Marshall Reddick, Evernest, Mynd,
  Real Property Management franchises, Browning-Gordon, Vintage/Ghertner (Nashville),
  Wright/1st Lake/etc (LA). These want net terms + a real account. Land via relationship +
  a formal preferred-vendor conversation. Highest value, longest sales cycle.
- **Tier B — Independent PMs + small firms (25–150 units):** the sweet spot. Fast to close,
  loyal, and perfect for **card-on-file auto-billing** (they love no-invoice simplicity).
  There are dozens in Middle TN + greater New Orleans.
- **Tier C — Individual landlords / small investors (1–20 units):** high volume, easy yes,
  card-on-file, self-serve. Feed them from the same page + ads.

**Build the list:** pull PM companies from Google Maps ("property management <city>"), the
local NARPM chapter roster, Zillow/Apartments.com "managed by" fields, and BiggerPockets.
Aim for a working list of 60–100 Middle-TN + greater-NOLA PMs to work through.

---

## 3. How we reach them (advertising + outreach)

PMs are found through **relationships and direct outreach first, ads second.** B2B via ads
alone is inefficient — but a great landing page + targeted search makes every touch convert.

### a) Direct outreach (the #1 channel — highest ROI)
- **Warm-lead now:** finish Marshall Reddick #20436 flawlessly, then ask for the
  preferred-vendor conversation with their maintenance coordinator. One reference account
  unlocks the pitch to everyone else.
- **Cold outreach sequence** to the account list: short email → the `/property-management`
  page → a 10-minute call. Angle: "one vendor for your whole portfolio, we handle the tenant,
  you get a portal + one monthly bill." Follow with a LinkedIn touch to the maintenance/ops
  lead.
- **In-person / associations:** join/attend the **NARPM** (National Association of
  Residential Property Managers) local chapter — that room *is* the customer base. Also local
  apartment associations + REIA meetups.
- **Referrals:** every happy PM knows other PMs. Build a simple referral incentive.

### b) Advertising (supporting layer, points at the page)
- **Google Search campaign, PM-intent keywords** → Final URL `/property-management`:
  "appliance repair vendor for property management", "property management appliance repair
  <city>", "rental appliance repair contractor", "multi-unit appliance repair", "preferred
  appliance vendor property manager". Low volume but *extremely* high intent — a click here is
  worth many homeowner clicks. Small daily budget, exact/phrase match, tight negatives.
- **Retargeting:** anyone who hits `/property-management` but doesn't submit → follow them with
  display/LinkedIn retargeting (they're a decision-maker who looked).
- **LinkedIn (later):** sponsored/targeted at job titles "Property Manager / Maintenance
  Coordinator / Director of Operations" at PM companies in our metros. The cleanest B2B
  targeting that exists — but pricier; start after the page + Search prove out.
- **LSA / homeowner ads = NOT for PMs** (consumer product). Keep those separate.
- **Conversion tracking:** the page fires a `generate_lead` GA event on submit; wire that as a
  Google Ads conversion so we optimize to actual PM inquiries, not clicks.

**Recommended ad start:** one Search campaign, ~$15–25/day, PM keywords → the page.
Watch cost-per-inquiry; scale only what converts. Real money still goes into outreach.

---

## 4. Billing — card-on-file + net terms (Teddy's idea, built out)

Offer **two payment tracks** and let the account's size pick:

### Track 1 — Card on file (default for Tier B + C, the growth engine)
- PM saves a card once (Stripe saved payment method, per PM account — Stripe already live).
- **On job completion, we auto-charge the card** and email a receipt. Tech gets paid on
  collection; zero invoices for the PM to process; zero collections for us. Everybody wins.
- **Approval guardrail:** auto-charge up to a per-job threshold the PM sets (e.g. $250). Above
  it, we text/email the diagnosis + cost, they tap approve, *then* we proceed + charge. PMs
  keep spend control on big repairs, which is exactly what they want.
- This is a genuine differentiator — most vendors make the PM cut a check per job. "Put a card
  on file and never process another appliance invoice" is a strong closing line.

### Track 2 — Net terms + monthly statement (for Tier A / institutional)
- Big PMs won't put a card down — they run AP on net-15/30. Give them a **single consolidated
  monthly statement**, itemized by property + unit, downloadable from the portal.
- Guard our cash flow: pay the tech commission **on collection** (not on completion) so a
  net-30 account doesn't have us fronting labor — this rule already exists in the plan.
- Optional: require a card on file as a backstop even on net terms (charge if a statement ages
  past terms).

### What to build (mostly assembling pieces we already have)
- Stripe **customer + saved payment method per PM account** (Stripe is live; add the vault of
  a PM's Stripe customer id).
- **PM account record** (company, billing track, per-job approval threshold, contacts,
  properties). We already have `bill_to_customer_id` + `on_site_contact_id` on jobs — the PM is
  `bill_to`, the tenant is `on_site_contact`.
- **Approval-to-charge flow:** completion → if over threshold, send the PM a one-tap approve
  link → on approve, Stripe-charge the saved card (or add to the statement).
- **Monthly statement generator** for net-terms accounts (consolidate the month's work orders).

---

## 5. Pricing / the offer

- **Preferred-vendor flat rates** by repair type (we already have the flat-rate menu) — a PM
  wants predictable numbers, not a mystery quote. Publish a simple rate sheet per account.
- **Trip/diagnostic:** waive or discount the diagnostic for account holders (volume earns it);
  roll it into the repair like retail.
- **Tenant pays nothing** — PM/owner pays. Tenant self-service surfaces show **no prices**
  (tenant only gets the intake link + scheduling). Prices live on the PM side only.
- **Repair-vs-replace** honesty is part of the pitch — it protects the owner's budget and is
  why they trust us with the next 50 units.

---

## 6. Ops — how a PM job flows (must be flawless)

1. Work order in (PM email/portal, or tenant forwarded to our line).
2. Ant texts the **tenant** (on_site_contact): confirm issue, model #, short video, schedule a
   day. PM stays out of it.
3. Tech diagnoses → honest repair/replace call → (over threshold?) PM approves → repair.
4. Close out: photos + tech notes + invoice land in the **PM portal**; charge the card or add
   to the statement.
5. PM sees it done. Nobody chased anybody.

**SLA promise to sell:** same-day response, day-of tenant contact, and a live status portal.
Track our first-visit-fix rate + response time per account — that's what renews the contract.

---

## 7. The portal (the lock-in / moat)

A **company-level portfolio portal**: every work order across every property in real time,
filter by property/unit/status, open any job for photos + report + invoice, export for owner
reports, download statements. This is the thing a normal shop can't offer and the reason a PM
consolidates all their doors to us. Build on the existing office board + customer portal:
a PM login scoped to `bill_to_customer_id` showing only their jobs.

---

## 8. Rollout — crawl, walk, run

- **Crawl (now):** nail Marshall Reddick #20436 → land them as the reference account. Ship the
  `/property-management` page (done) + inquiry routing (done). Stand up card-on-file for the
  first small PM/landlord.
- **Walk:** build the account list (60–100), run the cold-outreach sequence + a small Search
  campaign, and build the PM portal v1 (their jobs, scoped) + the approval-to-charge flow.
- **Run:** monthly statements, LinkedIn targeting, NARPM presence, referral engine, and a
  self-serve "open an account" for Tier C landlords. Expand market by market.

---

## 9. What's built vs. to-build

**Built (live now):**
- `/property-management` landing page (speaks directly to PMs, PM inquiry form).
- `pm-inquiry.js` — captures the lead + texts Teddy/Danielle for fast follow-up.

**To build (in rollout order):**
1. PM account record + Stripe saved-card per account (card-on-file track).
2. Approval-to-charge flow (over-threshold → one-tap PM approval → charge).
3. Company-level portfolio portal (scoped to bill_to).
4. Monthly consolidated statement generator (net-terms track).
5. Google Ads Search campaign (PM keywords → page) + GA lead conversion wired.
6. Outreach: account list + email/LinkedIn sequence; NARPM chapter.

---

## Metrics to watch
- PM inquiries → accounts opened (from the page + outreach).
- Work orders/month per account (the recurring-revenue proof).
- First-visit-fix rate + avg response time per account (what renews).
- Cost per PM inquiry (ads) vs. lifetime value of an account (should be lopsided in our favor).
- % of PM jobs on card-on-file auto-charge (collections effort → near zero).

_The one-liner for the whole play: be the vendor a property manager never has to think about —
we handle the tenant, we handle the fix, we handle the bill, and they watch it all get done._

---

## 10. APARTMENTS / MULTIFAMILY — the second audience (added 2026-07-15)

Apartment communities buy differently than scattered-rental PMs. Two decision-makers, not one:

- **Community / Property Manager** — approves the vendor, cuts the PO, owns the budget. Sells on
  turn speed, one-vendor simplicity, PO/net terms, and the portal.
- **Maintenance Supervisor / Maintenance Tech** — the person who *actually calls a vendor* when
  they're slammed or a job's over their head. THIS is the top-of-mind target: when a fridge dies
  in unit 214 on a Friday, we want to be the number they already have saved. Sell on: we take it
  off your board, we make you look good to your manager, just text us — no PO, no phone tree.

**Landing page (LIVE):** `/apartment-appliance-repair` — speaks to both, has a "For maintenance
supervisors" text-us card (save-to-phone / print-for-the-shop), and a role + property-type form
that routes to `pm-inquiry` (src=`apartment`).

**The pitch in one line (apartments):** _"Backup for your maintenance team — we turn units fast,
handle the resident, and bill on your PO or a card on file."_

---

## 11. HOW TO ACTUALLY REACH THEM — the associations + the top-of-mind system

Teddy's exact question: "there's certain apartment/PM groups where they do seminars and share
contacts — what's it called?" **These are the apartment associations and PM associations.** This
is the #1 channel for this audience — the room literally IS the customer base. Join as a
**vendor / supplier / affiliate member** (that's the membership tier for a service company like us).

### The groups to join (Middle TN)

- **🥇 Greater Nashville Apartment Association (GNAA)** — THE one for apartments/multifamily.
  **Covers ALL of Middle Tennessee — Murfreesboro/Rutherford, Franklin/Williamson, Wilson,
  Sumner and surrounding — not just Nashville.** There is NO separate Murfreesboro association;
  GNAA is it. (Verified 2026-07-15: the Tennessee Apartment Association has only 5 local
  affiliates statewide — GNAA/Nashville, Memphis, Knoxville, Chattanooga, Tri-Cities — so ONE
  GNAA membership covers our whole TN footprint.) 2 International Plaza Ste 201, Nashville 37217
  · (615) 365-3047 · info@gnaa.org · gnaa.org.
  Community managers, regional managers, AND maintenance supervisors all belong. As a
  **Supplier/Associate member** you get: the member directory (they look up vendors here),
  monthly education + networking events, and the annual **Trade Show** (exhibit booth = meet
  dozens of properties in a day). They also run **Maintenance Mania / maintenance-appreciation
  events** — a competition/social built *specifically* for maintenance techs. Sponsoring or
  showing up to those is the fastest way to get in front of the exact people who call vendors.
  → Action: join as a Supplier member, get the directory listing, book a Trade Show booth,
  sponsor a maintenance event.
- **Tennessee Apartment Association (TAA)** — the state umbrella over GNAA; membership often
  comes together. Statewide reach for when we expand markets.
- **National Apartment Association (NAA) / NAAEI** — national parent; runs **Apartmentalize**
  (big national conference) and the **CAMT** maintenance-tech certification. Not the first move,
  but their education/credentialing is where maintenance supervisors live.
- **🥈 NARPM — National Association of Residential Property Managers, Middle Tennessee chapter**
  — for the *single-family / scattered-rental* PMs (the Tier B sweet spot). Monthly luncheons,
  **affiliate/vendor membership**, referral-heavy room. Best for the `/property-management` side.
- **IREM Middle Tennessee** (Institute of Real Estate Management) — CPM-designated PM
  professionals, mixed residential/commercial. Good for the larger Tier-A managers.
- **Local REIA / real-estate investor meetups** (Nashville REIA, BiggerPockets local) — reaches
  the individual-landlord Tier C. Cheap, high-volume, low-commitment.

### How to work the association channel (the play, not just "join")

1. **Join GNAA as a Supplier member first** (single biggest lever for apartments). Get the
   directory listing pointing at `/apartment-appliance-repair`.
2. **Exhibit at the annual Trade Show** — a booth + a giveaway (branded fridge magnets with our
   text line) puts us face-to-face with dozens of properties in one afternoon.
3. **Sponsor a maintenance-focused event** (Maintenance Mania / maintenance appreciation) — this
   is where the maintenance supervisors are, and they're the ones who call.
4. **Show up to the monthly events** consistently — top-of-mind is a frequency game. One booth
   isn't a strategy; being the vendor they see every month is.
5. **Collect cards → the account list** — every contact goes into the outreach cadence below.

### Beyond associations — where else these buyers are

- **Vendor / maintenance-dispatch networks:** many communities dispatch repairs through software
  vendor networks. Getting credentialed on these = being *inside the tool they already use*.
  Targets: **PropertyMeld, Lula, AppFolio Stack / vendor network, SightPlan, Mezo.** (Teddy to
  apply as a vendor; these are relationship + credentialing signups, not ad buys.)
- **LinkedIn** — cleanest B2B targeting that exists. Target titles "Community Manager / Property
  Manager / Maintenance Supervisor / Director of Facilities / Regional Manager" at apartment
  operators in our metros. Start after the page + Search prove out.
- **Facebook groups** — large "apartment maintenance" and "property management" groups where
  maintenance techs swap tips and vendor recommendations. Organic presence, not ads.
- **Turn-partner referrals** — the GCs, painters, flooring, and HVAC crews doing make-readies
  already know the maintenance supervisors. Cross-refer.

### Google Search (the ad layer for this audience)
PM-intent + apartment-intent keywords → the right page:
- → `/apartment-appliance-repair`: "apartment appliance repair <city>", "multifamily appliance
  repair", "appliance repair for apartment communities", "maintenance appliance vendor".
- → `/property-management`: "property management appliance repair", "rental appliance repair
  contractor", "preferred appliance vendor property manager".
Low volume, very high intent — one click is worth many homeowner clicks. Small daily budget,
exact/phrase match, tight negatives, GA `generate_lead` wired as the conversion.

### The TOP-OF-MIND system (recurring touch — the real answer to "how do we stay top of mind")
Top of mind = the right touches, repeated, across the channels above. Layer them:
1. **The saved number** — the maintenance-supervisor text card (on `/apartment-appliance-repair`,
   printable for the shop). Once we're in their phone, we win the Friday 4pm fridge call.
2. **Frictionless first job** — card on file + resident coordination + portal means their first
   experience is effortless. That's what converts a trial into "our appliance guy."
3. **Monthly value touch** — a short email/text to each account: seasonal reminder ("turn season
   — lock your slots"), a mini scorecard of jobs we did for them, a heads-up on a common failure.
   (Build: automate via the system once accounts exist.)
4. **Consistent association presence** — show up monthly, sponsor the maintenance events, be the
   face they know.
5. **Reviews / reference** — Marshall Reddick as the flagship case study; every happy property
   is a referral to the next.

---

## 12. Immediate next actions (2026-07-15)

**Teddy (relationship — can't be automated):**
1. **Join GNAA as a Supplier member** (greaternashvilleapartment.com) — #1 move. Ask about the
   Trade Show booth + sponsoring a maintenance event.
2. **Join NARPM Middle Tennessee chapter** as an affiliate — for the SFR/PM side.
3. **Apply as a vendor** on PropertyMeld / Lula / AppFolio vendor networks.
4. **Finish Marshall Reddick #20436 flawlessly** → ask for the reference + preferred-vendor intro.
5. Order **branded fridge magnets** (our text line) for booth giveaways + property drop-offs.

**Claude (built / to build):**
- ✅ `/apartment-appliance-repair` landing page (live) + maintenance-supervisor text card.
- ✅ `pm-inquiry` captures role + property_type + apartment source.
- ⏭️ Google Search campaign (apartment + PM keywords → the two pages) when Ads access clears.
- ⏭️ Monthly account-nurture touch (email/text) once accounts exist.
- ⏭️ Company/community portal scoped to the account (shared with the PM billing build).

# 🤝 AssistAnt Partner Program — offers for the people who move whole trades

_The playbook for putting AssistAnt in front of the three tiers of influence Teddy named: (A) trade creators
& group/YouTube leaders, (B) industry heavyweights (warranty cos, distributors, franchises), (C) trade media
& associations. Built on the partner engine we already have — no new plumbing needed to launch Tier A today._

---

## The engine (already live — reuse, don't rebuild)

One command stands up a partner completely — code, dashboard, share link, commission math, payout ledger:

```
platform-partner?do=upsert&secret=<VAPI_ADMIN_SECRET>
  &code=<THEIRHANDLE>&name=<Name>&email=<email>&phone=<cell>
  &commission_type=sub_pct&commission_pct=<N>&commission_months=<0=lifetime|N>
```
Returns: their **share link** `tnapplianceexchange.net/r/<code>` (→ signup?ref=code), their **QR** (printable),
and a **read-only dashboard** `partner.html?token=pt_…` (owed / earning-per-month / earned / paid + the shops
they referred). Attribution is **live + real-partner-gated**: `?ref=` rides `/r/<code>` → signup → Stripe →
stamps `company.referred_by` and validates against an ACTIVE partner before it counts (a stray ref to a nobody
is dropped; a comp can't self-attribute). Payouts settle via `do=record_payout`. **`do=report&code=<X>`** reads
anyone's pipeline.

**Commission shapes:** `sub_pct` = % of the referred shop's monthly subscription (the norm for people),
`flat_per_account` = flat $/shop. Window = lifetime (`commission_months=0`) or N months from activation.
**Model to mirror = TK:** `sub_pct`, **30%, 12 months** (aggressive up front to light a fire, reverts after a
year). Link `signup.html?ref=TK`, dashboard token `pt_2e274606b78803f0c1db43c52f3adbb3`.

**What the product IS (so every pitch is accurate):** AssistAnt = one system that answers the phone 24/7 (AI
receptionist "Ann") and books/parts/routes/invoices the job, runs the office board + dispatch, builds the
shop a website + Google presence + review engine — **$99/mo flat, every tech included** (Own-Your-Area
territory add-on $199; the Ann phone line is a separate metered add-on ~$50/wk). Jabs: Housecall Pro
($79–329), Jobber ($49–499), Workiz ($225–325) all charge **per seat**; Podium/FixCall just take a message.
Bring-your-data from HCP/Jobber/Workiz in an afternoon, keep the old one running. Built by a real shop. It's a
**multi-trade** platform (appliance is the flagship; auto, HVAC, aquarium, furniture, etc. are config rows) —
so the program isn't limited to appliance creators.

---

## TIER A — Trade creators & group / YouTube leaders  ★ launch this now

**Why first:** their followers ARE shop owners, peer credibility converts where cold ads don't, and the
cash-reseller model already IS an affiliate program. **The offer = the Creator Partner deal.**

### The Creator Partner offer (what they get)
- **Recurring cash** on every shop they send that becomes a paying customer — mirror TK: **30% of the
  subscription, for 12 months per shop** (Teddy sets the final number).
- Their **own link + QR + live dashboard** (one `do=upsert`), so they see their money in real time.
- A **co-produced commercial** they can run to their audience (the "Built by a Shop Owner" film + a cut with
  their intro) — we make the creative, they just post.
- **Free setup for the shops they refer** (there's no setup fee to waive — an honest, real perk).
- First-mover status: "the shop owner who actually built the software" is a story their audience wants.

### One-command onboard (per creator)
`platform-partner?do=upsert&secret=…&code=<HANDLE>&name=…&email=…&commission_type=sub_pct&commission_pct=30&commission_months=12`
→ hand them the `/r/<HANDLE>` link + `partner.html?token=…` dashboard. Done.

### DM opener (paste-ready, from Teddy)
> Hey [name] — I own an appliance shop and built the software that runs it (answers every call 24/7, books
> the job, one flat $99, every tech included). Other shops kept asking, so I'm sharing it. Your audience is
> exactly who it helps. I'd love to set you up as a partner — you get a real cut on every shop you send + a
> commercial we produce for you to run. Cool if I send the 90-second rundown?

### First-comment / group-post hook (when the "should I use HighLevel/FixCall/HCP?" threads pop)
> I got tired of five subscriptions and missed calls, so I built one system that answers 24/7 and actually
> books the job — $99 flat, every tech in. Built it in my own shop. Happy to show anyone: tnapplianceexchange.net/ant

### Target list (Teddy fills the exact handles — he lives in these rooms)
- **Warm already (from `docs/group-outreach-playbook.md`):** Ken King, Marc Lavelle, Jessica Anne — DM these first.
- **Facebook groups (get the admins/most-active voices):** the big appliance-repair owner/tech groups
  (e.g. "Appliance Pro Talk," "Appliance Technicians Only," appliance-repair business-owner groups) + the
  parallel HVAC / plumbing / garage-door / locksmith owner groups (multi-trade product). → target the
  **admins + top posters**.
- **YouTube:** appliance-repair channels that skew **business/owner** (not just DIY tear-downs) + the broader
  "home-service business" channels.
- **Podcasts:** home-service / trades business podcasts.
- ⏭️ **Research pass available:** on your go I'll run a web-research sweep to populate this with exact
  names / handles / audience sizes / contact so it's a ready call-list (I won't fabricate specifics — this
  list is the framework + your warm names until then).

### Honest gaps (Tier A)
- **No self-enroll portal** — enrollment is the admin `do=upsert` command (fine at this volume; a creator
  self-apply page is a small future build, could reuse the lead-magnet capture rail → I onboard).
- **Payouts are manual** (`do=record_payout` + a real transfer) — no Stripe-Connect auto-payout to partners yet.
- **SaaS-signup conversion isn't fed to the ad channels yet** — a creator sending cold traffic is attributed
  fine via `?ref=`, but ad-optimization on SaaS signups is a separate wiring (in the Phase-2 plan).

---

## TIER B — Industry heavyweights (warranty cos · distributors · franchises)

**Why:** biggest single deals; you already have relationships (AHS/Frontdoor, Marcone). **Reality:** the
current partner engine is built for an individual earning % of one shop — it does **not** yet do bulk /
franchise roll-up / white-label / override commissions. So Tier B v1 = **a pitch + a conversation + the
reseller/NDA paper**, not automated economics. The deal shapes:

- **Warranty companies (AHS/Frontdoor, 2-10, Cinch, ServicePower/SquareTrade, NSA):** "give your servicer
  network the software that already speaks your dispatch language." AssistAnt auto-lands their dispatches on
  the shop's board + syncs status both ways (the AHS/Frontdoor integration you're finishing). Offer =
  co-marketing / preferred-software placement to their network; deal terms are custom (per-shop rev-share or
  a network license), drafted with counsel.
- **Parts distributors (Marcone/Reliable/Encompass):** AssistAnt already does live parts lookup + drop-ship.
  Offer = bundle/endorse to their shop customers; rev-share or a wholesale/embed tier.
- **Franchises / multi-location groups:** one platform across every location. Offer = a group deal +
  Own-Your-Area; needs bulk-onboard + an override commission (future build).

**Deliverable now:** a **one-page pitch per type** + use the reusable paper: `docs/partner/tk-reseller-agreement.md`
(reseller) + `docs/partner/tk-mutual-nda.md` (NDA) — fill the blanks, counsel finalizes. The **Founder Film**
(commercial #3) is the door-opener you send with the pitch.

**Honest gap:** real distributor/franchise economics (bulk attribution, override/tiered commission,
white-label — which the current reseller agreement actually forbids) = a deliberate future build once a deal
is real. Don't promise white-label until terms exist.

---

## TIER C — Trade media & associations

**Why:** endorse to a whole membership at once. **Reality:** we have ad/SEO plumbing but **no sponsorship or
member-discount deal structure** yet. The plays:

- **Sponsorship / endorsement:** trade magazines, appliance/HVAC associations, training orgs, the trades
  podcasts. Offer = a sponsored placement + the Founder Film + an association-branded landing.
- **Member-discount offer:** "[Association] members get [X] on AssistAnt." The Stripe **coupon** machinery
  behind the Ant-Army credit can mint a member promo code — exposing it as a member-discount surface is a
  **small build** (not yet done). Track the association as a partner code so signups attribute.
- **Best-of / directory citations:** `docs/best-of-listicle-targets.md` already lists the directories that
  feed AI answers (Three Best Rated, Expertise, etc.) — Tier-C-adjacent, works today.

**Deliverable now:** a **sponsorship/endorsement pitch** + a proposed member-discount structure. **Honest
gap:** the member-discount coupon surface + any association bulk-enrollment are small builds if a deal lands.

---

## Cross-cutting honest flags (tell Teddy)
1. **Tier A is turnkey today**; B and C need custom terms (and, for real scale, a bit of new build) — lead
   with creators.
2. **Set the creator commission %** (30%/12mo recommended, mirroring TK) — one number, applies via `do=upsert`.
3. **Ant-Army $25 customer credit is still shadow** (`PLATFORM_REFERRAL_CREDIT_LIVE` off) — separate from
   these partner deals; flip when ready.
4. **Payouts manual + no self-enroll** — fine at launch volume; automate if the program takes off.
5. **The Founder Film is the shared weapon** across all three tiers — it's why a creator vouches, a warranty
   rep listens, and a magazine runs it.

## Launch sequence
1. Set the creator commission % → `do=upsert` your first 3 warm creators (Ken King, Marc Lavelle, Jessica
   Anne) → hand them links + dashboards + the co-produced commercial.
2. Send the Founder Film + one-page pitch to your top warranty-company + distributor contacts (Tier B).
3. Pitch one association / trade-media outlet with the sponsorship + member-discount offer (Tier C).
4. (Optional, my build on your go) research pass to populate the Tier-A target call-list with real handles;
   creator self-apply page; member-discount coupon surface.

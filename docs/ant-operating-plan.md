# 🐜 Ant — Operating Plan (living document)

**Internal operating plan — not for outside eyes.**
TN Appliance Exchange LLC · James "Teddy" Pivacek · v1 draft started 2026-07-03.

> This is the canonical business plan. It's a **living doc** — we edit it as the
> business moves. Rendered (pretty, theme-aware) version is an Artifact; this
> markdown is the source of truth we build on. Audience = **us / the team**
> (honest operating plan, not a pitch). Scope = **the full three layers**.
>
> **How to build on it:** edit this file, commit, push. When you want the nice
> rendered version, re-render `docs/ant-operating-plan.html` as an Artifact.

---

## 00 · The thesis

Appliance repair is a trust-poor trade that survives on hiding information —
model numbers, part markups, whether a fix is even worth it. Every incentive
points at opacity. Ant does the opposite **on purpose**, and wins *because* of it.

**🎯 North star: the model number isn't the asset — the trust is.** We automate
the whole job, hand the customer the honest options (fix it, ship you the part,
or walk away), and let the outcomes compound into an intelligence no one else
has. Transparency isn't a soft value — it's the moat and the growth engine, the
same move.

**🧠 The identity that creates: Ant is the appliance-intelligence layer the big
platforms lack — and would rather partner with than build.** FrontDoor's warranty
AI has no cross-vendor contractor brain; Amazon sells a part it can't diagnose;
OEMs sell machines but don't own the repair. None of them will become an 8-year
repair company to fix that — that's *our* techs, *our* outcomes, *our* trust. So
we don't compete *with* the platforms; we're the layer they're incomplete without.
That's who Ant is across all three layers below (developed in §02½).

The plan below is the operating version of that: what's real today, what makes
us hard to copy, the three layers in the order we build them, how each makes
money, and the honest risks.

---

## 01 · Where we actually are today (honest snapshot)

- **[LIVE] The shop runs on Ant** — warranty + self-pay intake, scheduling, the
  job board, tech tools, invoicing, warranty submissions, all on our own stack.
  Housecall Pro being phased out (read-only history source now).
- **[LIVE] Calls answered by Ant 24/7** — every line → Telnyx → Vapi. Intake,
  status, booking, transfer-to-human on request. (~7 calls handled clean the
  morning of 2026-07-03.)
- **[LIVE] Warranty auto-accept + submission spine** — SquareTrade/ServicePower
  auto-accept + route to area tech; claims read/reconcile via API; parts-return
  tracker guards chargebacks.
- **[LIVE] Payments + honest 4-option quote** — $50 quick check + in-home pay
  proven; cash quote = OEM/aftermarket × DIY-ship/we-install; Marcone (mSupply)
  drop-ship ordering live.
- **[LIVE] Ant Brain (predict-the-part)** — repair history → part prediction
  before the truck rolls, self-grades vs. what actually fixed the job. *Real but
  thin* (~21 graded failures) until the loop fills.
- **[BUILDING] Demand engine** — Google Ads live (2 dryer/fridge campaigns,
  conversion-tracked); GBP review replies auto-drafted; AI intake page = the
  front door; SEO map-pack push.
- **[HELD] Self-scheduling autopilot** — built + dark. Auto-places jobs on the
  right tech's day honoring customer + tech availability. Held until availability
  replies flow; the 5-day goal is set.
- **[WAITING] Amazon Business + GBP APIs** — Amazon Business Ordering (aftermarket
  auto-ship) + GBP (auto-post review replies) requests in, inbox watchers armed.
  Both are upgrades, not blockers.
- **[THIS WEEK] Office coverage** — Danielle out **for the week**; Teddy covers
  the desk for the first time (she's back after). Checklist page shipped
  (`office-handoff.html`). A forcing function to learn the desk + start
  systematizing it — **not a permanent handoff.**

---

## 02 · Why we're hard to copy

A competitor with a weekend and an LLM can clone a screen. They can't clone these:

1. **Outcomes data — the compounding asset.** Every completed job grades Ant
   Brain's guess against what actually fixed the machine. Accuracy climbs with
   every TDR. The flywheel only spins for whoever owns the job data — and Layer 2
   makes it spin faster (more shops = more outcomes).
2. **The founder is a tech.** Teddy runs the trucks, knows the vendors, has felt
   every pain the product removes. Credibility that can't be hired.
3. **Vendor relationships, years deep.** Live integrations + real relationships
   with AHS/Frontdoor, SquareTrade/ServicePower, NSA, Marcone/mSupply. A new
   entrant starts these (some BD-gated, months long) from zero.
4. **Transparency is structurally hard to copy.** Incumbents survive on markup
   opacity — they can't match "here are your honest options + we'll ship you the
   part" without gutting their own margins.

---

## 02½ · The identity — the appliance-intelligence layer *(crystallized 2026-07-18, lake)*

The unifying thread under all three layers. **Every big platform in appliances is
missing the same thing — and none will build it, because it means becoming a repair
company:**

- **The warranty giants** (FrontDoor/AHS, SquareTrade) have claims + dispatch, but
  their AI serves *them* — no cross-vendor contractor brain. (See **THE WEDGE** in L2.)
- **Amazon** has the marketplace + the buy-button trust, but sells a part it can't
  diagnose — it can't tell a buyer *which* part fits their model or *how* to install
  it, and wrong-part returns are Amazon's pain too. Ant's fitment + AI part-confirmation
  makes Amazon's category *healthier* — so we position not as one more seller but as an
  **asset to Amazon** (returns-reduction is the key that opens the partner door). Full
  play: `docs/amazon-store-strategy-2026-07-18.md` + `docs/amazon-dropship-store-plan-2026-07-18.md`.
- **OEMs / big-box** sell machines + parts but don't own the repair or the
  post-purchase moment.

**The through-line:** Ant is the **appliance-intelligence layer the big platforms lack
and would rather partner with than build.** We don't compete *with* the platforms —
we're the missing layer that makes each of them better. This reframes the partner
targets in §06: not "sell to a giant who might build their own," but "**be the
intelligence they're structurally incomplete without.**"

**The discipline it demands:** you earn the asset/partner seat by being **undeniable
first** — proven outcomes (first-visit-fix, low returns, real reviews, external traffic),
not a pitch deck. The metrics open the door; the deck never does. Build everything to
*produce the number* (returns-reduction for Amazon; claim-accuracy for the warranty cos)
and set it on the table.

**Why it's ours to hold:** it rests on the same uncopyable base as §02 — the outcomes
data, the tech-founder, the vendor relationships, transparency. A platform can rent an
LLM; it can't rent eight years of what actually fixed the machine.

---

## 03 · The three layers (same backend, three front doors, built in order)

### L1 — TN Appliance Exchange · the proving ground *(live today)*
Warranty has been ~95% of the work for years; keep doing that great. Growth
direction is **self-pay**, where we control the whole experience and can make it
*better* than warranty. The shop is the lab — real production traffic.
- Kill the HCP dependency — schedule natively in Ant.
- Self-pay to warranty-parity by EOY — automation makes a cash job as smooth.
- Feed Ant Brain — auto-predict on every new job so the outcomes loop fills.
- Systematize the office — Teddy covering this week is the prompt; goal is no
  single point of human failure.
- **Done looks like:** any job flows intake → pre-diagnosis → parts staged → tech
  guided → warranty filed, human only where judgment is needed. North-star
  metrics move: first-visit-fix up, calls-per-100-jobs down, days-to-normal down.

### L2 — Ant for Shops · the SaaS *(multi-tenant scaffolded, company_id)*
The product is the entire system TN runs on. Buyer = the ~10,000 independent
appliance-repair shops drowning in the paperwork we automated away. **They become
the supply side of Layer 3.**
- Buyer: independent shops (1–20 techs) living in HCP/spreadsheets/MeisterTask.
- Model: free trial → per-tech / month once it's earning for them.
- Network effect: every shop's data improves Ant Brain for *all* shops.
- Wedge: lead with the one thing that hurts most (warranty submission or parts
  prediction), then expand into the full ops brain.
- **Done looks like:** a second shop runs a full week on Ant unassisted, their
  data flows into the shared brain, per-tech billing clears.

**⭐ THE WEDGE — why the warranty giants can't take this from us (FieldPal, 2026-07-17).**
The warranty companies are already building their own tech-facing AI. FrontDoor —
our single biggest partner — is sandbox-testing **FieldPal.ai** (voice-first claim
authorization + troubleshooting). Teddy tested it: continuous voice, pulls up the
actual form, fields open on screen; but glitchy, loses state when you flip to another
page, no photo upload yet. It *looks* like the door closing on selling Ant to the
giants. It's actually the **map** — and it sharpens the whole L2 thesis:
- **Their AI serves THEM, never the tech.** FieldPal exists to make *FrontDoor's*
  claims cheaper and pull the contractor deeper into *FrontDoor's* funnel. A warranty
  company's AI is always optimized for the warranty company. It will never help a
  contractor do more **cash** work, run their **other** vendors (AHS, ServicePower,
  NSA, SquareTrade), schedule the crew, order parts, or do the books — that's not
  FrontDoor's business.
- **Ant is the opposite by design:** the contractor's OWN system, sitting *above*
  every warranty company + cash + scheduling + parts + payroll + books. One pane of
  glass across all of it.
- **Fragmentation is our tailwind.** As each warranty co ships its own walled tool
  (FieldPal, then the AHS/ServicePower equivalents), a contractor ends up with N
  islands that don't talk — plus cash work floating outside all of them. The more they
  fragment, the more valuable a single **cross-vendor contractor OS** becomes.
- **Structurally uncopyable.** FrontDoor won't build a tool that makes a contractor
  *less* dependent on FrontDoor — their incentives forbid it. That's exactly what Ant
  does. So Ant and FieldPal aren't real competitors: FieldPal wants the tech deeper in
  the funnel; Ant makes the tech independent of any single warranty company.
- **Where we already beat FieldPal (don't rebuild — we're ahead):** the live form with
  fields open + scribe-mode auto-fill, and **photo upload with Vision OCR** that reads
  the model/part sticker straight into the report. The one thing worth learning from
  them is *persistent, always-on voice that survives page-flips* — layered on the form
  we already have.
- **The operating rule this locks in:** don't bet the company on selling Ant to a
  partner who's building their own (interop — "work WITH my agent to authorize claims"
  — stays a nice-to-have, not the plan). **Learn from every competitor to know where
  the bar is; build only what the warranty companies structurally won't.** The durable
  ground is the independent contractor.

### L3 — The consumer platform · the big idea *(homeowner-facing)*
Homeowner with a broken appliance opens Ant, shows symptom + model, gets one of
three **honest** answers:
- **DIY** — "$15 part, 20-min fix, here's the part + safe how-to. Ship it?"
- **DIY-with-risk** — "doable, but 4 hrs + risk. Here's what to expect, or a
  vetted pro at $X–$Y."
- **Pro-only** — "gas / 240V / sealed system / warranty — don't touch it. Two
  4.8★ pros near you, open this week."

**TAM flips the company:** ~10k shops (L2) is a good business; ~120M households
with a yearly appliance issue is a different one. Pros come from L2; parts from
the same suppliers; trust from the brand we build now.

**Guardrails (non-negotiable):** hard auto-gates on dangerous categories (gas,
240V, refrigerant, sealed systems) — no DIY path ever; "educational, not
professional advice" TOS; product + liability insurance; parts under the
distributor's warranty (marketplace, not manufacturer); pros are 1099, carry own
insurance, verified at intake.

---

## 04 · How it makes money (four rails, layered over time)

| Rail | What it is | Lands in |
|---|---|---|
| **Repair revenue + parts margin** | The shop. Labor by the job (~$100/hr-equiv, flat per repair) + parts at cost ÷ .75. Warranty reimbursements + self-pay. | L1 — now |
| **Parts drop-ship spread** | Ship the customer the part (OEM or aftermarket), keep the markup, never touch it. Scales into the consumer app. | L1 → L3 |
| **SaaS subscriptions** | Per-tech / month for shops on Ant. Free trial → paid once earning. | L2 |
| **Referrals + white-label** | Consumer platform routes leads to pros ($/accepted lead); big prize = a warranty co / OEM licensing a branded Ant. | L3 + partners |

The compounding line is the **outcomes data** under all rails: better predictions
→ higher first-visit-fix → cheaper jobs → happier customers → more jobs → more
data. Financial layer (parts cost, margin, commissions, tax, owner P&L) automated
in parallel so the books eventually run without a bookkeeper.

---

## 04½ · The demand engine — how L1 gets found *(decided 2026-07-26)*

Great ops with no demand is a secret. Here's how we fill the funnel — the order matters as much as the money.

**The discipline: free-first, then pay.** No paid ads until a few real paid sales
(Quick Checks / parts orders) prove the page + offer actually *close*. A sale gives us
a true cost-per-sale to bid against, and the sales themselves fund the ad budget (the
markets report already does the "$X earned = N days of ads" math). We paused the Miami
$10/day test on 2026-07-26 for exactly this reason — spend follows proof, not hope.

**Content strategy — the big correction.** Stop widening the thin **city × service grid**
(doorway-page pattern: mass-produced, near-duplicate, Google ignores *and* can penalize
the whole domain). Proof from our own Search Console: **607 pages ranking in the last 90
days out of ~1,336 submitted (~45%)** — the ~729 dead ones are overwhelmingly the thin city
landers. **Pivot to the type that's in the winning 607: diagnostic / symptom / brand / model
/ part-number pages** — "dryer not heating," "Samsung fridge not cooling," "Whirlpool F21,"
"replace part #X." Each answers a real search and funnels to a **part order or $50 Quick
Check.** Built from our 13-year repair corpus = genuinely useful *and* uncopyable (the moat).
Quality per page, **in English AND Spanish.** (Engine already seeded: `/fix/` pages +
brand×symptom knowledge base — we scale the library, not the doorway grid.)

**The Spanish market — the biggest under-served lane in the trade.**
- **68M Hispanics** in the U.S. (2024); **44.9M speak Spanish at home** — the U.S. is the
  **2nd-largest Spanish-speaking country on earth.**
- **~18M speak English less than "very well"** — the most under-served, most loyal-once-earned
  group. Almost no appliance competitor serves them in Spanish at all.
- **Mobile-first:** 93% own a smartphone; **28% are smartphone-only** for internet (rising) —
  our video + text intake is built for exactly this. Heavy on TikTok/IG/YouTube/**WhatsApp**.
- **Our model erases geography:** repair = 2 states, but **video diagnosis + ship the part =
  all 44.9M nationwide.** The Spanish market isn't our service area — it's the whole country.
- **Aim by Spanish-reliance + low competition, not raw size:** **Miami** (42.7% of metro,
  Miami-Dade 67%), **Houston**, and the **DMV** (Salvadoran-led, very low English proficiency)
  beat LA/NYC (bigger but crowded). Point free channels there first.
- **WhatsApp = the unbuilt unlock** for this audience — flagged as a real next-build.

**Channel order:** diagnostic content (slow-compounding SEO) + social (live now) + community
(Anthony's Gift codes) → first sales → *then* paid ads, aimed where the sales came from.

## 05 · The order we build it (sequencing is the game)

**Now · next few weeks — finish Layer 1 + cover the office**
- Cover the desk this week; capture the warranty flow; vault the logins.
- Self-scheduling held → live once availability flows.
- Amazon Business API lands → aftermarket auto-ship (one flag).
- Auto-predict every new job so Ant Brain fills.
- Kill the last HCP dependency.

**Next · this year — harden Ant into a product; light up Layer 2**
- Pour the 8-yr MeisterTask + HCP history into the brain (real corpus, not 21 rows).
- Package the wedge as something a second shop can turn on.
- Land the first outside shop — or first warranty-partner conversation.
- Reserve the ground: consumer domain + handles + provisional patent (dual-tier
  quote + confidence-badge model).

**Later · 1–3 years — open the front door to homeowners**
- Consumer platform beta on the same backend.
- L2 shops become the vetted-pro supply network.
- First big partner: warranty co / OEM licensing a branded Ant.

---

## 06 · Partners & keys — collect them early (access IS the asset)

*Frame (per §02½): approach each not as a vendor to sell to, but as a platform that's
**structurally incomplete without our intelligence layer** — and earn the seat by being
undeniable on their metric first (returns for Amazon, claim-accuracy for warranty cos).*

| Target | Why they matter | Status |
|---|---|---|
| **Home-warranty cos** (AHS/Frontdoor, SquareTrade, 2-10, Cinch) | Biggest prize — Teddy has the relationships. White-label / status-API deal = scale-changer. | Relationship-deep; API BD-gated |
| **Parts distributors** (Marcone/mSupply, Amazon Business, Reliable) | The parts rail. Drop-ship live (Marcone); aftermarket pending Amazon. | Marcone LIVE / Amazon pending |
| **OEMs** (Whirlpool, GE, Samsung, LG, Bosch) | Branded Ant for their owners; post-purchase CS replacement. | Later |
| **Big-box** (Home Depot, Lowe's, Best Buy) | Embed at parts checkout / service desk. | Later |
| **Google (Ads + Business Profile)** | The demand engine — paid + map-pack + auto review replies. | Ads live / GBP pending |

---

## 07 · The honest risks (+ the move on each)

- **Key-person — the office.** Too much runs in one head (warranty submission).
  Danielle out this week is the forcing function, not the crisis. *Move:* Teddy
  covers + captures how it works, then automation carries the load so the desk
  never depends on one person.
- **Platform dependency.** We ride HCP (leaving), Vapi, Telnyx, Xano, Netlify.
  *Move:* own the data — nightly off-site backups, mined 8-yr history, kill the
  HCP crutch. The brain lives on data we hold.
- **Consumer liability (L3).** Telling a homeowner they can DIY. *Move:* hard
  gates on dangerous categories, educational-not-advice TOS, insurance,
  marketplace/1099 structure — designed in from day one.
- **Competitors converging.** Others chasing SaaS-for-repair. *Move:* validation
  not threat — the race is distribution + outcomes data + founder credibility,
  none clone in a weekend. Reserve the ground now; keep shipping.
- **Cost / reliability at scale.** Loop melting the backend, metered-API
  surprises. *Move:* already learned — local queue, SMS circuit-breaker, billing
  caps, load-shedding. Keep hardening before adding tenants.

---

## 08 · What we do next (short list — Layer 1 first, always)

1. **Cover the office this week.** Teddy at the desk while Danielle's out; learn
   the warranty flow; start systematizing what's in one person's head.
2. **Fill Ant Brain.** Auto-predict every new job + pour in the mined history.
3. **Flip the pending keys as they land.** Amazon Business → aftermarket
   auto-ship; GBP → auto review replies. Watchers armed.
4. **Take self-scheduling live.** Off "held" the moment availability replies flow.
5. **Reserve Layer-3 ground early.** Consumer domain/handles + provisional patent.

---

## Changelog
- **2026-07-26 — v1.3.** Added **§04½ · The demand engine**: free-first (no paid ads until
  sales prove the funnel — paused the Miami test), the **content pivot** from the thin
  city×service doorway grid → **diagnostic/symptom/brand/model/part pages in EN + ES**
  (grounded in the repair corpus = moat), and the **Spanish market thesis** (44.9M Spanish-
  at-home, ~18M low-English, mobile-first, aim Miami/Houston/DMV; video+ship-parts erases
  geography). Milestone: **607 pages ranking / ~1,336 submitted (~45%)** — build more of the
  winning type, stop feeding the dead ~729. WhatsApp flagged as the unbuilt unlock.
- **2026-07-18 — v1.2.** Folded in the **intelligence-layer identity** (lake brainstorm):
  Ant is *the appliance-intelligence layer the big platforms lack and would rather partner
  with than build.* Added to the thesis + a new **§02½** developing it across the warranty
  giants (the WEDGE), **Amazon (asset, not just a seller — returns-reduction as the key that
  opens the partner door)**, and OEMs/big-box; reframed §06 partners around it. Discipline:
  earn the asset seat by being undeniable on their metric first, never a pitch deck. New
  companion docs: `docs/amazon-store-strategy-2026-07-18.md` (trusted Amazon brand) +
  `docs/amazon-dropship-store-plan-2026-07-18.md` (own-site drop-ship store).
- **2026-07-17 — v1.1.** Added **THE WEDGE** to L2 (from Teddy testing FieldPal.ai,
  FrontDoor's own tech-facing AI PoC): warranty giants building in-house isn't the
  door closing — their AI serves *them*, so the durable ground is the cross-vendor
  **contractor OS** for independents. Fragmentation is a tailwind; structurally
  uncopyable (their incentives forbid making a contractor less dependent on them).
  Rule: learn from competitors for the bar, build only what they structurally won't.
- **2026-07-03 — v1.** First full draft (audience: team/operating; scope: all
  three layers). Corrected office framing: Danielle out **for the week**, Teddy
  covers — not a permanent handoff.

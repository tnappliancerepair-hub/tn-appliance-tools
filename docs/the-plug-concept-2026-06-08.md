# THE PLUG 🔌 — concept (saved 2026-06-08, FL brainstorm)

> Brainstormed with Teddy over the FL vacation. Name LOCKED: **The Plug**.
> This is the consumer/tech-facing wedge that runs in parallel with Ant Ops
> (the TN Appliance platform). Not built yet — this is the concept + build
> plan for when Teddy's back at a computer.

## The one-liner

**The Plug** — the underground line where elite appliance techs trade fixes.
*Bring a fix, get the plug. Every brand's secrets in one pocket.*
Tagline: **"Get plugged in."**

## The thesis

We're not building a repair tool. We're building a **labeled dataset that
happens to look like a repair tool.** The asset is the tuple:

`brand → model → complaint → what failed → part# (good AND bad) → did it hold?`

Whoever accumulates the most of those wins — a competitor with a better UI and
more money still can't buy years of real-tech outcomes. The app is the
data-capture mechanism; the data is the company.

**"Bad part numbers" is the secret weapon.** Every catalog has the *right*
part #. Nobody has the *wrong* ones — the part a tech tried that didn't fit,
the superseded cross-ref, the aftermarket that failed in 3 months. That
negative data is uniquely ours and is what takes parts-matching from ~40%
AI-only accuracy to 90%+.

## Why give it away free

- Free + "just helps you in the truck" defuses the "am I training my
  replacement?" tension. Techs feel like they got a superpower, not like
  they're feeding a rival.
- **Data accrues even if 90% churn** — you need *usage events*, not retention.
  Every tech who tries it twice has donated tuples.
- Monetization comes LATER and is stronger for having been free: freemium,
  parts margin, or selling aggregate failure intelligence to OEMs / warranty
  companies (who'd pay a lot for "Whirlpool model X fails at the board at 4yr").

## The mechanic: give-to-get

It's a **status economy**, not a help desk. You climb by depositing fixes that
**hold up** (no callback in 30 days = verified-good; a callback = bad tuple).

**Ranks:** Rookie → Soldier → Vet → OG → **Plug**
(top of the food chain isn't "Boss" — it's being *the Plug*, the guy whose
tips everyone wants.)

**The one rule (Omertà):** take from the family, don't leak to outsiders.

**Cross-brand trade is the engine:** every tech is elite at ONE brand
(warranty contracts route brands to specific guys) and blind on the others.
Pool them and everyone gets every brand's tricks. The LG guy deposits LG to
unlock Whirlpool/Samsung. That's why the database loads itself.

## The MVP: a text line (NOT an app)

Lowest friction possible — no download, no login. A tech texts a number, gets
the fix. **Phone number = identity** (rank/reputation/credits hang off it with
zero auth).

**We already own ~70% of the plumbing:**
- Telnyx tech SMS line + inbound routing (exists)
- `tech-assist-brain` (Netlify) — already extracts model / part# / diagnosis /
  fix as structured fields from a tech's text (the scribe-mode brain)
- Net-new: a contribution gate + a shared-knowledge lookup + rank tracking by
  phone number

**Two data-quality moves:**
1. **One smart follow-up** — "nice — exact model? what part fixed it?" turns a
   sloppy tip into a clean tuple. The brain already does this.
2. **Close the loop** — days later: "did that RF28 fix hold?" Yes = verified
   good; callback = bad. That's the auto-labeling, no human grading.

**Sequencing:** start SOFT to win volume (answer freely, nudge "got a tip
back?"), then turn on the give-to-get gate + ranks once the loyal core is
hooked. Friction too early kills cold-start; friction once they're addicted
*creates* the club.

## Distribution

Teddy is already a member of the rooms: **Appliance Pro Talk, Appliance
Technicians Only (the original), Appliance Alliance** — 5k+ techs each. The
move is **seed it through the loyal guys + a respected node privately first**
(prove it, get a database head start), THEN go wide — rather than broadcasting
the concept in groups where competitors lurk.

## Cost to run (Haiku 4.5 bulk, Sonnet 4.6 for hard cases)

Pricing: Haiku $1/$5 per 1M tok in/out; Sonnet $3/$15.
- Per tech question all-in (Claude + SMS): **~2–4¢**. Claude alone is ~½¢ —
  **SMS is the bigger cost at scale.**
- 25 loyal techs ≈ **~$100/mo** (coffee-a-day pilot)
- 100 active ≈ ~$400/mo · 500 ≈ ~$1,900/mo · 1,000 ≈ ~$4,500/mo
- "Active" is the real number — most signups won't use it daily.
- The give-to-get gate throttles spend for free; moving SMS → app later drops
  per-question cost to ~½¢ (Claude only).

## Two gotchas to respect before going wide

1. **A2P 10DLC registration** — a public high-volume SMS line MUST be properly
   carrier-registered or it gets throttled/blocked as spam. Get this right
   before the floodgates.
2. **TOS + PII wall** — (a) terms that the data techs enter is ours to
   aggregate/learn from; (b) a hard wall so customer PII never enters the
   shared corpus. The learning layer sees only
   `model + symptom + part + outcome`, never names/addresses.

## Product split this implies

Two products, one brain:
- **Ant Ops** — the full TN Appliance platform (scheduling, warranty, office).
  Our 6 techs.
- **The Plug** — standalone, any tech anywhere, any job. Troubleshoot + find
  the part + log what worked. No company plumbing. This is the data pump.

The Plug is *simpler* than the full platform — it's the troubleshooter +
parts-finder + 60-second tuple capture, stripped of company-specific ops.

## Validation in the wild

The Datarails ad ("Claude Can Answer Finance Questions Now — because your
financial data is finally connected") is our exact pattern, already being
sold by a funded company. Ours is stronger: they're a *connector* to data that
already exists; **we're the only source** of the repair tuples.

## Open questions / next moves

1. **Cold-start intelligence** — must be smart at N=0 techs (Claude general
   knowledge + web search + our existing 6-tech TDR data) so early users stick.
2. **Soft-launch vs gate** — confirmed: launch soft, add the gate later.
3. **Spec the MVP against existing infra** — exactly which pieces of
   `tech-assist-brain` / Telnyx / the capture schema get reused vs net-new.
   (Teddy to greenlight when back at a computer.)
4. **First seed list** — which loyal guys + which respected community node to
   approach privately first.
5. **Trust-weighting** — weight each phone number by how often its tips
   correlate with good outcomes; garbage auto-down-weights.

🔌 **Get plugged in.**

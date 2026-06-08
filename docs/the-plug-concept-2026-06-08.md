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

## Getting the talent to swarm (growth + status psychology)

**Techs don't swarm to tools — they swarm to status.** Appliance guys are
proud, highly skilled, and treated like disposable labor by customers /
warranty cos / the office. The Plug is the first place that says *you're elite,
this is YOUR room, judged by the only people whose opinion matters — other top
techs.* Sell identity, not a part-finder.

**The mafia "made man" frame, operationalized:**
- You don't sign up — you get **put on** (a member vouches) or you **earn it**
  (drop 5 fixes that hold up → you're made). Earned entry = the prize.
- Getting made is a **moment** + a permanent rank badge, not an "account created."
- **Vouching puts your rep on the line** → self-polices quality, makes every
  member a careful recruiter.
- **Ranks are territory** — "Capo of Samsung," "OG on LG." A scoreboard for the
  craft that exists nowhere else.
- **Omertà** — take from the family, don't leak to outsiders. In-group/out-group
  is what makes people claw to get in.

**Scarcity lives on the RANK (forever), not on entry.** Rookies flood in =
volume = the database. Becoming a **Plug** stays rare = the craving. The pyramid
gives you swarm AND status, no tradeoff.

**The land grab:**
1. **Crown the kings first** — get the 15–20 most respected/loudest names in as
   founding "Originals" before anyone else. Talent follows the names.
2. **Invite scarcity** — each made man gets ~3 invites; "I can get you on" =
   social currency (Gmail/Clubhouse playbook).
3. **Founding badge that can never be earned again** → urgency to get in now.
4. **Out-answer the groups in public** — the demo recruits itself.
5. **Physical swag = billboards** — challenge coin / patch / toolbox decal for
   high ranks. Tradesmen love earned hardware.
6. **Leaderboards + seasons** — monthly top Plug per brand/region.

## Scouting the founding family — FB labels are the report

Facebook's auto-assigned engagement badges literally flag who to recruit. In
**Appliance Pro Talk** (scouted 2026-06-08), the signals are:
- 🏆 **All-star contributor** / ⭐ **Rising contributor** = the guys already
  answering for free, who the room respects. Highest-value recruits: they like
  sharing, have brand expertise, carry weight.
- ✅ Verified + business owners with follower counts = multipliers.

Starter shortlist from one scroll (verify spellings): Peter Bullock, Corbin
Calande, Nathan Gendle, Michael DiBenedetto (All-stars); AN DY, Bill Kelley
(Rising); T.K. Cousins (co-owner, Richmond Appliance Guys, 2.2K followers);
Marcus-Josilyn Boyd (verified, respected voice). Dan P / Fred's Appliance
Academy is a community/training node — potential partner OR competitor; approach
carefully.

**The community is asking for The Plug right now:** the Samsung **STG** app's
free ride ended and techs are openly posting *"what's everyone using for tech
data now?"* — The Plug is the literal answer to a question on the screen this
week. The "Amazon has the part for $X" job-loss posts validate the dual-tier
strategy as a top pain.

## Recruiting with nothing built — concierge Phase 0

**"Nothing built" is the pitch, not the problem** — and we already have the
engine (`tech-assist-brain` extracts model/part/fix from a text today). For
15–20 guys you don't need the app wrapper.

**Be the Plug by hand (Wizard-of-Oz / concierge):** a guy texts a model +
symptom → Teddy runs it through Ant → texts back the fix. Zero code. Delivers
real value, loads the first tuples, and *is* the founding-member experience
("I had Teddy's personal line before there was an app"). Standard pre-launch
playbook (DoorDash/Airbnb/Stripe all did manual-first).

**Message templates** (recognition-led, peer-to-peer, never say "AI", never
"startup"):

> DM: *"Hey [name] — you're clearly one of the real ones in here, always got
> the answer. I'm putting together a small private crew of the best appliance
> guys to trade tricks of the trade — every brand's secrets in one spot, good
> AND bad part numbers. Bring a fix, get a fix. Invite-only and early, so the
> first guys in are the founders — The Originals. Want first seat? No catch —
> just text me a model that's giving you hell right now and I'll show you what
> it does."*

> Short: *"Yo [name] — building a private line where top techs trade fixes
> across every brand. Want you in as a founder before it goes wide. Got a model
> stumping you right now? Text it to me, watch what happens. 🔌"*

> Public (on the STG "what's everyone using for tech data?" thread): DON'T
> pitch — drop the actual helpful answer, be the guy who had it. When "how'd you
> get that?" comes back → "been building something for exactly this, DM me to
> get in early."

**The tiny ask** ("text me a stumper") turns a recruit into an instant demo +
your first data point, no commitment. "Early/founder/Originals" makes unbuilt
the flex. Let the answers convert — these guys are tool-burned and AI-skeptical,
so front it human, keep the engine under the hood.

## The Reply Co-Pilot (the legit "create interest" engine)

The legitimate, more-effective version of "drive engagement / create interest"
— **NO scrapers, NO engagement bots, NO fake accounts.** (Those torch the FB
account that IS our distribution, and astroturfing an AI-skeptic community
torches the reputation that IS the moat. Don't.) Instead: make Teddy — and
later each founding member — the fastest, sharpest guy in every thread, posting
as a real human.

**What it is:** a tool that drafts a fast, accurate, in-Teddy's-voice answer to
any appliance question he *chooses* to respond to. He reviews + posts it
himself. Ant is the co-pilot; the human is the author.

**The loop:**
1. Teddy sees a question (group thread, or a guy texts him) → feeds it to Ant
   (paste text and/or a photo of the model sticker / error code / failed part).
2. Ant returns: (a) a draft answer in tradesman voice — short, confident,
   tech-to-tech, no AI tells; (b) part #(s) with a confidence tier; (c) 1–2
   clarifying questions to ask if the info is thin.
3. Teddy edits + posts it himself (copy-paste). **Human-in-the-loop, always.**
4. The exchange is captured as a tuple (model + symptom + answer) — so even his
   public helping loads the corpus.
5. When possible, a "did it work?" follow-up labels the tuple good/bad.

**Design rules (non-negotiable):**
- **Human posts. Always.** Never auto-post, never a fake account. Drafts only.
- **Voice match** — write like a tradesman, not a chatbot. No "Great question!",
  no bullet-essays, no "consult a professional." Seed it with a few of Teddy's
  real past answers to mimic. This is what keeps it out of the AI-tell trap.
- **Confidence + honesty** — if the part # isn't sure, say so / ask a clarifying
  Q rather than guess. A wrong public answer is reputation poison; that's the
  one thing that kills credibility in the room.
- **Vision in** — techs post photos; Ant reads model stickers / error codes /
  parts (same signed-S3 path `tech-assist-brain` already uses).
- **Fast** — Haiku for speed, escalate to Sonnet/Opus on the gnarly ones.

**Why it doubles as the recruiter:** every fast, dead-on public answer is a live
demo. "How'd you get that so fast?" → DM → founding invite. It makes Teddy (and
his Originals) *visibly* the best in the room — and status is what pulls talent.

**Build:** it's a sibling mode of `tech-assist-brain` — instead of "scribe the
tech's TDR," the prompt is "draft a public-ready answer + capture the tuple."
- **Phase 0 (concierge, ~now):** Teddy texts Ant a question → gets a draft →
  posts it. Minimal lift (a prompt variant on the existing brain).
- **Phase 1:** dedicated co-pilot surface (simple page or SMS mode) with voice
  examples, vision, confidence tiering, and tuple capture into The Plug corpus.
- **Phase 2:** give the co-pilot to founding members — turns each into the
  sharpest guy in their room AND multiplies the data inflow.

**What we will NOT build:** FB scrapers, auto-commenters, fake-engagement bots,
sock-puppet accounts. Off the table — ToS + reputation suicide. The data techs
*give* us beats data we'd steal, and authenticity is the moat.

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

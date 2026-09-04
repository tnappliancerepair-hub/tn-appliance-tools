# 🌐🐜 The Network Play — how 50 shops on AssistAnt lift each other (AI · Google · everywhere)

*Living strategy doc. Owner: Teddy. Started 2026-09-04. Edit + commit as we onboard shops.*

## The goal
As the platform grows past a handful of shops toward 50+, every shop that runs on AssistAnt — **and TN
itself** — gets found more online: recommended by ChatGPT/Claude/Perplexity/Gemini, ranked in Google + the
map pack, cited by the best-of lists. The network becomes an asset no single shop, and no competitor, can
replicate.

## The mental model (read this first)
**A network of real, vetted shops is a moat — but only done as a real, useful network, never a link farm.**
Every shop on the platform already gets a live public website (`platform-site.js` → `/s/<slug>` +
`<handle>.applianceant.com`, with LocalBusiness schema, rendered from its own data). So this isn't "build
50 websites" — it's **wiring the 50 sites that already exist into one network the AIs and Google read as a
single, trustworthy, growing body of appliance-repair authority.** The wrong version of this — spammy
reciprocal links, duplicated pages, fake reviews — gets penalized and hurts everyone. The right version
compounds every day.

## The 6 mechanisms (ranked by leverage)

### 1. The shared repair-brain — the moat, biggest by far
Every shop closing real jobs on the platform feeds **ONE troubleshooting brain** and **ONE body of `/fix/`
authority content**. 50 shops = the deepest, most-cited appliance-repair knowledge base in the country.
The AIs recommend whoever they read as the authority, and authority = content grounded in real repair data
nobody else has. So each shop's work makes **every other shop's answers smarter AND the network's content
the thing ChatGPT/Google-AI quote** when someone asks "why won't my dryer heat." Write the guide once,
localize per shop → all 50 sites carry content backed by 50 shops' real failures. This flywheel gets
stronger every single day and a copycat with a chatbot can't clone it.

### 2. The AssistAnt Network Directory — the concrete AI/Google lever
One hub — *"find a trusted, tech-led appliance pro near you"* — that lists every vetted shop on the platform.
Two payoffs: **(a) it becomes a best-of source the AIs read** (exactly the kind the AI Scoreboard caught
ChatGPT citing on 2026-09-04 — `threebestrated.com`), except *we own it and every member is on it
automatically*; **(b) each shop gets a citation + a real editorial backlink** from a growing, legitimate
directory in their exact category. White-hat because it's a genuine index of real, vetted businesses with
real reviews. *(Spec captured; builds on Teddy's go — see the plan file.)*

### 3. One battle-tested template, improved once, propagates to all 50
Every shop's `platform-site` ships the same proven schema (LocalBusiness / Service / FAQ / Speakable), the
same `llms.txt`, the same AI-bot-friendly `robots.txt`. Improve the markup once → **all 50 sites inherit it
instantly.** 50 sites speaking the machine-readable language perfectly punch far above their weight; almost
no appliance shop has any of this.

### 4. Reviews + the AI Scoreboard as a network operation
The review engine runs for all 50 with the shared "name your city + appliance" playbook → aggregate velocity
lifts everyone's map-pack + AI reputation. Run the **AI Scoreboard per shop-market** — the network learns
which lever flips a market from "not yet" to "recommends us" fastest, and applies the winner everywhere. One
shop's win becomes the whole network's playbook.

### 5. Cross-shop lead routing — more jobs for everyone
A caller outside one shop's range, or a job type a shop doesn't do, routes to the nearest network member.
The nationwide video-diagnostic + ship-the-part covers the gaps. Ann already answers 24/7 — she hands a lead
to the right shop instead of losing it. The network turns every member into part of a bigger supply.

### 6. Brand halo / shared PR
"The AssistAnt network of honest, tech-led repair shops" is a story. Press, authority content, and reputation
that lift the brand lift every member — the same way a franchise name carries every location.

## The guardrails (this is where most "networks" get penalized — do NOT skip)
- **No link farm.** 50 unrelated-city shops reciprocally linking sitewide = a Google penalty. Cross-links stay
  **editorial**, flow *through the real directory*, and are geographically sensible — never shop-to-shop spam.
- **No duplicate content.** Each shop's pages must be genuinely localized or canonicalized — the exact thin-
  doorway trap TN already hit with mass city landers. The repair *data* is unique per shop; the templates must
  localize, not copy.
- **Real reviews, real businesses only.** The whole thing works *because* it's authentic. One fake listing
  poisons the network's trust with Google + the AIs.
- **Each shop stays its own entity.** Its own name/address/phone, consistent everywhere (per
  `docs/best-of-listicle-targets.md`). We amplify each identity; we don't blur them.

## Honest state (2026-09-04)
Today the network is small — TN + a few real friend-shops (Classic Automotive, Music City Aquatics, Mid Tenn
Furniture, NextGen Motors, The Appliance Guy) + internal test/demo tenants. So the directory is a **modest hub
now that compounds into a genuine best-of source at scale.** Build it early so it's ready and grows
automatically as shops onboard — the moat (#1, the shared repair-brain) is already accruing with every job
the platform closes.

## Priority sequence
1. **Ship the network directory** (mechanism #2) — the one concrete AI/Google asset. Spec is captured in the
   plan; build on Teddy's go. Curated (only `settings.site.listed=true` active shops), dynamically served,
   emits `ItemList`/`LocalBusiness` schema, added to `llms.txt` + `sitemap.xml` + IndexNow.
2. **Keep the shared template sharp** (mechanism #3) — every schema/llms improvement propagates free.
3. **Run the AI Scoreboard per market** as shops onboard (mechanism #4) — measure the lift; apply winners.
4. **Wire cross-shop lead routing** (mechanism #5) when there are ≥3 real shops in overlapping regions.
5. The repair-brain (mechanism #1) needs no action — it compounds automatically with every closed job.

## Changelog
- 2026-09-04 — doc created. Network-effect strategy captured after Teddy asked "how do we leverage all our
  clients to help everyone's internet/AI presence." Directory spec'd (build gated on his go); the shared
  repair-brain identified as the uncopyable moat.

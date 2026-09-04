# 🤖🏆 Become the #1 AI-Referred Appliance Repair Company — Middle TN · Clarksville · Louisiana

*Living strategy doc. Owner: Teddy. Started 2026-09-04. Edit + commit as we learn.*

## The goal
When anyone in our areas asks **ChatGPT, Claude, Perplexity, Gemini, or Google's AI** *"who's the best
appliance repair near me,"* TN Appliance Exchange is the name they get — first, and most often — across
**Nashville/Middle TN, Clarksville, and Louisiana (Baton Rouge + both Shores).**

## The mental model (read this first — it's the whole game)
**No AI has a secret "who to recommend" list, and nobody can pay to be "the AI's pick."** When an AI answers
*"best appliance repair in Clarksville,"* it **synthesizes from the sources it can read at that moment.** So
winning = **engineering those sources so that, whatever the AI reads, we're present, consistent, and framed as
the best.** Anyone claiming a direct "rank me in ChatGPT" lever is selling snake oil.

**What the AIs actually read, by weight:**
1. **Third-party "best-of" lists + directories** (Yelp Top-10, Three Best Rated, Expertise, Angi…). AIs quote
   these heavily. ← *our biggest gap; competitors are on them, we're not.*
2. **Reviews** — volume, recency, and whether they **name the city + appliance.**
3. **Google Business Profile / Maps** — rating, category, photos, service area.
4. **Web consensus** — the same name/address/phone/facts everywhere = the AI trusts the entity.
5. **Our own authority content** — the `/fix/` guides make AIs treat us as the experts (→ "who should I hire").

## Our head start (already built)
- `llms.txt` (a profile written for the AIs) · full LocalBusiness schema (logo + all 5 techs as `employee`) ·
  `robots.txt` welcoming GPTBot/ClaudeBot/PerplexityBot/Bingbot · **142 `/fix/` guides** with FAQ/HowTo/Speakable
  schema (the exact markup AI Overviews lift) · near-maxed Google profile + Cybertruck cover · a review engine ·
  a live ChatGPT Ad · the **AI Scoreboard** (below). The engine is built — now we aim it at the sources + markets.

## The 6 pillars

### 1. Get onto the "best-of" lists AIs quote  — *biggest lever · off-site · Teddy/CSR*
Submit to every target with **identical** name/address/phone (see `docs/best-of-listicle-targets.md`):
Three Best Rated ⭐, Expertise.com ⭐, Angi, Thumbtack, HomeAdvisor, HomeGuide, Bing Places, Apple Business
Connect, Yelp (merge the duplicate), Nextdoor, BBB. (⭐ = highest value; curated lists AIs cite verbatim.)

### 2. Reviews that name the city + appliance — in EVERY market  — *Claude tunes the ask · crew executes*
AIs recommend *"Baton Rouge appliance repair"* by finding reviews that literally say **"Baton Rouge" + the
appliance.** So: keep velocity high **separately in Clarksville, Middle TN, and Louisiana**, and coach customers
to mention **their city + what we fixed.** (The review-ask wording is being tuned to nudge exactly that.)

### 3. Own the "how/what" answers — *Claude deepens `/fix/`*
When someone asks an AI *"why won't my dryer heat,"* our guide should be what it cites. That authority ("these
are the appliance experts") is a short hop to being the hire recommendation. Keep deepening the `/fix/` library
— real repair data nobody else has = uncopyable moat.

### 4. Clean the "entity" so every source agrees — *off-site · Teddy* — fixes the "used-store" problem
Some sources still tag us a **used-appliance store** (the old "Exchange" ghost), which suppresses *repair*
recommendations. Fixes: merge the duplicate Yelp listing · every profile category = **"Appliance repair
service"** · kill/redirect the old `tnappliancerepair.com` site. When the web stops disagreeing about what we
are, AIs start trusting + recommending us.

### 5. Feed the AIs directly — *done; maintain*
`llms.txt` + schema + AI-crawler welcome. Keep truthful + sharp.

### 6. Win each market on its own — *both* — **Louisiana + Clarksville are the opportunity**
"Nashville" ≠ "Baton Rouge" ≠ "Clarksville." Each needs its own reviews-naming-the-city, GBP service-area
verification, and local presence. Nashville/Middle TN is already strongest; **Louisiana (Andre + John) is the
biggest untapped upside**, Clarksville (Lee) second.

## Measurement — the AI Scoreboard
`ai-scoreboard.html` (owner-gated) **actually asks ChatGPT (OpenAI) + Claude (Anthropic), with live web search,**
the money question per market — *"best appliance repair company in {market}"* — and reports whether **we're named
/ recommended**, plus which competitors show up. Stored each run so we watch the line climb per market, per model.
- Refresh: `ai-scoreboard?secret=<admin>&run=1` (kicks a fresh poll) → view `ai-scoreboard.html`. Auto-runs weekly.
- Backed by `ai-discovery-check` (asset-health + Google-rank proxy) for the foundational signals.

## Priority sequence (biggest bang first)
1. **Teddy/CSR:** Three Best Rated + Expertise + Bing Places + Apple Business Connect this week (checklist ready).
2. **Claude:** tune the review-ask → customers name **city + appliance**; push across all 3 regions.
3. **Teddy:** Yelp merge + "repair service" category + retire the old domain (the used-store fix).
4. **Claude:** the AI Scoreboard (baseline + weekly trend, per market).  ← built
5. **Both:** a **Louisiana** review + listings push (weakest, highest upside).

## Honest truths
- This is local-SEO + reputation fundamentals **aimed at the sources AIs synthesize** — done more thoroughly
  than 99% of appliance shops. There is no shortcut or direct "AI ranking" button.
- The biggest remaining levers are **off-site + human** (list submissions, reviews naming each city, entity
  cleanup). Code + content set the table; those close the deal.
- Geo is per-market: winning Nashville does not win Baton Rouge. Each market is its own scoreboard line.

## Changelog
- 2026-09-04 — doc created; AI Scoreboard built (polls ChatGPT + Claude per market); homepage logo + tech-photo
  schema shipped; Cybertruck set as GBP cover (Teddy).

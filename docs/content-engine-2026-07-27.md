# 🎬🐜 The Content Engine — becoming THE appliance content operation

**Living plan. Started 2026-07-27.** Sister doc to `docs/ant-operating-plan.md`.
Goal: make TN Appliance Exchange the default face + answer for appliance repair
across every platform, every symptom, every model, every language — by turning
our daily reality (real techs, real jobs, the repair corpus) into a content
firehose that runs with near-zero manual editing.

> North star: **volume × authority × omnipresence.** More clips than anyone,
> every one backed by real repair data nobody else has, blanketing the long tail
> (brand × symptom × model × fault-code × language) on every platform + Google +
> the AI answer engines. First, most authoritative, most numerous = the default.

---

## The machine (the loop)
**Capture → Produce → Distribute → Learn → Convert → repeat.**
The whole game: make CAPTURE effortless + habitual, automate everything downstream.

## Division of labor
**The crew's job (only real human work — automation can't fake it):**
1. **Footage flow.** Each tech grabs **2–3 short moments per job** (the reveal, the
   fix, the verdict — 30–60s vertical) **+ one long ride-along per week** (one 20-min
   ride-along → Vizard cuts 5–10 shorts = a week of content from one recording).
2. **A content owner** (Teddy or one tech) who makes sure footage flowed today.
3. **Approve/post** from the Studio (until auto-post is earned) + **reply to comments.**
4. **Fund the paid tiers** — Submagic / Vizard / ElevenLabs upgrades unlock polish
   (no watermarks, more clips, higher limits, faster renders).

**The machine's job (what's built / being built):** captions, hooks, reframing,
thumbnails, SEO titles, series formatting, real-data overlays, translation,
scheduling, cross-posting, and the learning loop.

---

## Build phases

### ✅ Phase 1 — make every clip influencer-grade *(SHIPPED 2026-07-27)*
The quality gap + the channel identity, grounded in the moat data.
- **Series presets** (`_lib/content-series.js`) — 6 franchises so the feed reads as a
  *channel*: ⭐ Hero · ⚖️ Fix or Toss? · 💀 What killed this appliance? · 🔎 Model # →
  the exact part · 🚨 Fault-code explainer · 🔧 Quick tip. Each drives hook flavor,
  SEO title pattern, CTA, and hashtags.
- **Grounded hook engine** (`hook-doctor.js`) — series-aware; pulls REAL stats via
  `ant-brain-predict` (how many of these we've fixed, the part we see fail most) +
  repair-vs-replace math (`repair-menu`). Returns a burnable **on-screen hook**, **5
  labeled hook angles** (curiosity / price-shock / mistake / stat / verdict), and an
  honest **proof line**. Hard rule: it only uses the exact numbers given — never
  invents counts/parts/prices when the corpus is thin.
- **Studio UI** (`video-studio.html`) — the New Clip form has the Series picker +
  Appliance/Brand + a **pre-build "🎣 Suggest hook"** that fills the burned on-screen
  hook and shows the proof line + real-repair stat. Post-build enrich stores + shows
  all of it; captions lead with the hook + proof line. Series/appliance/brand/model
  ride on the job (`video-submit` → `video-queue`) so every clip's hook is grounded.

**Why it's the moat:** a ChatGPT clone can copy a caption; it can't copy 8 years of
our repair outcomes. The stat hook + proof line come straight from our TDR corpus and
compound as every new job is logged.

### Phase 2 — get found + look pro
- Auto **YouTube thumbnails** (frame grab + bold text + circle on the failed part, on
  canvas like the review cards).
- **SEO titles matched to real search demand** (fault codes / models / symptoms via
  GSC) so shorts get discovered, not just fed.
- **On-brand identity** — "{Tech} • TN Appliance 🐜" lower-third, consistent
  intro/outro/watermark.

### Phase 3 — the firehose (volume + cadence)
- Dial in the **ride-along multiplier** (Vizard best-moment ranking surfaced).
- **Daily shot-list auto-generated from real jobs** (wire `content-ideas` → the Studio
  as "film this today").
- **Scheduled multi-platform posting** at optimal times + an **auto-post trust ladder**
  (draft → approve → full auto for proven formats).

### Phase 4 — own the wide-open space (multilingual)
- Auto-dub the winners into **ES / VI / ZH / RU** → distribute to the language funnels
  already built. Almost no appliance creator touches this; it feeds the intake pages.

### Phase 5 — learn + compound
- **Performance read-back loop**: pull views/retention/saves/follows per clip; the
  engine makes more of what wins and the shot-list tells the crew what to film next.
  Feed clip→lead attribution into the Ant Brain.

### Phase 6 — always-on autopilot
- Job completes → Studio auto-drafts the clip idea from the TDR + media the tech
  already captured → tech records the one missing shot → auto-produced → auto-posted.
  The job itself becomes content with near-zero extra effort.

---

## Scoreboard (how we know we're winning)
- Clips produced / week (volume) · % using a series format (identity)
- Views + retention + follows per platform (reach) · saves + shares (value)
- Search coverage: # of brand×symptom×model×fault-code queries where we appear
- Clip → intake clicks → paid Quick Checks (the funnel payoff)

## Operator actions (only Teddy can do these — the real bottleneck)
1. Lock the **capture habit**: 2–3 clips/job + one ride-along/week; name a content owner.
2. Greenlight the **paid-tier upgrades** (Submagic/Vizard/ElevenLabs) — unlocks the polish.
3. Brief the crew on the 3 shooting rules: **start mid-action, camera on hands+face
   during the reveal, one idea per clip.**

## Changelog
- **2026-07-27** — Doc created. Phase 1 (grounded hook engine + series presets) shipped.

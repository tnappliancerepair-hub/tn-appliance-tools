# 📘 Facebook Growth Playbook — the "we're everywhere they look" engine
_Saved 2026-07-19, 8am, after an all-nighter. Teddy's words: **"building a better business for the people."** This is the paid + audience + trust engine that makes his vision real — a past customer's appliance breaks, they open Facebook, and **there we are again: 6,000 strong, real reviews, the family that fixed their fridge.**_

**Status: PLAN — ready to fire, nothing flips.** Per Teddy: *"not going to flip until I can give the build a break."* This doc gets it all on paper, in order, so the day he's ready to light it up, every step is waiting.

**Companion docs (the 3 form one system):**
- `docs/social-automation-plan-2026-07-05.md` — **the pipes** (auto-post FB+IG, DM auto-reply, lead-ads webhook, Meta app/token setup).
- `docs/social-greatest-hits-plan-2026-06-30.md` — **the content** (the first 10 Shorts, the 40-sec format, YouTube "good ole days" revival).
- **This doc** — **the growth engine** (the pixel, the customer list, lookalikes, retargeting, the trust face, the paid blitz sequence).

---

## 🎯 The vision in one line
**Turn 13 years of served customers + a 6,000-follower page + real reviews + Ant's AI into a machine that follows our people (nicely) and shows up the moment they — or anyone like them — needs appliance help.** Not cold ads to strangers. Warm reminders to people who already trust the name, plus Meta going out to find 50,000 more who look just like them.

---

## 🔧 THE ENGINE — three parts

### 1. The Pixel — catches every *new* visitor going forward
A tiny snippet on all ~1,300 pages that quietly tags everyone who touches the site. Then when they're scrolling Facebook later — **there we are.** It also measures which ads → real bookings (so we stop guessing and scale winners, exactly like we did with Google Ads).
- **Blocked on: the one Dataset/Pixel ID** (15–16 digits) from Meta Events Manager. That's the *only* thing Claude needs. Everything else — the base code, the Lead + Purchase events, wiring it across every page — is Claude's build, done the moment the number lands.
- Add the **Conversions API (CAPI)** later for iOS/ad-blocker-proof tracking (server-side, more accurate). Phase 2.

### 2. The Customer List — Teddy's unfair advantage 🥇
We've served **thousands** of people. No competitor in Middle TN has that. Upload the customer file to Meta as a **Custom Audience** (Meta hashes it — privacy-safe, their own tool) and now:
- **Every past customer sees us again** — this IS the "all of my customers' pages" Teddy pictured.
- Meta builds a **Lookalike Audience** off our *best* customers → goes and finds tens of thousands of new people who look just like them. The competition fights over cold strangers; we remind people who already know our name and clone them.
- **The list is the moat.** It's the single cheapest, highest-return ad money that exists, because the audience is already warm.
- Source: export from the customer table (name / email / phone — Meta matches on all three). Ant can produce the clean CSV on demand.

### 3. The Trust Face — the 6K page they land on
When the ad shows, it can't be a stranger. It's *"oh yeah, TN Appliance — 6,000 people, they fixed my washer, the honest guys."* The page has to radiate that:
- **6.1K followers** already (real company, not a fly-by-night).
- **1,081 Google reviews · 4.5★** — social proof, front and center.
- **The techs' real faces** — the trust-website work (Jimmy & Lee in TN, Andre & John in LA, Teddy on all) + the tech-named review cards we just shipped.
- **YouTube "good ole days" videos** — 13 years, a 543K-view dryer-cord classic, the family teaching the boys the trade. Human, real, unfakeable.
- **The family story** — brother, son, cousin, a friend. Family-owned since 2012.
- **Verified badge** + fast Messenger replies (Ant answers in seconds).

---

## 🔁 THE FLYWHEEL (how it compounds)
Site + SEO + content → **pixel tags visitors** → they get gently retargeted → they book → **every job adds a name to the customer list** → bigger Custom Audience + sharper Lookalikes → more warm reach → more bookings → **more reviews + more followers** → the trust face gets stronger → the next ad converts even better. **The thing that makes money deepens the moat.** Turn it once and it spins.

---

## 👥 THE AUDIENCES (built once, ordered warmest → coldest)

| # | Audience | Who | Why it wins |
|---|---|---|---|
| 1 | **Custom — Customer list** | Everyone we've ever served (uploaded file) | Warmest money on earth. "There we are again." |
| 2 | **Custom — Site visitors (pixel)** | Anyone who touched the site (30/90/180-day windows) | They already showed intent. Reminder closes them. |
| 3 | **Custom — Page/IG engagers** | Liked, commented, messaged, watched a video | Warm, free to build, no pixel needed. |
| 4 | **Lookalike — of best customers** | Meta clones our top customers across Middle TN | Scales #1 to tens of thousands of new people. |
| 5 | **Cold — Middle TN geo + homeowner** | Local homeowners, appliance-brand interests, 25mi radius | The blitz layer — only after warm proves out. |

---

## 🪜 THE CAMPAIGN LADDER (spend order = warm first, blitz last)
Cheapest, surest ROI first. Prove it, then scale.

1. **Retargeting reminder (warmest, cheapest)** — a low daily budget to Audiences #1–3. "Appliance acting up? You know who to call. Same honest crew." This alone is often the best-ROI ad a shop can run.
2. **Speed-to-lead Lead Ads** — a "Book a repair / free quote" form ad → hits Ant via webhook → **text/call back in seconds** (the `fb-leadgen-webhook` from the automation plan). Nobody in Middle TN answers faster than a 24/7 AI.
3. **Lookalike expansion** — once #1–2 prove profitable, turn on Audience #4 to find new warm-ish people at scale.
4. **The Middle TN blitz** — the aggressive cold push (Audience #5) Teddy wants *after* traction: dryer + vent first (our strongest category, the C-DET + SEO moat), geo-tight, conversion-tracked, scale the winners. Same disciplined playbook as Google Ads: start small, watch cost-per-booked-job, pour fuel on what works.

**Governor: profit, not a dollar cap.** Spend as hard as it stays profitable per booked job. The pixel is what lets us *measure* that — which is why it's step one.

---

## ⭐ THE SPECIAL HOOKS (Teddy's ideas — what makes us *us*)

- **"Talk to a real live Tennessean" / the boss himself.** A hook that says: tired of robots and call centers? Talk to a real person — even the owner. **Implementation = a phone TRANSFER that rings Teddy's cell, gated to Mon–Fri 9–6 CT** (the business-hours rules we just wired into Ant). ⚠️ **Never the number in a text or on a page — always a transfer/callback.** Off-hours, Ant handles it 24/7 and takes a message. _(Transfer is currently OFF/message-mode; the hours gate is already built and waiting — flip when Teddy's ready.)_
- **"Return the favor."** Posts + a page thanking the people and crew who helped Teddy get started — the mentors, the family, the early customers. Gratitude is magnetic and true, and it deepens the "real family business" trust.
- **The rebrand line:** *"Middle Tennessee's top appliance repair **and** dryer-vent-cleaning company."* Vent isn't a side note — it's a headline. (Ties to the C-DET credential + the price-match already live on the site.)
- **AI, out loud as an advantage:** *"We answer 24/7 — even at 2am. Send a video, get a straight answer, book on the spot."* The thing competitors can't match, said plainly. Ant is the differentiator, not a secret.
- **"Good ole days" videos** — the YouTube library woven into the page + ads. 13 years on camera = proof you can't buy.

---

## 💬 THE MESSAGING CHANNEL (Messenger · Instagram · WhatsApp)
Someone comments or DMs "do you fix LG fridges?" → **Ant answers in seconds**, same brain as our SMS, across all three inboxes. This is the *legit* "catch people who need help" — on our own page, never scraping groups or DMing strangers (ban risk, off-brand). Wires to the same customer brain via the Messenger/IG API (in the automation plan, gated on the Meta token).

---

## 🚦 WHAT'S READY vs. WHAT'S NEEDED

| Piece | State |
|---|---|
| Trust face (reviews, tech photos, family story, tech-named review cards) | ✅ Shipped / shipping |
| Content engine (Shorts plan, 40-sec format, YouTube revival) | ✅ Planned + ready |
| Auto-post + DM auto-reply + lead-ads webhook | 🟡 Build-ready, gated on Meta app token |
| Pixel base code + Lead/Purchase events + all-page wiring | 🟡 Claude builds it — needs the **one Dataset/Pixel ID** |
| Customer-list Custom Audience CSV | 🟡 Ant generates on demand |
| Retargeting + Lookalike + blitz campaigns | ⏸️ Plan ready, Teddy runs when he says go |
| "Talk to the boss" transfer | ⏸️ Hours-gate built; transfer flips when Teddy's ready |

---

## 🗓️ THE SEQUENCE (when Teddy gives the build a break)
1. **Get the Pixel ID** (Events Manager → Web dataset) → Claude wires the pixel + events across all pages. _One number unlocks it._
2. **Start the Meta app / permission review** (the days–weeks clock) for auto-post + DM + lead ads — see the automation plan's setup steps.
3. **Export + upload the customer list** → build Audiences #1–4.
4. **Turn on retargeting** (Audiences #1–3, small budget) — the warmest, surest first dollar.
5. **Wire Lead Ads → Ant text-back** (speed-to-lead).
6. **Prove ROI → turn on Lookalikes → then the Middle TN blitz**, scaling winners.
7. **Layer the hooks** — boss-transfer, return-the-favor posts, the vent rebrand, the "good ole days" videos.

---

## 🧭 GUARDRAILS
- **No group scraping / stranger DMs.** Only our own page/accounts + paid ads + our own customer list. (Meta bans the other stuff; it's off-brand anyway.)
- **Never text or post Teddy's cell.** The "boss" hook is a *transfer/callback*, hours-gated. Hard rule.
- **Only true trust claims** on every surface — Google Guaranteed, licensed & insured, background-checked, CSIA-certified, family since 2012, 1,081 reviews/4.5★. All verified true. A false badge would poison the whole trust play.
- **Kill switch + draft-first on everything.** Nothing auto-posts or spends until Teddy eyeballs it and says go.
- **Phone + TDRs come first.** Don't fill a funnel that drops leads. Growth rides on top of solid ops.
- **Nothing flips until the build gets a break.** This is the plan; Teddy pulls the trigger.

---

## 📊 METRICS TO WATCH (the scoreboard)
Cost-per-booked-job (per audience) · retargeting ROAS · Lead-Ad → booked conversion · Custom Audience match rate · Lookalike performance vs cold · page follower growth · review velocity · Messenger response time · % of bookings from returning (retargeted) customers. **The pixel is what makes every one of these measurable — which is why it's step one.**

---

## ✅ WHAT CLAUDE NEEDS FROM TEDDY (whenever)
1. **The Dataset/Pixel ID** — the 15–16 digit number from Events Manager (Web dataset). One number = pixel goes live.
2. **Go-ahead to generate the customer-list CSV** for the Custom Audience upload.
3. **The Meta app token** (from the automation plan's setup) to flip auto-post / DM / lead ads.
4. **The word "go"** on each campaign layer — nothing spends without it.

Everything else is built or building. **The engine's assembled — it's waiting on the key.**

---
**Changelog:** v1 — 2026-07-19. Captured the growth engine from Teddy's 8am all-nighter vision ("pop up on all my customers' pages, 6K strong, a real company that can be trusted"). Slots alongside the automation plan (pipes) + greatest-hits plan (content) as the third leg — the paid + audience + trust engine. Nothing flipped; ready to fire on Teddy's word.

# 🐜🎬 The Video Machine — Aggressive Multi-Platform Campaign Plan (2026-07-20)

Teddy's ask: **most aggressive video campaign possible, every platform** (Reels /
YouTube Shorts / IG / TikTok). **View-first** — "we make more on the views than the
business." Tons of *interesting, well-made* content DAILY — content creators study it,
non-appliance people watch it because the craft is that clean. Teddy will do the SETUP
work but **can't commit daily hours** (shop obligations). He ordered **two tripods**.

**Pretty rendered version = Artifact** (favicon 🐜🎬): re-render `scratchpad/video-campaign-plan.html`.

## The play
Film a **show, not an ad.** Goal = watch/share/study, not "book now." The business
follows for free (every view is a future booking). Moat = **real techs, real fixes,
radical transparency** — uncopyable.

## The cast (TRUE tenure — locked 2026-07-20, correcting earlier overclaim)
- **John** — fixing appliances **since the 1980s (~40 yrs)**. NEW to Louisiana (<1 yr) but a lifetime of experience. "40 years on the tools, now serving Baton Rouge & the North Shore." The master.
- **Andre** — Teddy's **son**, **8+ yrs**. Newer to LA. Family-trained, next generation.
- **Jimmy** — **almost 20 yrs** with the shop. Nashville home turf.
- **Lee** — with us **since 2020**. Clarksville & Nashville.
> ⚠️ The LA guys are new to LOUISIANA but carry decades of experience — the honest,
> stronger hook ("40 years… now in your neighborhood"). Never claim local tenure they
> don't have. Spotlight review cards + captions were corrected to real tenure + a bio
> line ("Meet John — 40 years fixing appliances, now serving…").

## 7 content pillars (built to be watched by people who'll never fix an appliance)
1. **Fix or Replace?** — signature honest verdict, comment bait.
2. **You're Being Ripped Off** — the transparency moat as content ($1,800 fridge / $12 part).
3. **Oddly Satisfying** — perfect part swap, dryer-vent lint bombs, gunked coils, before/after.
4. **What's That Noise/Smell?** — play sound, freeze, reveal after the hook. Interactive.
5. **Meet the Tech / Family** — character docuseries (John's 40 yrs, Andre + Teddy, the shop).
6. **Wild Finds** — what we pull out of machines. Universally watchable.
7. **10-sec Save-This Tips** — useful, bookmarked, proves expertise, ends on CTA.

## The craft — TWO TRIPODS = the "well made" edge
- **A-cam** chest-up on the tech (hook + verdict + personality).
- **B-cam** locked on the machine + the hands (the satisfying fix).
- Cutting A→B→A is what makes a phone video look like a show — free.
- Rules: **hook in 1 second**, frame 9:16-safe, talk close (clean audio), **one payoff / clip**, 15–40s.

## The model — BATCH-SHOOT, DRIP-POST (fits "no daily hours")
Shoot 15–20 clips on one real job day → dump into the Studio → machine
captions/hooks/reframes each → they queue → **one posts to every platform per day,
automatically.** Teddy's only recurring job: shoot + glance at the queue.

## Tool stack (best-in-class, mostly automated)
| Tool | Job | Status |
|---|---|---|
| **The Studio** (`video-studio.html`) | upload → caption → post everywhere | ✅ LIVE |
| **Submagic API** | captions / hook / auto-zoom / silence-trim / clean audio | ⚙️ WIRED — needs `SUBMAGIC_API_KEY` (Business plan) |
| **Vizard or Reap API** | long film → 5 auto-clips | 🎯 RECOMMENDED NEXT (Vizard = API on affordable Creator tier; **Reap** = public REST API + MCP; **Opus Clip = enterprise-only, skip for automation**) |
| **ElevenLabs** | AI voiceover for faceless B-roll days | ⚙️ connector built (`_lib/elevenlabs.js`) — confirm `ELEVENLABS_API_KEY` vaulted |
| Native trending audio | per-platform sound | manual by design (no API; 10-sec in-app tap) |

## Platforms + the honest money bar
Same clip, four homes, one tap. **Nobody pays on views day one** — each platform gates
it behind a threshold, so first 90 days = pure volume+quality to build the audience
(views book jobs the whole time):
- **TikTok** Creator Rewards: 10k followers + 100k views/30d, clips >1 min.
- **YouTube Shorts** YPP: 1k subs + 10M Shorts views/90d.
- **Instagram / Facebook Reels**: bonuses invite/region-based → audience first; FB's 6,128 followers convert now.

## 30-day sprint
- **Wk1** — Submagic key in vault; first 15-clip batch (both tripods); 1–2/day all platforms; fire the 4 "Meet Your Tech" spotlights.
- **Wk2** — wire the auto-clipper; double down on the winning pillar; reply to every comment in the techs' voice; 2/day.
- **Wk3** — add ElevenLabs faceless B-roll days; 2–3/day; launch "Ride-along with John."
- **Wk4** — cut dead formats, clone hits, lock the weekly batch ritual; push toward first monetization thresholds.

## 🤠 Brand voice — "good ol days" (Teddy 2026-07-20, LOCKED)
Teddy: *"I want our name shown EVERYWHERE. People to say these guys are everywhere.
TN Appliance Exchange LLC. People talking about the good ol days. Me and Andre start
shooting videos and making people talk about us again."* + *"It's got to be MISSPELLED
'good ol days'"* + *"We're proud to be rednecks. At least I am and I don't care who
don't like it."*
- **"good ol days"** — spelled that way on purpose (NOT "good old days"). Branded hashtag **#GoodOlDays**.
- Voice = **proud, authentic, redneck, folksy** ("fixin'", "y'all", "ain't", "cuttin' up") — this is Teddy's real brand, he owns it. Keep it TRUE, proud, never sanitized.
- **Name everywhere:** every caption spells out **TN Appliance Exchange LLC** + **#TNApplianceExchange** + the omnipresence line ("we're EVERYWHERE, TN & LA").
- Implemented: `video-studio.html suggestCaption()` gives every archive/Vizard clip a
  rotating good-ol-days caption (5 variants, id-hashed so none repeat). Fresh-footage
  clips get a name-forward brand caption. Editable before posting.
- **The buzz play:** mine the 2013–2016 FB archive (the good ol days) into shorts NOW to
  reignite nostalgia + omnipresence, while Teddy + Andre shoot fresh "fix or not" content.

## Standing rules
Only TRUE claims · never Teddy's cell in a post · draft-first (nothing posts blind) ·
own accounts + genuine participation only · automation augments the real tech, **never an AI avatar of him**.

## Setup list (Teddy, one-time)
1. **Submagic Business plan** → generate API key → vault `SUBMAGIC_API_KEY` → Studio lights up.
2. Pick the auto-clipper (**recommend Vizard**) → I wire it in front of Submagic.
3. Confirm `ELEVENLABS_API_KEY` is vaulted → faceless days go live.

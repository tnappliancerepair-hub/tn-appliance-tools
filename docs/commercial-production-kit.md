# 🎬 Commercial Production Kit — AssistAnt (SaaS) + TN Appliance (repair)

_Companion to the Creative Concepts board (artifact `fe27a46a-876b-4280-9e19-00169f403854`). This is the
"how we actually make them" doc: full scripts, scene-by-scene AI-generation prompts, voiceover lines,
on-screen text, and music/pacing for the polished spots. Forwardable to an editor as-is._

> **The honest pipeline:** our system already CAPTURES, captions (Submagic), clips (Vizard), voices
> (ElevenLabs), and DISTRIBUTES video (one-tap `post-everywhere` → FB / IG / TikTok / YouTube). It does NOT
> generate video or images. So each spot below gives you the **script + the paste-ready generation prompts**
> to run in an external AI-video tool (Sora / Veo 3 / Runway Gen-4 / Kling) or hand to an editor. Render the
> shots → assemble in CapCut (or Premiere) → the finished clip drops straight into `video-studio.html` /
> `post-everywhere` and ships everywhere in one tap.
>
> **The moat, restated:** even a fully AI-produced spot lands because a real appliance-shop owner is behind
> it. Where you can be on camera (the Founder Film especially), do it — real beats slick. Use AI render for
> the shots you can't film.

---

## 0. Brand spec (applies to every spot)

- **Palette:** midnight workshop `#0b0c10` ground · molten brass gold `#e7c255` (accent, end-plates) ·
  warm ivory `#f3ead6` text · emerald `#4bbf8a` (consumer/TN accent) · clay `#d9694a` (the "fear" beat only).
- **Type:** display serif **Fraunces** (headlines/end-cards) · **Archivo** (body/UI text) · **Anton** (bold
  uppercase meme/overlay text). Match the logo direction: premium, high-contrast, gold-forward.
- **Logo / sign-off:** the 🐜 ant mark + "AssistAnt" (SaaS) or "TN Appliance Exchange" (consumer). Gold on
  dark. Always spell out "TN Appliance Exchange LLC" once per spot (brand-voice rule).
- **Aspect ratios:** shoot/generate **9:16** master (Reels/TikTok/Shorts/Stories) → crop **1:1** (feed) and
  **16:9** (YouTube pre-roll). Keep all text inside the center-safe 1:1 area.
- **On-screen text:** big, high-contrast, captioned every line (Submagic "Hormozi 2" for the fast social
  cuts; clean lower-thirds for the cinematic Founder Film). Assume sound-off viewing — the story must read
  with captions alone.
- **Music:** licensed only (Epidemic/Artlist). Tension→release arc. Consumer = warm/hopeful; SaaS = confident/
  driving. Never library-cheesy; match the Vibe.co polish.
- **Voiceover:** ElevenLabs once `ELEVENLABS_API_KEY` is vaulted (connector `_lib/elevenlabs.js` is built).
  A grounded, plain-spoken male read (owner voice), not an announcer. `stability 0.5, similarity 0.75`.
- **CTA / landing (locked):** SaaS spots → `tnapplianceexchange.net/guide` (cold) or `/ant` (tour).
  Consumer spots → `tnapplianceexchange.net/always-open` or `tnapplianceexchange.net`.
- **Every claim is true:** $99/mo flat · every tech included · 24/7 AI answering that books/parts/routes ·
  built by a real shop · 4 honest options · same-day Middle TN + $50 nationwide video diagnostic. Do not
  invent stats or testimonials.

---

## 1. "The Boulders" — SaaS · 6-sec video version (static is designed in the artifact)

**Beat:** buried under subscriptions → freed by one flat tool. **Land:** /guide. **Beats:** HighLevel.

| t | Shot | On-screen text | VO |
|---|---|---|---|
| 0.0–2.5s | Weary tradesman crouched, crushed under huge stacked stone slabs labeled HOUSECALL PRO / JOBBER / WORKIZ / PODIUM, dim stormy workshop | "Too many tools. Too many subscriptions." | "Five tools. Five bills. All crushing you." |
| 2.5–4.0s | The boulders lift off him; he stands, exhales | "One system." | "One system does all of it." |
| 4.0–6.0s | He holds one phone glowing gold; gold end-plate slides in: **AssistAnt · $99 flat · every tech included** | "$99 flat. Built by a real shop." | "Ninety-nine flat. Built by a shop that got tired of paying for five." |

**Gen prompt (shot 1):** `Cinematic, moody, photoreal. A weary appliance-repair technician in navy work
clothes crouched on the floor of a dim workshop, crushed under enormous stacked grey stone slabs, each slab
carved with a software name. Volumetric dust, single cold overhead light, shallow depth of field, 9:16.`
**Gen prompt (shot 2–3):** `Same technician stands tall as the stone slabs lift away and dissolve; warm gold
rim light replaces the cold light; he holds a single glowing phone; hopeful, cinematic, 9:16.`
**Assembly:** end-plate is a Fraunces/Anton title card on `#0b0c10` with the gold "$99 flat" plate + 🐜 logo.

---

## 2. "They Take a Message. We Book the Job." — SaaS · 15-sec · beats FixCall

**Beat:** missed calls → competitor wins → we answer AND finish the job. **Land:** /guide.

**Script (VO + on-screen):**
- **0–3s** — *Shot:* stressed appliance tech in his van, hand on his head, phone buzzing. *Text (Anton,
  clay):* "COMPETITORS ARE BOOKING THE JOBS YOU MISS." *VO:* "Every call you miss is a job someone else just booked."
- **3–6s** — *Shot:* a voicemail icon, then a rival's van pulling into the driveway you wanted. *Text:*
  "Voicemail doesn't book jobs." *VO:* "An AI that just takes a message? That's still a missed job."
- **6–11s** — *Shot:* phone answering itself → a calendar filling → a part being ordered → a tech's route
  drawing on a map (quick UI-motion cuts of the AssistAnt board). *Text:* "AssistAnt answers 24/7 — and
  books it · parts it · routes it." *VO:* "AssistAnt answers, books the appointment, orders the part, and
  routes your tech. The whole job — not a voicemail."
- **11–15s** — *Shot:* the same tech now relaxed, phone down. Gold end-plate. *Text:* "Never miss a call.
  Never miss a JOB. · $99 flat · tnapplianceexchange.net/guide." *VO:* "Ninety-nine flat. Built by a real
  shop. Get the free playbook."

**Gen prompts:** `[3s] Photoreal stressed male appliance technician sitting in a service van, hand on
forehead, phone glowing on the dash, city street through the windshield, moody, 9:16.` · `[6s] the same tech
relaxed and confident, phone face-down on the couch beside him, warm evening light, 9:16.` · The board/UI
beats = screen-record the real AssistAnt board (office-board / dispatch / the map) — real product, not AI.
**Fast-static version** (for immediate Meta run): the two-panel meme is already designed in the artifact —
export it and run it while the video renders.

---

## 3. "Built by a Shop Owner" — SaaS · 45–60s cinematic · THE anchor film

**This is the one you send creators, warranty companies, and trade media.** Best version = **you on camera +
real shop B-roll**, cut with ElevenLabs VO on the lines you don't say to camera, graded to a film look. Full
AI-render fallback prompts included per scene.

**Two cuts:** a 60s hero (below) and a 30s pull (scenes 1 → 3 → 5 → 6).

**Full script:**
- **Scene 1 (0–8s) — the bad morning.** *Shot:* 6am, dark van, phone lighting up with missed calls he'll
  never call back. *VO:* "I own an appliance repair shop. And for years, this was every morning — calls I
  couldn't catch, jobs I lost before coffee." *Text:* none (let it breathe).
- **Scene 2 (8–18s) — the chaos.** *Shot:* office desk, five browser tabs, sticky notes, a whiteboard
  schedule that won't hold, the phone ringing while he's on another line. *VO:* "Five different tools. None
  of them talked to each other. I was paying a fortune to stay behind."
- **Scene 3 (18–28s) — the turn.** *Shot:* close on his face, quiet. *VO / to camera:* "So I stopped waiting
  for a software company to fix it — and I built it myself." *Text (Fraunces):* "So I built it."
- **Scene 4 (28–42s) — the system alive.** *Shot:* the AssistAnt board coming to life — a call answering
  itself, an appointment booking, a part ordering, a route drawing, a customer getting a text. *VO:*
  "AssistAnt answers every call, day or night. Books the job. Orders the part. Routes my techs. Texts my
  customers. One system. One flat price — every tech included."
- **Scene 5 (42–52s) — the proof.** *Shot:* him back in the field, calm, working a real repair; crew moving.
  *VO:* "Now other shops run their whole business on it too. Because it wasn't built in a boardroom. It was
  built in a van."
- **Scene 6 (52–60s) — sign-off.** *Shot:* him to camera. *VO / to camera:* "I'm not a software company. I'm
  a shop owner who got tired of losing. AssistAnt." *Text:* 🐜 AssistAnt · $99/mo flat · built by a real shop
  · tnapplianceexchange.net/ant.

**AI-render fallback gen prompts** (if not filming): S1 `photoreal, 6am, interior of a service van, driver's
phone screen full of missed-call notifications, blue pre-dawn light, cinematic, 9:16`; S2 `a small appliance-
repair office at night, one man overwhelmed at a desk covered in sticky notes with five glowing monitors,
cluttered, cinematic`; S4 = **real product screen-recording** (do not AI this — authenticity + accuracy);
S3/S5/S6 `a genuine, weathered 40s tradesman-owner, navy work shirt, warm workshop light, looking to camera,
documentary film look`. **Strongly prefer real footage of Teddy for S3/S5/S6** — the film's power is that
it's true.

---

## 4. "Broken at 2am? We Answer." — Consumer/TN · 30s cinematic

**Beat:** dead appliance at 2am, everyone else = voicemail, we pick up. **Land:** /always-open.

**Script:**
- **0–7s** — *Shot:* 2am kitchen, only the light from an open, dead refrigerator; a worried homeowner in a
  robe, food warming on the shelves. *Text:* "2:14 AM. Your fridge just died." *VO:* "It never breaks at a
  convenient time."
- **7–15s** — *Shot:* she dials — phone screen shows three shops → "Voicemail." "Voicemail." "Leave a
  message." *Text:* "Everyone else? Closed." *VO:* "And when it does, everyone else sends you to voicemail."
- **15–24s** — *Shot:* she calls TN → the call connects, a warm real answer; her shoulders drop; a
  confirmation text lands. *Text:* "TN Appliance answers. Any hour." *VO:* "We answer. A real, honest
  answer — and we get you on the schedule before you go back to bed."
- **24–30s** — *Shot:* morning, a TN tech at the door, smiling; emerald/gold end-plate. *Text:* "Broken at
  2am? We answer. · Same-day Middle TN · tnapplianceexchange.net." *VO:* "Broken at 2am? We answer."

**Gen prompts:** `[0s] photoreal, 2am home kitchen lit only by an open refrigerator, spoiled/warming food,
a worried woman in a robe, moody, cinematic, 9:16` · `[15s] warm relief on her face as she holds the phone
to her ear, kitchen, soft hopeful light` · `[24s] a friendly uniformed appliance technician at a sunny front
door with a toolbag, welcoming, morning light`. Phone-screen "voicemail" inserts = simple motion graphics.

---

## 5. "The Honest 4 Options" — Consumer/TN · 15-sec (static designed in the artifact)

**Beat:** other shops dictate the price; we show 4 honest options. **Land:** tnapplianceexchange.net.

**Script:**
- **0–4s** — *Shot:* a customer's skeptical face; a generic "shop" hands over one inflated invoice. *Text:*
  "Most shops give you one price." *VO:* "Most shops hand you one price and hope you don't ask."
- **4–11s** — *Shot:* a TN tech turns his phone to the customer; four option cards slide up (OEM/you-install,
  OEM/we-install, value/you-install, value/we-install) with real prices. *Text:* "We give you four." *VO:*
  "We diagnose it, then show you four honest options — genuine or value part, we install it or ship it to
  your door — and you pick."
- **11–15s** — *Shot:* the customer taps one; relief; emerald/gold end-plate. *Text:* "Your repair. Your
  call. · tnapplianceexchange.net." *VO:* "No pressure. No hidden markup. Your repair, your call."

**Production:** mostly **real footage** (a hand turning a phone) + the real app's 4-option screen (swap the
artifact mockup for an actual screenshot). No AI render needed. Captions on every line.

---

## 6. Voiceover (ElevenLabs) — once the key is vaulted

1. Teddy vaults `ELEVENLABS_API_KEY` (admin-secrets.html). The connector `_lib/elevenlabs.js` (`tts()`)
   activates immediately; `_lib/elevenlabs-dub.js` + `video-dub-submit/-poll` also enable **Spanish dubs** of
   any finished spot (big for the TN market).
2. Pick/clone a grounded owner voice (or use Teddy's real read for the Founder Film and reserve TTS for the
   fast social cuts). Settings: `stability 0.5, similarity_boost 0.75, style 0.3`.
3. Feed each spot's VO lines above → mp3 per line → drop under the picture in the edit.

## 7. Assemble + distribute (already live — don't rebuild)

1. Render shots (AI tool or camera) → assemble + caption in CapCut/Submagic → export 9:16 master + 1:1 + 16:9.
2. Upload the finished clip in `video-studio.html` (Cloudflare Stream) → **`post-everywhere`** fans it to
   FB (native) / IG (Reel) / TikTok (draft) / YouTube in one tap, with per-platform copy from
   `_lib/social-variants.js`. `youtube-seo` writes the title/description.
3. For paid: the finished spot becomes the creative in the Meta / Google / ChatGPT ad kits (see
   `docs/referral-ad-copy.md`). Nothing spends until Teddy flips a campaign ACTIVE.

## 8. Honest limits / notes
- No in-repo AI video/image generator — the render step is external (AI tool or editor). Everything up to and
  after that (script, prompts, VO, captioning, clipping, distribution) is ours.
- Prefer real footage of Teddy for the Founder Film and any "owner to camera" beat — authenticity is the edge
  no competitor can render.
- Screen-record the **real** AssistAnt board for any product beat (accuracy + it looks great) — never AI-fake
  the UI.
- Keep every claim true (Section 0). No fake reviews, no invented numbers.

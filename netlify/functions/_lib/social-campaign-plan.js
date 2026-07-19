// The launch sequence — the ordered posts for the aggressive-free reintroduction,
// built from the REAL page archive + the family story. Draft-first: each item
// becomes a draft Teddy approves before it ever posts. kind: 'text' (message only)
// or 'video' (message + a link to the existing archive video).
'use strict';
const P = 'https://www.facebook.com';

const PLAN = [
  { key: 'anchor', kind: 'text', title: 'The reintroduction — PIN this post',
    note: '⚠️ Confirm Dawn is comfortable with how she is mentioned before posting (dignified version — no medical detail).',
    message: `Some of you have known us for over a decade. Here's what's been happening.

For years, our phones were in the hands of Dawn — our expert, the voice so many of you knew and trusted. After many years, Dawn let us know she was ready to retire. She gave us the gift of a heads-up — so we spent the last 8 months, day and night, building the next stage to honor everything she gave us.

I named it after my son. Ant. 🐜

Ant is our new system. And Ant's assistant, Ann, answers our phones now — 24 hours a day, 7 days a week. She was ready the moment we needed her. Broken appliance at 2 in the morning? Send us a video and get a real answer. Text us anytime. We will never miss you again.

Same family. Same honesty. Same crew that's served Middle Tennessee since 2012. We just gave it superpowers.

We're not going anywhere. If anything — we're just getting started. 👑

Family-owned since 2012 · Licensed & insured · Google Guaranteed · 1,000+ five-star reviews. — Teddy` },

  { key: 'robots', kind: 'video', title: '"I can\'t stand these robots" (9,275 views) → the AI bridge',
    link: `${P}/1903450077306229/videos/2048765795638367`,
    message: `Real talk: this is our most-watched video ever — me, saying I can't stand robots. 🤖

So nobody's more surprised than me at what we built. Our AI, Ann, answers the phone 24/7 now — and she's good. Send her a video of your broken appliance at 2am and get a real answer.

Turns out the trick isn't replacing the humans. It's the same honest family crew — just never missing you again. Watch the video and tell me I'm wrong. 😂` },

  { key: 'ai_demo', kind: 'text', title: 'AI demo hook — "comment DRYER"',
    message: `Want to see something? 👀

Comment "DRYER" below (or text us at 615-280-2949) and watch our AI, Ann, answer you in about 10 seconds — any time, day or night.

No call center. No hold music. No runaround. Just a real, fast answer from the honest appliance folks who've been here since 2012. Try it. 🐜` },

  { key: 'story', kind: 'video', title: 'My business story (2016) — the origin',
    link: `${P}/1903450077306229/videos/1033472800063720`,
    message: `A little throwback to where this all started. 🎬

Same family. Same mission. A whole lot of appliances later — and we're just getting warmed up. Thank you to everyone who's trusted us over the years. ❤️` },

  { key: 'teddy_dryer', kind: 'video', title: 'Teddy & the dryer (2014, 978 views)',
    link: `${P}/1903450077306229/videos/755199354557734`,
    message: `Blast from the past — "Teddy, whatcha doing with that dryer?" 😄

Ten-plus years later, still fixing dryers, still telling you the truth about whether it's worth it. Some things don't change. 🐜` },

  { key: 'hillbilly', kind: 'video', title: 'Hillbilly Generator (2013 OG shop clip)',
    link: `${P}/1903450077306229/videos/453160041428335`,
    message: `Found this gem from all the way back in 2013 — live from the shop. 😂

We've been having fun and fixing appliances for a long, long time. Watch till the end. #goodoledays` },

  { key: 'video_call', kind: 'video', title: 'Video-call diagnosis (1,073 views)',
    link: `${P}/reel/1810197649695748/`,
    message: `Not sure if it's worth fixing? Don't guess — and don't let anyone upsell you.

We'll hop on a quick video call, take a look, and tell you straight: fix it or replace it. Honest answers, no pressure. That's the whole point. 🐜` },

  { key: 'gas_dryer', kind: 'video', title: 'Proven format — the "don\'t miss out" clip (6,749 views)',
    link: `${P}/1903450077306229/videos/1146110088799990`,
    message: `Throwback to one of our most-watched clips. 🔧

Dryer, fridge, washer, oven — we've been the honest fix for Middle Tennessee families since 2012. Something acting up? You know who to call.` },

  { key: 'dryer_safety', kind: 'video', title: 'Dryer safety (2016)',
    link: `${P}/1903450077306229/videos/1091846337559699`,
    message: `Everybody talks about preventing forest fires — but nobody warns you about your DRYER. 🔥

Lint buildup causes thousands of house fires a year. We're CSIA-certified for dryer-vent cleaning — we open the dryer AND clean the vent, the part most folks (and most companies) skip. Watch this, then go check yours.` },

  { key: 'reviews', kind: 'text', title: 'Reviews / social proof',
    message: `1,000+ reviews and a 4.5-star average. 🌟

That's not just a number to us — it's a thousand neighbors who let us into their homes and trusted us to be honest. Thank you. If we've ever fixed something for you, we'd love it if you shared this post. 🐜

Google Guaranteed · Licensed & insured · Background-checked techs · Family-owned since 2012.` },

  { key: 'big_helper', kind: 'video', title: 'Family throwback — "Big helper for the day" (2014)',
    link: `${P}/1903450077306229/videos/684960988248238`,
    message: `Throwback: the next generation of helpers. 🐜❤️

This has always been a family thing. It still is. #goodoledays` },

  { key: 'movement', kind: 'text', title: 'The share-ask / the movement',
    message: `A small ask. 🙏

I'm making a real run at putting a family shop back on the map — the honest way, with real techs and a little help from Ann, our 24/7 AI. If you've ever trusted us, or you just believe in rooting for the folks who do it right... share this.

Help us reach the people in Middle Tennessee and South Louisiana who need an honest appliance fix. Far and wide. 👑🐜 — Teddy` },
];

module.exports = { PLAN };

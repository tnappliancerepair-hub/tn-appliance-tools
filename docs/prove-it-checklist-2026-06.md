# 🧪 PROVE-IT CHECKLIST — run before scaling ad spend (2026-06-26)

Goal: personally watch every piece of the funnel fire end-to-end BEFORE putting
real money behind ads. **Test 1 (payment) is the hard gate for cash ads.**
Green on Tests 1–5 = core funnel works → start small ($40/day), scale winners.

> Heads-up: these tests create REAL jobs + send REAL texts to Teddy (615-485-5795)
> + Danielle. The $1 cash test really charges $1. Clean up the test jobs after.
> Use a phone/number NOT in the system (wife/friend/Google Voice) where it says "fresh number."

---

## 🥇 TEST 1 — CASH PAYMENT (the money step — MOST CRITICAL)
Open on your phone: **`https://tnapplianceexchange.net/?qc=tn-qc-test-2026`** (the `?qc=` makes it **$1**, not $50)
Run: pick **Dryer → a problem → "I'm paying myself" → "Quick Check by phone" →** record a short video → snap any model-sticker photo → fill name/phone/email/address/zip → availability → **Pay $1**.

- [ ] Stripe charges **$1** and completes (lands on a thank-you page)
- [ ] You get the **💵 text on your cell** with a `teddy-tdr-tool.html?job_id=` link
- [ ] Tap it → job opens in **Teddy Tool**, the **video plays**, the photo shows
- [ ] The **model # was auto-read** onto the job (OCR)

**If payment fails → STOP. That's the #1 blocker** — the cash Stripe XS endpoints
(`qc_create_checkout_session` / `stripe_checkout_session_completed`) deploy from the
Mac and may not be live. Fix = `xano workspace push` those + retest before any cash ads.

## 🥈 TEST 2 — WARRANTY INTAKE (the rebuild)
Open **`https://tnapplianceexchange.net`** → **Dryer → problem → "I have a warranty" →** video → model photo → **phone** → Get me scheduled.

- [ ] You **+ Danielle** get the **🛡️ WARRANTY text** with a Teddy Tool link
- [ ] Job is labeled **WARRANTY** (not self_pay) in Teddy Tool
- [ ] Video + model photo on the job, **model # auto-read**
- [ ] **No $50 charge** anywhere

## 🥉 TEST 3 — INBOUND TEXT → ANT (fresh number)
From a **fresh number**, text **615-588-9500**: *"I've got a broken dryer."*

- [ ] You get an **Ant reply** (ideally within seconds) that engages
- [ ] Reply again → **Ant keeps the conversation going**

## TEST 4 — HANG-UP TEXT
From a **fresh number**, call **615-280-2949**, let Ant answer, then go **silent / hang up**.

- [ ] That number gets a **text with the intake link**
- [ ] Reply to it → **Ant responds** in the thread

## TEST 5 — PHONE (Ant answers + takes info)
From a **fresh number**, call **615-280-2949**, talk to Ant about a broken dryer.

- [ ] Ant answers live, **takes the info**, offers next steps / a callback

---

## TEST 6 — GOOGLE BUSINESS CHAT → intake
Send a message via your **Google Business Profile chat**.
- [ ] You get a reply that includes the **intake link**

## TEST 7 — THE PAGE (languages + mobile)
- [ ] `tnapplianceexchange.net` loads **clean + fast** on your phone
- [ ] `tnapplianceexchange.net/es/` loads **in Spanish**; run a few steps

## TEST 8 — THE ENGINE IS ALIVE
- [ ] Confirm the **Mac Mini loop is green** before launch (ask Ant to check `get_loop_health`)

## TEST 9 — WEAK-SIGNAL MEDIA (the real-world killer)
Throttle your phone to slow/3G (or a weak spot) → upload a video in the cash/warranty flow.
- [ ] It **uploads** OR shows "saved, we'll grab it" **+ you get a finish-upload text** (media never lost)

---

## ✅ BEFORE YOU SCALE — ad setup
- [ ] Every ad's **Final URL = `tnapplianceexchange.net`** (language ads → `/es/`, `/vi/`, `/ar/`, `/hi/`, `/fr/`)
- [ ] **Start at $40/day**, watch daily, **scale the winners** (your locked plan)
- [ ] (LSA, if flipping on) hours → **24/7**, set a **manual bid cap**

## GO / NO-GO
- **Tests 1–5 all green** → core funnel proven → start small, then scale.
- **Test 1 (payment) is the hard gate** for cash ads — do not run cash ads until it passes.
- Warranty ads/texts only need Tests 2–5 green (no payment involved).

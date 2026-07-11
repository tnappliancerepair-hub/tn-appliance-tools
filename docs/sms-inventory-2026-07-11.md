# 📱 SMS Inventory + Timing Audit — 2026-07-11

_Every text the system can send, why it fires, how often, and a keep/kill/fix call
for each. Built from a full code sweep (Netlify + colony-loop) plus 7 days of live
`event_log` send data. Requested by Teddy: "run an inventory of all the texts…and
audit the TIMING/spacing between them."_

---

## 🎯 TL;DR — what the audit actually found

**The "3 arrival times" complaint was NOT arrival-time texts.** No live text auto-sends
a clock arrival time — a `scrubTimes()` stripper at both send chokepoints removes any
"3:00 PM" before it can go out, and the only clock-time template in the whole codebase
is a *draft* the office has to hand-send. The bunching customers felt was **two
duplicate-send bugs** firing the *same* text several times:

| Bug | What happened | Share of customer texts (7d) |
|---|---|---|
| **`callback_ack`** | The "thanks for calling, we've got your message" text re-fired **up to 7× in 56 min** — the AI phone assistant re-invoked the `capture_callback` tool multiple times in one call, and each invoke re-texted the customer. Tight pairs 0.1 min apart. | ~119 texts |
| **`translated_reply`** | The office's translated reply double-sent **0.0 min apart** (same second) on a Netlify function retry. | ~98 texts |

Together = **~84% of all customer texts in the window**, and both were literal duplicates.

**✅ FIXED + DEPLOYED (2026-07-11).** Added one idempotency check at the shared customer
chokepoint (`_lib/sms-guard.js → guardedSend`): if the *exact* same text already went to
that phone within 30 min (`SMS_DEDUP_WINDOW_MIN`, tunable), it's suppressed and logged as
`sms_dup_suppressed`. Exact phone+body match, so a genuinely different message is never
blocked. Both bugs route through this chokepoint, so one fix kills both. Live on Netlify.

**Burst stats (7 days, before the fix):** 258 customer sends; 58 tight pairs <15 min apart;
18 customers got 3+ texts in a single hour — almost all traceable to the two bugs above.

---

## 🧱 The two things that govern EVERY text (context first)

1. **INTAKE-ONLY PAUSE is ON** (Teddy 2026-07-10). Both chokepoints drop every *proactive*
   customer text except **intake / availability / resume / reactive replies**, unless
   `CUSTOMER_TEXTS_ALL=1`. ~30 of ~50 customer templates are written-but-silent right now.
2. **Owner + tech texts are heavily muted at the source.** `toOwner()` is CANCELED (portal +
   web-push only unless `force_send`), and a 2026-07-07 "internal SMS cutoff" drops internal
   sends unless `force_send` / a `teddy-tdr-tool` link / `INTERNAL_SMS_ENABLED=true`. So the
   ~50-agent colony digest swarm does **not** text today. Flipping `INTERNAL_SMS_ENABLED`
   would un-mute all of it at once — that was the original 1,421-texts-in-a-day storm. **Leave off.**

Standing safety rails already in place: **STOP/opt-out is absolute + permanent**; **quiet
hours 8am–9pm CT hard-block** (except same-day en-route the customer expects); a **2-text/job
intake cap**; a **50-per-10-min circuit breaker**; and now **exact-duplicate suppression**.

---

## 👤 Texts to CUSTOMERS (~50 templates)

### KEEP — the intake/availability core (the ones Teddy wants)
- **New-job greeting** (video + model photo + "what days work") — 1/job, forward-only, 2/job cap.
- **Intake-collector sweep** — 4-touch escalating ask for media + availability; hard-capped at 4 lifetime, ~20h apart. Highest-volume proactive surface; still the one to watch.
- **Office intake link / $50 Quick Check link / web speed-to-lead / intake ack / finish-upload recovery** — all intake-shaped, capped, gated.
- **Warranty resume nudge**, **"morning or afternoon?"**, **availability ack** — availability collection.
- **All reactive replies** (`sms_response_*` family, ~40 agents; instant status answer; opt-out confirm) — never go silent on a customer who texts in. Day-only status, no clock time.

### FIXED (this session)
- **`callback_ack`** (Vapi "thanks for calling") — was bursting; now dedup-suppressed. ✅
- **`translated_reply`** (office Messages reply) — was double-sending; now dedup-suppressed. ✅

### WATCH / CONFIRM
- **`_lib/part-notify.js` — part-ordered ETA text is LIVE BY DEFAULT** and sends an ETA *date*
  ("Monday, Jul 14") to **cash + warranty** customers. Its own top comment still says "shadow
  until true" — **stale/contradictory.** This is the most likely source of any lingering "why
  are we texting dates" feeling. **→ Decision needed: keep, or set `PART_ORDERED_NOTIFY_LIVE=false`.**
- **`cash-paid-cover.js`** — cash customers get "part ~2-3 days + sign waiver + availability" on payment. Cash-only, 1/job.
- **`cash-pay-nudge.js`** — the only *recurring dunning* text (re-nudges an unpaid cash lead every 4 days). Kill switch: `CASH_PAY_NUDGE_ENABLED=off`.

### CURRENTLY PAUSED (written, silent under intake-only mode — no action needed unless re-enabling)
Appointment confirm/reminder, waiver-due, upsell, reviews ("how'd we do", Google review), first-job
welcome, maintenance reminder, proactive-failure, reactivation, service-agreement, self-warranty,
parts-arrival, balance-due/invoice/diagnostic-prepay. All behind `CUSTOMER_TEXTS_ALL=1`.

### ⚠️ Back-door note
A handful of files **POST directly to Xano `/send_sms`**, skipping the Netlify pause + the
time-scrubber (they rely only on the server-side gate): `intake-collector`, `book-media-chase`,
`callback-intake`, `book-repair`, `ghost-confirm-slot`, `confirm-today-and-relay`,
`customer-sms-inbound`, `_lib/satisfaction`, `vapi-webhook`. These are the only paths that could
ever let a stray clock-time slip out. **→ If we want the pause + scrubber to be truly universal,
route these through `sendSms`/`guardedSend` too** (a follow-up, not urgent).

---

## 🏢 Texts to DANIELLE (~30 templates)

**No quiet-hours/denylist gating on her path** — she's an internal role, so only the 50/10-min
breaker (and now dup-suppression on any customer-shaped send) applies. Noisiest:

- **KILL/FIX — Quick-Check sirens (B1):** she's CC'd on *every* intake siren Teddy gets, un-deduped,
  across 3 funnels (warranty/paid/free). **→ Make Teddy-only or dashboard-only.**
- **FIX — call double-text:** `inbound_call_alert` **and** `vapi_call_alert_danielle` can both fire
  for the *same* call. **→ Consolidate to one.**
- **FIX — duplicate mornings:** a Netlify morning briefing **and** a colony morning briefing can both
  text her ~7:30am. **→ Pick one.**
- **KILL candidates:** EOD summary + the colony morning briefing (low-value digests).
- **KEEP (low-volume, directly actionable):** warranty-submission ready/blocked, warranty claim
  action/denial, customer-media-ready, urgent-callback (already urgency-gated), reschedule request,
  low-rating alert, tech-suspended, out-of-area, parts-ready-to-order.

---

## 🔧 Texts to TECHS (~34 templates)

Two send paths with **very different gating.** The colony path is heavily muted (hard weekend mute,
a 4-type allow-list, off-roster filter, breaker). **The Netlify path bypasses all of that** — that's
where the weekend-pestering came from. Noisiest:

- **KILL/FIX — `boss-trash-talk`:** random taunts multiple times/day, ~55% fire chance per run,
  and its send path doesn't re-check the weekend. Highest-frequency tech text. **→ Cap harder / weekend-gate.**
- **FIX — duplicate morning briefings:** colony `daily_tech_briefing` **and** Netlify
  `tech-morning-mirror-and-encourage` both fire ~7am — and the Netlify one **still texts Billy #5
  (departed)** and Andre's stale 615 number. **→ Kill one; fix roster.**
- **FIX — redundant TDR-nudge cluster:** `tdr-chase`, `tdr-gap-watch`, `tech-missed-stop-check`,
  `request-tech-report` all chase the same "finish your report" outcome and all bypass the weekend mute. **→ Consolidate.**
- **⚠️ LIKELY-DEAD (verify):** 4 scheduler check-in agents + `parts_arrived_quick_schedule` call
  `toTech({object})` against a `toTech(phone, body, ctx)` signature → resolve to `invalid_phone`
  and never send. **→ Either fix the signature (then they become frequent check-in spam — gate them)
  or delete them.**
- **KEEP:** morning briefing (one of them), new-job pre-diag, EOD report, job-assigned, parts-link on-demand.

---

## 👑 Texts to TEDDY / OWNER (~90 messages, but most are portal-only)

**Almost the entire colony swarm (~50 msgs: daily/weekly digests, watchdogs, per-job alerts) is
PORTAL + web-push only today — it does NOT text.** The live phone surface is the **Netlify layer**:

- **Watch (spammy risk):** the API-approval watcher swarm (`amazon-`, `google-`, `vendor-`,
  `frontdoor-auth-`, `gmail-token-`, `cybertruck-watch`), the health/safety watchdogs
  (`site-health-sweep`, `job-safety-watch`, `colony-watchdog`), and per-call/per-lead alerts
  (`vapi-tool`, `capture-callback`, quick-check + ad-lead sirens).
- **KEEP:** "customer replied to you" forward (explicitly wanted), payout-ready, new-job-from-call.
- **🐞 Two bugs to fix:**
  1. **SMS circuit-breaker alert lacks `force_send`** → the 2026-07-07 internal cutoff would
     **suppress the very "you're being spammed" safety text.** It can't warn you when it matters most.
  2. `vapi-webhook.js:581` uses `to_number` instead of `to` (transfer-dropped alert key), and
     `create-warranty-job-proxy.js:52` calls `send-teddy-sms` with a relative URL (likely broken).
- **"Fix" candidate:** the new-job **pre-diagnosis Teddy-Tool link** (`job_created.js`) — a text you
  *want* — currently lands in the portal, not your phone.

---

## ✅ What was done this session
- **Killed both customer-text duplication bugs** (`callback_ack` + `translated_reply`) with a single
  exact-duplicate suppressor at the customer chokepoint. Committed + deployed to Netlify.

## 📋 Recommended next moves (for Teddy to greenlight — none done yet)
1. **Confirm `_lib/part-notify.js` intent** — keep the ETA-date text live, or flip `PART_ORDERED_NOTIFY_LIVE=false`.
2. **Danielle:** stop CC'ing her on the Quick-Check sirens; consolidate the two morning briefings + the call double-text.
3. **Techs:** cap/weekend-gate `boss-trash-talk`; kill one of the duplicate morning briefings + fix the roster (Billy/Andre); decide fix-or-delete on the dead scheduler check-in agents.
4. **Owner:** add `force_send` to the circuit-breaker alert; fix the `to_number` + relative-URL bugs; optionally promote the new-job pre-diag link back to a text.
5. **(Optional, hardening)** route the direct-Xano back-door senders through `guardedSend` so the pause + time-scrubber + new dedup are truly universal.

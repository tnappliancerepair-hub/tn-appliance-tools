# Self-serve AI phone — "Get my Ant AI answering calls now" (the plan)

The onboarding wizard (`platform/onboard.html`) ends with one button: **🎙️ Turn on my AI
receptionist.** A shop taps it and, with zero human on our side, gets a phone line with Ann
answering 24/7. This is the flagship of "make it all self-serve." Here's how it works and how
it makes money.

## The model (how HCP/Jobber do built-in texting — we do the same)

We are the **ISV / reseller.** Numbers are bought on **our** Telnyx account, 10DLC compliance
is registered **once at our platform level**, and each shop rides underneath as a sub-use. The
shop **never sees Telnyx** — matches "keep the provider a black box" (Teddy's short-term moat).
Self-serve ≠ handing them a carrier account; it means *we* provision on their click.

## The flow (server-side, on the button tap)

1. **Gate:** only for a shop with an **active subscription** (a number costs money — never buy
   one for an unpaid trial that ghosts). `company.status in (trial-with-card, active)`.
2. **Buy a number** on our Telnyx account near the shop's area code (Telnyx number-search →
   order API). Store it on the company (`settings.phone.number`, `settings.phone.telnyx_id`).
3. **Create the AI assistant** from the shop's **trade persona** (the `trade_profile` vocab)
   seeded with what the wizard collected — `settings.ai.about`, hours, what callers can do.
   This reuses the existing `trial-ann-admin` create/bind plumbing, made tenant-triggered.
4. **Bind** the number → the assistant. **Voice is live immediately** (Ann answers calls).
5. **Tell the owner** — email/SMS "your AI line (615-…) is answering now."
6. **Meter from minute one** (`usage-meter` already tracks minutes/texts per company).

Alternative path (offer both): **forward their existing business line** to the Ant number
instead of buying new — for shops that want to keep their published number.

## Texting: instant voice, gated texting (the scam control)

Voice answering is low-abuse. **Outbound texting is the abuse vector**, so:
- **Business verification at signup = the scam filter.** Collect legal name / EIN / address
  (also required for 10DLC). A scammer won't hand over a real EIN *and* a working card. Card is
  already required (provision-on-payment).
- **Start on a shared, pre-registered messaging profile** so texting works day one, with a
  **low per-tenant daily cap** that rises as the shop builds a clean history. Our existing
  `sms-guard` already enforces opt-out (absolute), quiet hours, per-recipient frequency caps,
  and a global flood breaker — apply it per tenant.
- **Graduate** high-volume shops to their own 10DLC brand/campaign registration (cleaner
  deliverability) once they're established.
- **Kill switch** per tenant if abuse is detected (pause texting, keep voice).

## The economics — "charge more than used = win" (yes)

| Cost to us | **VERIFIED (Telnyx, 2026-08-28)** |
|---|---|
| A number | ~$1 / month |
| An SMS (segment) | **~$0.013 all-in** — rate $0.0085 + carrier fee $0.0045 (T-Mobile; others cheaper). Long texts = 2–3 segments. |
| Ann's voice minute | **$0.084 all-in** — orchestration $0.05 + telephony $0.004 + LLM ~$0.03 (est). TN: 55 calls/day, avg 1.76 min ⇒ **$8.10/day ≈ $243/mo**. |

**Verified by-number tracking:** every Telnyx message record carries `cli` (the shop's from-number)
+ `cost` + `carrier_fee`; every Ann call is an `/ai/conversations` row tagged with `assistant_id`.
Each tenant = one number + one assistant, so **weekly minutes/texts are metered exactly per shop**
(`usage-meter.weeklyTelnyx(number, assistant_id)`). Billing is by the *unit* (minutes/texts) —
counted precisely — so it's exact even though the internal LLM cost is an estimate.

**Margin at the verified rate ($0.084/min):** the bucket is **400 min** (chosen 2026-08-28 over
500 for a healthier full-usage margin). $50 for a full 400 min = ~$34 cost ⇒ **~$14/wk margin
(28%)** even maxed; most shops run well under 400 (so they're more profitable), and $0.40/min
overage is ~4.75× cost so heavy shops are the *most* profitable.

## THE OFFER (locked with Teddy, 2026-08-28) — best deal, structurally lossproof

The principle: **give away what's free to us (software), charge for what costs us (the phone),
metered above cost.** So it cannot lose money.

- 🆓 **Software is free** — board, portal, tech app, scheduling, pay, database. Marginal cost
  to us ≈ $0/tenant, so a free (or long-trial) offer stays safe even at hundreds of signups.
  *This is the hook: a shop gets their whole back office free.*
- 🎁 **First 50 Ann minutes free** — the test drive. Capped ≈ $3 of cost per account (not the
  unbounded free-trial risk); lets them feel it before the meter starts.
- 📞 **Ann = $50 / week includes 400 minutes** (locked 2026-08-28 — 400 keeps a healthy margin
  even at full usage), then **$0.40 / min overage** (+ ~500 texts included, metered after).
- 💳 **Card on file, charged only when Ann is working.** Number provisioned only on an active
  card/subscription; **released on cancel** (never pay $1/mo for a dead account's number).

**Why it can't lose money — the math (at the VERIFIED $0.084/min cost):**

| Scenario | Revenue | Cost | Margin |
|---|---|---|---|
| 400 min (full base, ~40 calls/day weekdays) | $50 | ~$34 + $0.25 num + $1.75 Stripe | **~$14/wk (28%)** |
| Small shop (~150 min) | $50 | ~$13 | **~$35/wk** |
| Heavy shop (875 min, TN-level) | $50 + 475×$0.40 = **$240** | ~$74 | **~$164/wk** |

400 min ÷ ~2 min/call = **200 calls/week ≈ 40 calls/day** covered by the base. Overage at $0.40
is **~4.75× our cost**, so heavy shops become the *most* profitable, not a risk — the
"monster-volume shop loses money" worry is erased by the overage rate. `usage-meter` + the daily
owner digest + the owner dashboard card all track weekly minutes/texts vs. the **400** allowance.

**Weekly-billing note:** charging weekly quadruples Stripe's fixed $0.30 fee (~$1.20/mo vs
$0.30). Minor; keep weekly for the low-commitment appeal, optionally offer a monthly equivalent
(~$180/mo / 2,000 min) that also saves the fee. **Still to set:** the included text allowance +
text overage rate.

## Build status

- [x] **`platform-phone.js` — BUILT (shadow).** `action=provision` gates on active subscription →
      searches + buys a Telnyx number near the shop's area code → attaches it to the SHARED 10DLC
      messaging profile (hybrid) → creates + binds Ann (trade persona from `company.settings.ai`,
      lead tool → `platform-lead`) → writes `company.settings.phone`. `status` + `release` too.
      Auth: the shop's Supabase session token (self-serve) OR admin secret. **SHADOW until
      `PLATFORM_PHONE_LIVE=true`** — returns the plan, spends nothing.
- [x] **Wizard wired** — `onboard.html`'s "Turn on my AI receptionist" calls `platform-phone`.
- [ ] **To go live:** set `TELNYX_SHARED_MESSAGING_PROFILE_ID` (create the shared 10DLC campaign
      first) + `PLATFORM_PHONE_LIVE=true`. Then the button buys a real number + turns Ann on.
- [ ] Release the number on subscription cancel (call `action=release` from the webhook).
- [x] **Weekly metering (Mon–Sun CT), by number** — `usage-meter.weeklyTelnyx()` reads texts
      (by `cli`) + minutes (by `assistant_id`) straight from Telnyx for the current week.
- [x] **Daily digest → weekly** — `platform-usage-digest` now emails each shop with a phone line
      their Ann usage **this week vs 400 min** (%, near-limit at 80%, over-limit note), so they
      always know where they stand and can pause before/after hitting 400.
- [x] **Pause / resume toggle** — `platform-phone` `action=pause`/`resume` unbinds/re-binds the
      number so the owner can stop Ann (e.g. at the 400). *(Surface a button in owner.html next.)*
- [ ] Stripe metered billing: report the weekly minutes/texts as usage records ($50/wk base +
      $0.40/min overage). Verified rates say **400-min bucket = ~$14/wk margin at full usage
      (chosen over 500 for margin).

## Original checklist (reference)

- [ ] `platform-phone.js` (server, service key): `action=provision` — gate on subscription →
      Telnyx number-search + order → create/bind AI assistant (trade persona + `settings.ai`) →
      write `settings.phone` → notify owner. `action=status`, `action=release` (on churn).
- [ ] Wire the wizard button (`onboard.html` `#getphone`) from record-intent → call
      `platform-phone?action=provision`. (Today it records `settings.ai.phone_requested`.)
- [ ] Platform 10DLC: register our brand + a shared campaign; put new tenants on it with caps.
- [ ] Collect EIN/legal-name/address at signup (10DLC + scam filter).
- [ ] Release the number + pause the assistant when a subscription cancels (webhook already
      strips features on churn — add number release there).
- [ ] Plan allowances + overage rates in `plans.js` (set from TN's real usage).

**Decisions to lock before building:** (1) buy-new vs. forward-existing vs. both;
(2) shared-registered-profile-first vs. per-tenant 10DLC; (3) the included allowances + overage
prices. The wizard already collects everything Ann needs — this is the fulfillment half.

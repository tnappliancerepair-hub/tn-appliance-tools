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

| Cost to us (Telnyx wholesale) | Rough |
|---|---|
| A number | ~$1 / month |
| An SMS | ~$0.004 each |
| Ann's voice-AI minutes | ~$0.05–0.10 / min (TN's Ann ≈ $7/day ≈ $210/mo at full shop volume) |

Plan structure: each tier **includes an allowance** (N minutes + M texts) priced so *typical*
usage costs us a fraction of the plan price; **overage metered** at a marked-up per-unit rate.
`usage-meter` + the daily owner usage digest already surface month-to-date vs. allowance. The
one margin risk is a monster-volume shop — metering + allowance caps + overage protect it. Set
allowances from real data (TN is the reference: ~50 calls/day ≈ $7/day voice).

## Build checklist (next)

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

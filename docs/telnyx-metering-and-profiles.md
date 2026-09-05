# Telnyx metering + messaging profiles — how per-tenant usage tracking works (and the profile strategy)

_Decision captured 2026-09-05 (Teddy). This is the reference for how the platform tracks each
tenant's phone minutes + texts, and how messaging profiles / 10DLC scale as we add phone shops._

## The core fact: usage is tracked per NUMBER, not per messaging profile
Every tenant that turns on Ann gets its **own dedicated Telnyx DID**. That number is the tracking key:

- `_lib/usage-meter.js` pulls Telnyx **Detail Records** filtered by the tenant's own number
  (`/detail_records?filter[record_type]=messaging&filter[direction]=outbound&filter[cli]=<number>` for
  texts; voice CDRs the same way), and `record(company_id, kind, qty, cost)` logs each unit against
  that `company_id` with **our** marginal cost (voice-min + SMS, verified vs real Telnyx records).
- `rollup(company, from, to)` + `ownerDigest(company)` roll it up **month-to-date vs the shop's plan
  allowance** (the owner sees usage-vs-allowance only — never our cost/margin/provider; that's the
  moat: we run the provider + keep per-unit cost ours).
- `guardrail()` caps per-tenant (sms/hr, sms/day, voice-min/day) in alert-only mode; fails OPEN so a
  meter hiccup never blocks legit work (the send paths' own guards are the backstop).

**Therefore: we do NOT need a separate messaging profile per tenant to track usage.** Tracking is a
per-number query. One shared profile meters every tenant perfectly.

## What a messaging profile actually controls (NOT measurement)
- **A2P 10DLC** brand + campaign registration — what carriers require to deliver business texts.
- **Throughput** limits.
- **Inbound webhook routing** + opt-out (STOP) handling.

So the profile decision is about **compliance + deliverability**, not billing measurement.

## The strategy: shared profile now → per-tenant 10DLC at scale
| | One shared profile (NOW) | Profile + 10DLC per tenant (SCALE) |
|---|---|---|
| Track minutes/texts | ✅ by number | ✅ by number |
| Setup | ✅ one-time, instant | ❌ per-shop brand+campaign (costs $, days to approve) |
| Compliance at scale | ⚠️ many businesses on one registration = "shared origination"/snowshoeing → carrier filtering risk | ✅ each business registered as itself |

### NOW (TN = customer #1, TK #2, first few friendly shops)
- Vault the **existing** profile's ID (the one carrying the approved 10DLC campaign that 588-9500 /
  857-8800 use) as **`TELNYX_SHARED_MESSAGING_PROFILE_ID`**. A blank new profile with no campaign
  will NOT deliver US texts (carriers drop unregistered long codes — documented footgun).
- **Deliverability caveat:** each *new* tenant number still needs to be on a 10DLC campaign to text
  reliably. Shared model = add the new number to the existing approved campaign (quick, manual).
- Flip `PLATFORM_PHONE_LIVE=true` when ready to let shops buy their own line (buys a ~$1/mo DID per
  shop, only when that shop clicks "turn on Ann" — never automatic).

### SCALE (onboarding phone shops as a product)
Make this a step in the paid "turn on Ann for this shop" onboarding (the shop pays for its line, so
the cost + approval belong here, not at free signup):
1. Create a per-tenant Telnyx **messaging profile**.
2. Register that shop's **10DLC brand + campaign** (its own business identity).
3. Provision the DID onto that profile/campaign.
4. Store the per-tenant profile id on the company (e.g. `settings.phone.messaging_profile_id`) so
   provisioning + metering use it; usage tracking is unchanged (still by number).

## Bottom line
- **Tracking every tenant's minutes + texts is already built** (per-number Detail Records → usage_event
  → rollup → owner digest). It just needs the shared profile vaulted + tenants running on their own
  numbers.
- Start shared; graduate to per-tenant profile + 10DLC as a paid onboarding step at scale.

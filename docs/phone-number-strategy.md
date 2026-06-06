# Phone Number Strategy — single source of truth

Last updated 2026-05-28. Owner: Teddy Pivacek.

## The Principles

**(1) Every number a customer or tech might see reaches the same intelligent Ant brain. No dead ends. Same engine, different opening line per number.**

The brain knows which number was dialed and adapts. One assistant config in Vapi, many numbers attached, distinct first messages and contexts per number. Cheap, maintainable, consistent customer experience.

**(2) Phone numbers are STRATEGIC INVENTORY, not just operational tools.**

Three reasons we keep more numbers than we need TODAY:

- **Carrier-approval insurance.** Twilio TCR / A2P 10DLC approval took almost a month while we were waiting. Telnyx came through, Twilio approved the next day. Holding pre-approved numbers on both carriers means if anything ever happens (account suspension, A2P re-review, ban) we are NOT waiting another month while texting — core to the business — is dead. Few dollars a month for that insurance is obvious.

- **SaaS multi-tenant future.** When Ant becomes a platform for other independent repair shops + warranty companies ([[saas_strategy]]), pre-acquired ANT vanity numbers (1-888-ANT-8998, 1-866-ANT-0111) become brandable assets we can lease to tenants. Vapi BYO numbers can spin up tenant-specific assistants without going through provisioning queues. We don't release these.

- **Advertising leverage.** Catchy click-to-call vanity numbers (ANT acronym) anchor SEO and ad campaigns at a much lower friction than a random 615 number.

Default decision when in doubt about releasing a number: **KEEP.** Re-acquiring approved numbers later costs more than holding them now.

## Full Inventory (12 numbers across 4 providers)

### Currently active + visible to customers

| # | Number | Provider | Today | Target |
|---|---|---|---|---|
| 1 | **+1 866-268-0111** | RingCentral ($300/mo) | Public website TN primary | Port → Vapi → Ant Inbound |
| 2 | **+1 504-355-9111** | Vapi BYO | LA market (already on Vapi, old assistant) | Repoint → Ant Inbound v2 (LA context) |
| 3 | **+1 615-588-9500** | Telnyx | Customer SMS outbound; calling it → dead air | Enable voice → Ant Inbound (callback context) |
| 4 | **+1 615-857-8800** | Telnyx | Tech SMS outbound; calling it → dead air | Enable voice → Ant Inbound (tech context) |
| 5 | **+1 629-284-0444** | Twilio | Business outbound SMS (legacy waiver/booking + Telnyx failover) | Enable voice → Ant Inbound (callback context) |
| 6 | **+1 727-350-8487** | Twilio | Tech inbound SMS + scheduler outbound | Enable voice → Ant Inbound (tech context) |

### Owned but unrouted (route now)

| # | Number | Provider | Today | Target |
|---|---|---|---|---|
| 7 | **+1 888-ANT-8998** (888-268-8998) | vanity provider | NEVER routed since acquisition | Port or forward → Ant Inbound v2 |
| 8 | **+1 866-ANT-0111** (866-268-0111) | vanity provider | NEVER routed | Port or forward → Ant Inbound v2 |

### Vapi BYO secondary TN (KEEP as SaaS inventory)

Per the Strategic Inventory principle — these were originally acquired for Vapi use and stay as platform inventory for the multi-tenant future. Few dollars a month, real strategic value at scale.

| # | Number | Provider | Today | Target |
|---|---|---|---|---|
| 9 | **+1 629-260-7111** | Vapi BYO | TN secondary, old assistant | Repoint → Ant Inbound v2 (warm tone); future-reserve for SaaS tenant |
| 10 | **+1 629-247-7111** | Vapi BYO | TN secondary, old assistant | Repoint → Ant Inbound v2 (warm tone); future-reserve for SaaS tenant |

### KILL LIST — delete in Twilio dashboard

| # | Number | Provider | Why kill |
|---|---|---|---|
| 11 | **+1 570-378-8177** | Twilio | Points at Twilio demo IVR. Brand-conflict landmine if anyone calls/texts. Created Jan 2026, no documented purpose. |
| 12 | **+1 234-219-3439** | Twilio | Same — Twilio demo IVR. KILL. |

## Per-Number Behavior

The brain reads `called_number_role` + `called_number_market` + `called_number_callback_hint` from Vapi `variableValues` on every call. These come from `NUMBER_PROFILES` in `vapi-webhook.js` (single source of truth — update one map, all numbers update).

### Public-facing primary (visible on website, business cards)
- **866-268-0111** (TN) — *"Hey, you've reached TN Appliance Exchange. What's broken today?"* (warm, TN market)
- **504-355-9111** (LA) — *"Hey, you've reached TN Appliance Exchange — we cover New Orleans, Baton Rouge, Hammond…"* (warm, LA market)

### Telnyx + Twilio SMS callback lines (CRITICAL — closes biggest leak)
Customers see these numbers when we text them. When they call back instead of texting:
- **615-588-9500** (Telnyx customer) + **629-284-0444** (Twilio failover customer):
  - *"Hey — got your number from a text we sent. What's going on?"*
  - Brain checks recent customer-direction SMS for the caller
- **615-857-8800** (Telnyx tech) + **727-350-8487** (Twilio failover tech):
  - *"Hey — what do you need?"* (terse)
  - Brain cross-checks caller_phone against tech roster; if matches, switches to tech-assist context

### Vanity for branded materials
- **1-888-ANT-8998** + **1-866-ANT-0111** — same warm opening as primary TN; classifyCaller spots known warranty company numbers and flips to b2b regardless

### Vapi BYO secondary (629-260-7111 / 629-247-7111)
- Same warm opening as primary TN
- Flagged in NUMBER_PROFILES as `vapi_secondary_tn` so we know to evaluate for release once 866-268-0111 is confirmed working

## Cost Picture

| Today | After cleanup | Monthly delta |
|---|---|---|
| RingCentral | killed | **−$300** |
| HCP | killed | **−$500** |
| Twilio numbers (×4 → ×2 kill mystery) | 2 keepers @ ~$1.15/mo = $2.30 | unchanged |
| Telnyx (×2, already paying SMS) | add voice ~$1/mo each = +$2 | +$2 |
| Vapi BYO TN (×2 secondary, KEEP as inventory) | unchanged | unchanged |
| Vapi inbound call minutes | active | +~$900 |
| **Net change** | | **+~$100/mo replacing receptionist + ending dead-air gap + holding strategic inventory** |

vs $3,500-4,500/mo human receptionist who only works 40 hrs/week and would need to learn every customer + every job from scratch.

## Operator Action Sequence

### Tomorrow morning (~45 min)

1. **Port 866-268-0111 from RingCentral → Vapi.** RingCentral typically requires a Letter of Authorization; expect 24-48 hrs for the port. Once submitted, cancel RingCentral immediately upon port confirmation. **$300/mo saved.**
2. **Cancel HCP.** **$500/mo saved.**
3. **In Vapi dashboard → Phone Numbers** → assign 866-268-0111 to "Ant Inbound v2" assistant.
4. **Repoint 504-355-9111** (Vapi BYO) to Ant Inbound v2. Currently on old assistant — flip the assignment.
5. **Test call to each → expect Ant greeting by-number-context.**

### Same day or next (~30 min)

6. **Enable voice on Telnyx 615-588-9500 + 615-857-8800.** Telnyx dashboard → Number settings → enable Voice → set Voice URL to your Vapi inbound URL OR forward to 866-268-0111. (~$1/mo per number to add voice).
7. **Enable voice on Twilio 629-284-0444 + 727-350-8487.** Same in Twilio dashboard. Failover lines should answer Ant the same way primary lines do.
8. **Test each → confirm callback context kicks in.**

### Kill landmines (5 min)

9. **In Twilio dashboard, DELETE 570-378-8177 + 234-219-3439.** Both point at Twilio demo IVR — brand-conflict risk. No legitimate use found.

### Vanity (~15 min)

10. **Port or forward 1-888-ANT-8998 + 1-866-ANT-0111 to Vapi.** These have been unrouted for months. After this they finally answer Ant.

### Vapi BYO repoint (5 min)

11. **Repoint 629-260-7111 + 629-247-7111 to "Ant Inbound v2"** in the Vapi dashboard. KEEP both — they're strategic inventory for the SaaS tenant future. Per the Strategic Inventory principle, releasing approved Vapi numbers we already own = paying premium to re-acquire later.

### Verify

12. Run `node colony-loop/scripts/smoke-phone-brain.js`
13. Call each number from a customer-roster phone → confirm by-name greeting + appropriate context
14. Call each number from an unknown phone → confirm generic greeting + correct market/callback context

## What's NEW after this cleanup

- **Customer texts you, calls back** → Ant answers immediately. Today they hit dead air. **This is the highest customer-impact fix.**
- **Tech calls from his cell to the tech SMS line** → Ant recognizes him and helps with job/parts. Today: dead air.
- **Warranty company dials any of our numbers** → Ant flips to b2b tone regardless of which number was dialed.
- **Twilio failover** stops being a brand inconsistency — failover SMS still goes from Twilio, but the customer's callback also reaches Ant.
- **Vanity numbers go live** (months-open gap closed).
- **2 mystery Twilio numbers deleted** before they bite us.

## When This Strategy Changes

- **Per-state expansion (Memphis, Chattanooga, Knoxville TN; Lafayette LA):** add per-market numbers to `NUMBER_PROFILES` with local market_context. Same brain, more local presence.
- **Marketing channel attribution (Google Ads, Facebook, Yelp):** add per-channel forwarder numbers. Brain captures `called_number_role` so we attribute leads per channel.
- **Dedicated warranty company B2B line:** if AHS dispatcher routing becomes a problem, add separate B2B-only number. Not needed yet — b2b tone classification handles it on existing numbers.

## Single Source of Truth

The map in `netlify/functions/vapi-webhook.js` → `NUMBER_PROFILES` constant. To add a number or change a role:
1. Add/edit the entry in `NUMBER_PROFILES`
2. Commit + push (Netlify auto-deploys)
3. In Vapi dashboard, assign the phone number to "Ant Inbound v2"
4. Done — brain reads the new profile on next call

No XS deploys, no Mac Mini reboot, no Vapi prompt edits.

## Operator Reference Card

```
KEEP — operational (all route to Ant Inbound v2):
  TN PRIMARY:      866-268-0111   (Vapi after RC port)
  LA MARKET:       504-355-9111   (Vapi already)
  TELNYX CUST:     615-588-9500   (callback context, primary SMS)
  TELNYX TECH:     615-857-8800   (tech context, primary SMS)
  TWILIO CUST:     629-284-0444   (callback context, FAILOVER SMS)
  TWILIO TECH:     727-350-8487   (tech context, FAILOVER SMS)

KEEP — strategic inventory (route to Ant Inbound v2 + reserve):
  VANITY 888:      1-888-ANT-8998 (SaaS tenant inventory + advertising)
  VANITY 866:      1-866-ANT-0111 (SaaS tenant inventory + advertising)
  VAPI BYO #1:     629-260-7111   (SaaS tenant inventory)
  VAPI BYO #2:     629-247-7111   (SaaS tenant inventory)

KILL (delete in Twilio dashboard — brand-conflict landmines):
  MYSTERY #1:      570-378-8177   (Twilio demo IVR)
  MYSTERY #2:      234-219-3439   (Twilio demo IVR)
```

## Why we keep so many numbers

Read the [phone inventory strategy memory](../.claude/projects/-Users-tpivacek-tn-appliance-tools/memory/project_phone_inventory_strategy.md) — short version: Twilio approval took a month, vanities are SaaS inventory + ad anchors, holding pre-approved numbers is real insurance against another month-long approval gap. Few dollars a month for that protection is obvious.

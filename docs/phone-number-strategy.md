# Phone Number Strategy — single source of truth

Last updated 2026-05-28. Owner: Teddy Pivacek.

## The Principle

**Every number a customer or tech might see reaches the same intelligent Ant brain. No dead ends. Same engine, different opening line per number.**

The brain knows which number was dialed and adapts. One assistant config in Vapi, six numbers attached, six different first messages and contexts. Cheap, maintainable, consistent customer experience.

## Current Numbers + Target Roles

| Number | Role | Currently | Target | Operator action |
|---|---|---|---|---|
| **615-280-2949** | Primary TN, every public page | RingCentral ($300/mo) | **Vapi → Ant Inbound** | Port from RC tomorrow morning |
| **504-355-9111** | Louisiana market | Unknown routing | **Vapi → Ant Inbound** (LA market context) | Verify ownership, port or forward |
| **615-588-9500** | Customer SMS line | Telnyx, voice → **dead air** | **Vapi → Ant Inbound** (callback-context profile) | Enable voice on Telnyx number, forward voice to Vapi |
| **615-857-8800** | Tech SMS line | Telnyx, voice → **dead air** | **Vapi → Ant Inbound** (tech-side profile) | Enable voice on Telnyx number, forward voice to Vapi |
| **1-888-ANT-8998** | National vanity | Owned, **unrouted** since acquisition | **Vapi → Ant Inbound** (vanity profile) | Port to Vapi or forward to 615-280-2949 |
| **1-866-ANT-0111** | Backup vanity | Owned, **unrouted** | **Vapi → Ant Inbound** (vanity profile) | Port or forward |

**No dead ends, no number sloppy mess. Every dial lands on Ant.**

## Per-Number Behavior

The brain reads `called_number_role` + `called_number_market` + `called_number_callback_hint` on every call. These come from `NUMBER_PROFILES` in `vapi-webhook.js` (single source of truth — update one map, all numbers update).

### 615-280-2949 (primary TN)
- **First message:** *"Hey, you've reached TN Appliance Exchange. What's broken today?"* (or by name if returning customer)
- **Tone:** warm_new / warm_returning
- **Market context:** Middle Tennessee — Nashville, Murfreesboro, Antioch, Clarksville

### 504-355-9111 (Louisiana)
- **First message:** *"Hey, you've reached TN Appliance Exchange — we cover New Orleans, Baton Rouge, Hammond. What's broken today?"*
- **Tone:** warm
- **Market context:** Louisiana, Hammond LA techs (Andre, Billy, John)

### 615-588-9500 (customer SMS callback) — **THIS IS THE BIG WIN**
- **First message:** *"Hey — got your number from a text we sent recently. What's going on?"* (or by name)
- **Tone:** warm + "we likely texted them" prior
- **Callback hint baked in:** brain pulls recent customer-direction SMS for this caller before responding
- **Closes the worst current leak:** every text we send, the customer's instinct is to call back. Today they hit dead air. After this, they hit Ant who already knows what we texted them about.

### 615-857-8800 (tech SMS callback)
- **First message:** *"Hey — what do you need?"*
- **Tone:** terse, tech-assist context
- **Behavior:** brain cross-checks caller_phone against tech roster. If it matches a known tech, switches to tech-side tools (job status, parts lookup) and skips customer warmth.

### 1-888-ANT-8998 + 1-866-ANT-0111 (vanity)
- **First message:** same as 615-280-2949
- **Tone:** warm_new
- **Note:** classifyCaller still spots known warranty company numbers and flips to b2b regardless of which number was dialed

## What Customers See (the visible footprint)

Public website (every page, every SEO landing): **615-280-2949** (TN) and **504-355-9111** (LA)

Outbound SMS FROM: **615-588-9500** (customer-facing) and **615-857-8800** (tech-facing)

Vanity for branded materials, business cards, partners: **1-888-ANT-8998** (lead) and **1-866-ANT-0111** (backup)

## What's Saving Money

| Today | After cleanup | Monthly savings |
|---|---|---|
| RingCentral | killed | **$300** |
| HCP | killed | **$500** |
| Telnyx voice (already paying for SMS) | enable voice (~$1/mo per number) | negligible |
| Vapi inbound calls | ~$0.24/min × 125 min/day | ~$900 (new cost) |
| **Net** | | **~+$100/mo while replacing receptionist + ending dead-air gap** |

vs $3,500-4,500/mo for a human receptionist. The phone strategy doesn't cost — it pays.

## Operator Action Sequence

**Step 1 (tomorrow morning, ~30 min):**
1. Port 615-280-2949 from RingCentral to Vapi
2. Cancel RingCentral the moment port confirms ($300/mo saved)
3. Cancel HCP ($500/mo saved)
4. In Vapi dashboard → Phone Numbers → assign 615-280-2949 to "Ant Inbound v2"
5. Place a test call → expect Ant greeting

**Step 2 (same day or next, ~30 min):**
1. Enable voice capability on Telnyx 615-588-9500 (Telnyx dashboard → Numbers → enable Voice)
2. Set Voice forwarding URL on Telnyx number → Vapi inbound URL (or forward to 615-280-2949)
3. Same for 615-857-8800 (tech line)
4. Test call to each → expect Ant greeting with the appropriate role-based opening

**Step 3 (when ready, ~15 min):**
1. Port or forward 504-355-9111 to Vapi
2. Port or forward 1-888-ANT-8998 to Vapi
3. Port or forward 1-866-ANT-0111 to Vapi
4. Test each

**Step 4 (verify):**
1. Run `node colony-loop/scripts/smoke-phone-brain.js`
2. Call each number from a customer-roster phone → confirm by-name greeting
3. Call each number from an unknown phone → confirm generic greeting + correct market context

## When This Strategy Changes

- **Per-state expansion (Memphis, Chattanooga, Knoxville TN; Lafayette LA):** add per-market numbers to NUMBER_PROFILES with the local market_context. Same brain, more local presence.
- **Marketing channel attribution (Google Ads, Facebook, Yelp):** add per-channel forwarder numbers. Brain captures `called_number_role` so we can attribute leads per channel.
- **Warranty company B2B dedicated line:** if AHS dispatcher routing becomes a problem, we can add a separate B2B-only number. Not needed yet — the b2b tone classification already handles it on the existing numbers.
- **24-hour answer guarantee:** never. The system already is 24/7. No staffing required to scale answer hours.

## Single Source of Truth

The map in `netlify/functions/vapi-webhook.js` → `NUMBER_PROFILES` constant. To add a number or change a role:
1. Add/edit the entry in `NUMBER_PROFILES`
2. Commit + push (Netlify auto-deploys)
3. In Vapi dashboard, assign the phone number to "Ant Inbound v2"
4. Done — brain reads the new profile on next call

No XS deploys, no Mac Mini reboot, no Vapi prompt edits.

## Operator Reference Card (print this)

```
TN PRIMARY:        615-280-2949  →  Ant Inbound (warm)
LA MARKET:         504-355-9111  →  Ant Inbound (LA context)
CUSTOMER SMS:      615-588-9500  →  Ant Inbound (callback context)
TECH SMS:          615-857-8800  →  Ant Inbound (tech context)
VANITY (lead):     1-888-ANT-8998 →  Ant Inbound (warm)
VANITY (backup):   1-866-ANT-0111 →  Ant Inbound (warm)
```

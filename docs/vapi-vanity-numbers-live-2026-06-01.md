# Vapi Vanity Numbers — Turn Live (2026-06-01)

**Goal:** Make 1-888-ANT-8998 (888-268-8998) and 1-866-ANT-0111 (866-268-0111) actually answer when someone calls them. Don't advertise yet — just have them be ready when you do.

## Current state

- Numbers are **owned** but **unrouted** (per CLAUDE.md)
- Calls today land nowhere — caller gets a fast-busy or operator intercept
- Ant Inbound agent in Vapi (id `7cc98b0c…`) is live and answering on the existing Vapi-assigned number (+16292607111)
- We need to **attach the vanity numbers** to the same agent

## Steps

### Step 1 — Confirm where the vanity numbers live

The vanity numbers were purchased through (most likely): Telnyx, RingCentral, or directly through Vapi's number marketplace. Confirm which.

- **If Telnyx** → §2A applies
- **If Vapi marketplace** → §2B applies
- **If RingCentral or somewhere else** → port them to Telnyx first (slower)

To check Telnyx: log in at portal.telnyx.com → Numbers → Verify the 888 + 866 numbers are listed.

### Step 2A — Telnyx-owned numbers → point to Vapi

1. Log in to portal.telnyx.com
2. Numbers → Inbound Number → click each vanity number
3. Voice section → **Connection** → select the Vapi SIP trunk
   - If no Vapi SIP trunk exists, create one:
     - SIP Connections → Create New
     - Type: Credentials or IP-based (Vapi documents the exact endpoint)
     - Vapi SIP endpoint: typically `sip.vapi.ai` (verify in Vapi docs / your account dashboard)
4. Voice section → **Webhook URL** → leave default (Vapi handles inbound natively via SIP)
5. Save
6. Repeat for the second vanity number

### Step 2B — Vapi-owned numbers → attach to agent

1. Log in at dashboard.vapi.ai
2. Phone Numbers → find the 888 / 866 vanity numbers
3. Click each → assign to "Ant Inbound" agent (id 7cc98b0c…)
4. Save

### Step 3 — Configure end-of-call webhook (for voicemail capture)

In Vapi dashboard → Ant Inbound agent → Server Webhook URL:

```
https://tnapplianceexchange.net/.netlify/functions/vapi-voicemail-webhook
```

This sends voicemail transcripts to Office Today's voicemail queue automatically (per the just-shipped pipeline).

### Step 4 — Test

Call each vanity number from your phone. You should:

1. Hear Vapi pick up with the Ant Inbound greeting
2. Be able to speak to Ant
3. Hang up — verify NO error fires in the Netlify function logs (it's fine if no voicemail webhook fires for this test; that's a separate event)

Test by leaving a voicemail to verify the queue picks it up:
- Call the number
- Ask for something Ant can't handle ("Can you connect me to a person directly?")
- Vapi should offer to take a message
- Leave one
- Hang up
- Within 60 seconds, you (Teddy) get the "[ant] new voicemail from …" SMS to 615-485-5795
- Within 60 seconds, Office Today shows it in the 📞 Voicemail queue section

### Step 5 — Main number (866-268-0111) — RingCentral kill

Once you're confident in Vapi's behavior on the vanity numbers (maybe a day of testing), do the same for 866-268-0111:

**Option A — Call forward from RingCentral to Vapi (instant, keeps porting option open):**

1. Log in to RingCentral admin
2. Phone System → Phone Numbers → 866-268-0111 → Settings
3. Call Handling → Always forward → enter your Vapi-attached Telnyx number (e.g., the 888 number)
4. Save
5. Test: call 866-268-0111 → RingCentral picks up → forwards to Vapi → Ant answers
6. After 1-2 days of confidence, port the number to Telnyx and cancel RingCentral.

**Option B — Direct port (faster $ savings but takes 1-3 weeks):**

1. In Telnyx portal → Numbers → Port Numbers → submit 866-268-0111
2. Provide RingCentral Letter of Authorization + recent bill
3. Wait for the carrier handoff (1-3 weeks)
4. Once ported → configure Vapi SIP routing (per §2A above)
5. **Then** cancel RingCentral

**Recommendation:** Option A first — instant + zero risk. Port later when you're 100% confident in Vapi's call quality + edge case handling.

## Cost impact

- **Today:** RingCentral $300/mo + Vapi ~$ pay-per-minute (depends on volume)
- **After Option A:** Same RingCentral $300/mo (until canceled) + Vapi (forwarded leg costs more if RC charges for the forward, may not)
- **After Option B (port + cancel):** Vapi pay-per-minute only

Rough monthly savings after Option B: $200-280/mo (Vapi inbound is typically $0.05-0.10/min; ~200-500min/mo of inbound = $20-50/mo).

## Risks + rollback

- **If a call drops** mid-Vapi conversation: caller hangs up. No SMS captured. Mitigation: Vapi quality monitoring + you can always set RingCentral forward back to the office phone.
- **If Vapi hits a question it can't handle**: it offers voicemail → goes to Office Today queue → you call back. That's the designed fallback.
- **If a customer says "this is an emergency"**: Vapi should escalate to Teddy directly. The Ant Inbound agent prompt should include an emergency-keyword bypass that calls forward to your cell instead of taking voicemail. (Verify this in the prompt.)

## What I built on the receiving side (already deployed)

- `netlify/functions/vapi-voicemail-webhook.js` — endpoint for Vapi's webhook
- `api/intake/record_vapi_voicemail_POST.xs` — Xano persister + owner SMS
- `api/intake/clear_voicemail_POST.xs` — clears the item from the queue
- Office Today page — renders the 📞 Voicemail queue section + ✓ Cleared button

You just need to attach the numbers + set the webhook URL in Vapi.

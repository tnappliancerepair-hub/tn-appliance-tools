# Danielle — Vacation Week Runbook

**Teddy's vacation starts Friday 2026-06-05.** Here's what's running automatically while he's gone, what you need to do, and how to reach him if it's a real emergency.

---

## What Ant is doing AUTOMATICALLY (no clicks needed)

The system is now doing things on its own that we used to do manually. **Don't be alarmed when you see these happen — they're working as designed.**

### 1. Customer confirmation calls (24h before every appointment)
- Ant places an outbound call to every customer 24 hours before their appointment
- Customer hears: *"Hi Sarah, this is Ant from TN Appliance Exchange — calling to confirm your washer repair tomorrow at 10 with Jimmy. We still good?"*
- If they say YES → call ends, confirmation logged
- If they say RESCHEDULE → Ant texts them 3 new slot options (A/B/C)
- If voicemail → Ant tries ONCE more 30 min later
- The SMS reminder also still goes out at the same time (unchanged)

### 2. Missed call callbacks (5 min after any unanswered inbound call)
- If a customer calls one of our numbers and doesn't get connected (voicemail, busy, hangup), Ant calls them back 5 minutes later
- Customer hears: *"Hey, this is Ant from TN Appliance Exchange — saw you called about 5 minutes ago. What can we help you with?"*
- This catches customers before they call a competitor

### 3. Parts-arrived calls (when parts come in)
- When parts arrive for a job that's been waiting, Ant calls the customer to schedule the revisit
- Customer hears: *"Good news, your inverter compressor just came in for your fridge repair — want me to send you three open times by text?"*
- Customer says yes → Ant texts the slots
- Only fires 9am-7pm CT (no 3am calls)

### 4. Inbound calls — all numbers route to Ant
- Every TN Appliance Exchange phone number (629-260, 629-247, 615-588, 615-857, 866, 888, 504-355, 504-380, 731-503) routes to ONE unified "Ant Inbound" assistant
- Ant detects if it's a warranty company CSC or a homeowner based on what they say first
- Tools used: lookup by WO#, claim#, dispatch#, or job_id; status check; reschedule; new intake; transfer

### 5. Daily review (8-11am every morning)
- Ant grades yesterday's calls on 5 dimensions
- Sends Teddy a daily SMS with averages + top improvement ideas
- **While Teddy is on vacation, this digest will CC to your phone too** (via the vacation backup setting)

---

## What YOU need to do (everyday work)

### Office Today dashboard — your main view
- URL: `tnapplianceexchange.net/office-today.html`
- Priority cards at the top
- **NEW**: every card has a green "📞 Call" pill in the bottom-right corner
  - Click it → opens a dispatch page → click Dispatch → Ant calls the customer immediately
  - Smart-default call types: voicemail card → callback, warranty card → AHS authorization, etc.

### Job-detail page — per-customer view
- URL: `tnapplianceexchange.net/job-detail.html?job_id=X`
- **NEW**: "🤖 Ant Call" button in the action bar (next to Reschedule/Reassign/Cancel)
- Click → dispatch screen → pick call type → Dispatch
- Ant places the call from a Telnyx 615 number that shows "TN APPLIANCE" on caller ID

### Voice dispatch page directly
- URL: `tnapplianceexchange.net/voice-dispatch.html`
- Type a job ID, pick a call type, dispatch
- Use this if a customer needs an active follow-up call

---

## How to reach Teddy if it's a REAL emergency

**Real emergency examples:**
- System-wide outage (no inbound calls landing, no SMS going out)
- A customer is threatening legal action / BBB / lawyer
- A tech reports a serious safety issue (gas leak, water flood)
- Anything you'd normally call Teddy about that can't wait

**Phone:** `+1-615-485-5795`

**Text first** — Teddy will respond if it's something he needs to handle. Don't call unless it's truly urgent.

---

## Vacation backup is active

Every SMS that would normally only go to Teddy will ALSO come to you with `[bkup]` prefix. This includes:
- Healthcheck warnings if anything in the system breaks
- Watchdog alerts (Vapi outage, Xano outage, etc.)
- Daily Claude spend digest
- Daily Vapi call review digest

**You don't need to act on every [bkup] message** — they're for visibility. Act if something is clearly broken or a customer is being affected.

---

## If something looks broken

### Inbound calls not landing
1. Call any of our numbers from your cell (629-260-7111 is the most-used)
2. If you hear Ant — system is fine
3. If you hear dead air or "this number cannot be reached" — text Teddy

### SMS not going out
1. Check `event_log` for action="sms_gated" or "send_failed"
2. Most likely cause: `CUSTOMER_FACING_ENABLED=false` is still set in Xano env (Teddy's been holding it OFF)
3. Don't change this without checking with Teddy

### Outbound calls failing
1. Check `event_log` for action="voice_call_dispatched" rows
2. Click into one — should show `vapi_call_id`
3. If many fail, the Vapi key might be wrong — text Teddy

### Tech says "Ant is calling customers about appointments without me knowing"
1. Tell tech this is now AUTOMATIC at 24h before every appointment
2. SMS + voice both fire
3. If customer reschedules, tech gets the new time via existing TECH_ASSIGNED chain

---

## What's NOT working / pending Teddy's return

- **615-280-2949** — the main line is forwarded from RingCentral to 615-588-9500 (Teddy set this up Wednesday night). After June 8, this number ports directly to Telnyx — RC service can be canceled.
- **"TN APPLIANCE" caller ID name** — registered Wednesday, propagates to carrier databases over 24-72h. By the weekend, all outbound calls from 615-588 should show "TN APPLIANCE" instead of just the number.
- **CNAM not registered on Twilio 504-355-9111** (LA primary) — Teddy will do this after vacation, or we can port to Telnyx for cheaper CNAM

---

## Quick reference

| Need to... | Where |
|---|---|
| See today's priority work | `office-today.html` |
| Open a specific job | `office-today.html` → click card, OR `job-detail.html?job_id=X` |
| Have Ant call a customer | Click "📞 Call" on any card, OR open `voice-dispatch.html` |
| Find a customer | `customer-search.html` |
| Review warranty submissions | `warranty-review.html` |
| Check calendar / scheduling | `office-calendar.html` |
| Reach Teddy in real emergency | Text **+1-615-485-5795** |

**You've got this. The system has your back. 🐜**

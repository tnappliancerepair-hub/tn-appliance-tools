# Phone Ant Brain — operator runbook

The replacement for the 11 static Vapi prompts. Vapi becomes the
transport layer (telephony + STT + TTS); the brain runs server-side
in `netlify/functions/phone-ant-brain.js` and inherits every platform
intelligence (outcome learning, cross-brain bus, confidence gating,
warranty fingerprints, pre-job intel, comms style, adversarial review,
capability-gap loop, spend cap).

## Architecture

```
PSTN call → Vapi telephony
   ↓
Vapi → POST /vapi-webhook (event: assistant-request)
   ↓
Returns dynamic assistant config pointing model.provider="custom-llm"
at /phone-ant-brain. Pre-loads caller via lookup_customer_by_phone.
   ↓
Vapi connects call → per-turn:
  Vapi → POST /phone-ant-brain (OpenAI chat-completion format)
  Brain runs through brain-core (Claude tool-calling)
  Brain returns OpenAI completion → Vapi speaks via 11Labs
   ↓
Call ends → Vapi → POST /vapi-webhook (event: call-end)
Writes:
  - phone_call_summary event_log (for get_recent_call_summary)
  - brain_observation (cross-brain bus, so other brains see it)
  - VAPI_CALL_COMPLETED signal (existing chain unchanged)
```

## Operator setup

### 1. Deploy the 8 new XS endpoints via Xano CLI

```
cd ~/tn-appliance-tools
xano workspace push -i "**/lookup_customer_by_phone*" --force
xano workspace push -i "**/get_open_jobs_for_customer*" --force
xano workspace push -i "**/get_recent_call_summary*" --force
xano workspace push -i "**/send_customer_a_link*" --force
xano workspace push -i "**/request_callback*" --force
xano workspace push -i "**/escalate_phone_call_to_human*" --force
xano workspace push -i "**/mark_safety_emergency*" --force
xano workspace push -i "**/start_warranty_intake_from_phone*" --force
xano workspace push -i "**/update_customer_note*" --force
```

### 2. Configure ONE master Vapi assistant for inbound

In the Vapi dashboard, create a NEW assistant (don't edit the old
11) called "Ant Inbound v2":

- **Model**: Custom LLM
  - URL: `https://tnapplianceexchange.net/.netlify/functions/phone-ant-brain`
  - Model name: `phone-ant` (any string — server picks the model)
- **Voice**: 11Labs voice ID `pNInz6obpgDQGcFmaJgB` (placeholder for v1; replace with cloned Teddy voice in a later sprint)
- **Transcriber**: Deepgram, model `nova-2-phonecall`, language `en`, smart-format on
- **First message mode**: assistant-speaks-first
- **First message**: leave blank — server fills it dynamically per caller
- **Max duration**: 900 seconds
- **End call phrases**: `goodbye, bye now, take care`
- **Server URL (webhook)**: `https://tnapplianceexchange.net/.netlify/functions/vapi-webhook`
- **Server URL events**: enable `call-start`, `end-of-call-report`, `assistant-request`

### 3. Wire phone numbers to the new assistant

In the Vapi "Phone Numbers" section, assign:
- The Telnyx-side inbound number (whatever number routes to Vapi today)
- The vanity numbers `1-888-ANT-8998` and `1-866-ANT-0111` (port them
  or set up SIP forwarding to Vapi — this has been an open gap)

### 4. Keep the 11 old agents for a week (failsafe)

Don't delete them yet. If the new brain misbehaves, route the main
inbound number back to "Ant Inbound" (old). Once 1 week of clean
calls is logged, decommission the old 11 + the 4 unused James Repair
agents.

### 5. Set env vars on Netlify

- `ANT_PHONE_MODEL` — default `claude-sonnet-4-5-20250929`; can
  override to test a different model
- `ANT_PHONE_VOICE_ID` — 11Labs voice ID, default `pNInz6obpgDQGcFmaJgB`.
  After voice cloning Sprint 4, set this to Teddy's cloned voice ID
- `ANT_DAILY_HARD_CAP_USD` — already exists; phone calls are critical
  paths so they run until the HARD cap. Recommend $200 hard cap for
  the first week while we measure call volume

## What the brain CAN do (Phase 1 tool surface)

Read:
- `lookup_customer_by_phone` (called automatically on call-start)
- `get_open_jobs_for_customer`
- `get_recent_call_summary`
- `get_pre_job_intelligence`
- `get_warranty_vendor_fingerprint`
- `load_brain_observations`

Write:
- `send_customer_a_link` (portal, photo upload, tracking, payment, calendar)
- `request_callback` (books a tracked callback promise)
- `escalate_to_human` (SMS-handoff to Teddy/Danielle with one-line summary)
- `mark_safety_emergency` (gas leak / electrical / flooding / fire / medical)
- `start_warranty_intake` (creates job stub + texts resume-chat link)
- `update_customer_note` (free-form note appended to customer record)
- `record_brain_observation` (other brains see what this call surfaced)
- `flag_capability_gap` (architect ingests, builds the missing tool)

NOT YET wired (Sprint 4+):
- Live phone transfer (Vapi `transferCall` action) — today escalate is
  SMS-handoff only. v2 will add real warm-transfer to Teddy's cell.
- Voice cloning of Teddy via 11Labs Pro tier.
- Per-tech outbound voice clones.
- Sentiment analysis mid-call for emotional-intensity escalation.

## Smoke test — first live call

1. Call your own Vapi number from a phone whose number is on file as a customer.
2. Brain should greet you by first name + reference any open job.
3. Ask "what's the status of my appointment?" — expect specific answer with tech name + scheduled time.
4. Say "can you text me the link to track him?" — expect SMS to land within 3 seconds.
5. Say "actually I need Teddy to call me back at 4pm" — expect confirmation + callback row in event_log.

If any step fails, check `event_log` for `phone_call_summary` rows + Netlify function logs.

## Cost guardrails

- Soft cap: `ANT_DAILY_SPEND_CAP_USD` (default $50). Phone calls are
  flagged `critical: true` in brain-core ctx so they BYPASS the soft
  cap (customer experience first). They still respect the HARD cap.
- Hard cap: `ANT_DAILY_HARD_CAP_USD` (default 4× soft = $200). When
  hit, phone brain returns a graceful "let me get Teddy to call you
  back" fallback instead of dead air.

Expected: $1 - $1.50 per inbound at current 2-3 min avg call duration.

## Capability gap → architect loop

When the brain hits a question it CAN'T answer with current tools, it
calls `flag_capability_gap`. After 3 hits with the same signature
within 14d, `capability_gap_to_blueprint` writes a TO_BUILD entry into
the blueprint. Next 6am architect run builds the new tool. **The
phone brain gets smarter every week.**

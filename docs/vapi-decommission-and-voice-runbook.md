# Vapi cleanup — decommission old agents + voice cloning plan

## Part 1: which old agents to KILL after 1 week clean

The new Phase 1 stack (phone-ant-brain inbound + phone-ant-outbound) replaces 11 + 4 = 15 dashboard agents with 2 Custom-LLM endpoints. Once the new stack has a clean week of production calls, retire the old.

### Inbound agents → replaced by `phone-ant-brain` + assistant-request multi-tone routing
| Old agent | What it did | Now handled by |
|---|---|---|
| Ant Inbound | Main receptionist | phone-ant-brain (warm_returning + warm_new tone) |
| Ant After Hours | Off-hours triage + safety | phone-ant-brain (sentiment detection auto-triggers safety_emergency tool) |
| Ant Warranty Company Inbound | B2B for AHS/SP/Frontdoor | phone-ant-brain (b2b tone, classified by KNOWN_WARRANTY_NUMBERS env) |

### Outbound agents → replaced by `phone-ant-outbound` SCENARIOS map
| Old agent | What it did | Now phone-ant-outbound purpose= |
|---|---|---|
| Ant Warranty Fallback | 2hr after warranty job no form | `warranty_fallback` |
| Ant Parts Follow-Up | Parts arrived → offer slots | `parts_followup` |
| Ant Appointment Reminder | Day-before reminder + access info | `appointment_reminder` |
| Ant Missed Call Callback | Sub-2-min return call | `missed_call_callback` |
| Ant Authorization Update | Warranty auth status delivery | `authorization_update` |
| Ant Parts ETA Update | Parts ordered + ETA delivery | `parts_eta_update` |
| Ant Tech Running Late | Late ETA + reschedule | `tech_running_late` |
| Ant Reschedule (hybrid) | Reschedule from either direction | Inbound side: phone-ant-brain. Outbound side: phone-ant-outbound (purpose='reschedule_offer' — add to SCENARIOS if needed) |

### James Repair agents (4) → DELETE on day 1
These were dev/qa/prod variants of a different brand. Not wired to anything in Xano. Pure cost with no value. Delete immediately, don't wait for the 1-week trial.

## Part 2: decommission procedure (per-agent)

For each retired agent in the Vapi dashboard:
1. Confirm no inbound/outbound endpoint in Xano still calls it (search XS for the assistant ID)
2. Confirm no production job (a number routed to it, a schedule, or a workflow) targets it
3. Rename to `[ARCHIVED] <original name>` (Vapi doesn't allow soft-delete, but renaming makes it obvious)
4. Remove from phone-number routing
5. Wait 7 days
6. Hard delete

Skip steps 1-5 for the 4 James Repair agents — they're unwired by definition.

## Part 3: voice cloning runbook (Sprint 4 — operator-side)

### Why we waited

Heisenberg-voice is $0.11/min and gets the job done. Cloned voice is $0.30/min via 11Labs Pro. Voice cloning is a customer-perception upgrade — important once we're growing, not a day-1 must-have. Per Teddy: "voice later."

When ready, the change is one config flip (env var). No code changes needed — `voiceIdForTone()` already reads from env.

### What you'll need

1. 11Labs Pro tier subscription (~$22/month at time of writing)
2. A quiet room, USB mic (Blue Yeti / Shure MV7 / similar), Audacity or any DAW
3. The recording script (below) — 5 minutes of varied speech samples

### The recording script

Read these aloud at conversational pace. Three pieces of varied content gets 11Labs enough phonetic coverage. Don't read robotically — vary your tone naturally like you would on the phone.

**Piece 1 — Warm customer-facing greeting (30 sec each, record 3 takes):**

> "Hey, this is Ant from TN Appliance Exchange — what can I do for you today? I see we don't have an active job for you. Is this for the fridge that we worked on last March, or something new? Got it. So you're saying it's making a loud humming and the freezer's warming up. That sounds like it could be the compressor or the start relay — let me check your warranty status real quick. Looks like you're with American Home Shield. Want me to start a new claim for you and get a tech out there this week?"

**Piece 2 — Status delivery / business tone (30 sec, 2 takes):**

> "Quick update on your repair — the part for your dishwasher just came in from Marcone, and Andre's got time Tuesday morning between nine and eleven, or Wednesday afternoon between one and three. Which works better for you? I'll send you a text confirmation as soon as we hang up so you've got the new appointment time."

**Piece 3 — Apology / running late (30 sec, 2 takes):**

> "Hey Sarah, this is Ant from TN Appliance Exchange. Quick heads up — Jimmy's running about thirty minutes behind schedule today. His ten o'clock job ran long. New ETA for you is around eleven thirty. Does that still work, or would you like to push it to tomorrow morning instead? I'm sorry for the change. We'll send you a tracking link so you can see exactly when he's pulling in."

**Piece 4 — Safety triage (15 sec, 1 take):**

> "Okay, stop. If you smell gas right now, leave the house immediately and call nine-one-one. Don't turn anything on, don't flip any switches. Once you're safe and 911 is on the way, call me back at this number and we'll figure out next steps. Are you out of the house?"

### Upload + train

1. Combine pieces into a single 3-5 min WAV at 44.1kHz mono, 16-bit
2. 11Labs dashboard → Voices → Add Voice → Instant Voice Clone (or Professional Voice Clone if available on Pro tier — better quality, takes 2-4 weeks)
3. Get the voice ID from 11Labs
4. Netlify env: `ANT_PHONE_VOICE_TEDDY` = the new voice ID
5. No code change needed — `voiceIdForTone()` in vapi-webhook.js already reads it

### Cost reality at upgraded voice

| Component | Heisenberg ($0.11) | Cloned voice ($0.30) |
|---|---|---|
| 11Labs | $0.11/min | $0.30/min |
| Total per minute | $0.24/min | $0.43/min |
| 125 min/day | $30/day | $54/day |
| Monthly | ~$900 | ~$1,650 |

Differential: $750/month for the upgrade. Worth it when monthly revenue >$30k. Not worth it before.

### Per-tech voice clones (later)

Once Teddy's voice is cloned + working well, repeat for each active tech (Jimmy, Andre, Lee, Billy, John). Outbound calls FROM that tech (Parts Follow-Up, Running Late) use their voice. Customer hears Andre's voice telling them Andre will be there at 2:30. Higher perceived authenticity.

5 cloned voices × $5/mo each = $25/mo extra. Tiny vs. customer trust gain.

### B2B voice (already wired)

`ANT_PHONE_VOICE_B2B` env var → different voice for warranty company callers. Heisenberg works fine for B2B. If you want a more "professional/formal" tone, pick a different stock 11Labs voice ID and set the env.

## Part 4: smoke test plan

After Vapi dashboard setup + env vars set + 9 XS endpoints deployed:

### Test 1 — inbound recognized customer
Call your Vapi number from a phone whose number is on file.
- Expect: Brain greets by first name + references open job if any
- Verify: phone_call_summary written, brain_observation written

### Test 2 — inbound unknown caller
Call from a non-customer number.
- Expect: "Hey, you've reached TN Appliance Exchange. What's broken today?"
- Verify: new customer flow

### Test 3 — outbound parts_followup
Trigger an outbound via Vapi API with variableValues={purpose:"parts_followup", customer_id:X, job_id:Y, first_name:"Sarah", tech_first_name:"Andre", appliance_type:"dishwasher"}
- Expect: phone-ant-outbound opens with the parts_followup scenario opener
- Verify: scenario routing works

### Test 4 — escalation
Say "I want to talk to Teddy" mid-call.
- Expect: brain calls escalate_to_human, says "Hang on, connecting you with Teddy right now"
- Verify: Vapi forwards to Teddy's number; event_log shows phone_brain_escalated

### Test 5 — safety override
Say "I think there's a gas leak in my kitchen."
- Expect: Brain says call 911 immediately, calls mark_safety_emergency
- Verify: Teddy receives 🚨 SAFETY EMERGENCY SMS

### Test 6 — anger detection
Say "This is bullshit, I want a refund right now" (or similar test phrase).
- Expect: Brain softens tone, acknowledges, offers escalate_to_human
- Verify: System prompt for that turn included the anger hint

### Test 7 — capability gap
Ask something Ant clearly can't do — "Can you order me a pizza?"
- Expect: Brain calls flag_capability_gap + says "That's not something I can help with, but I can grab Teddy"
- Verify: brain_capability_gap event_log row written

### Test 8 — send a link
Say "Can you text me the link to track the tech?"
- Expect: Brain calls send_customer_a_link(type=tracking)
- Verify: SMS arrives within 3 seconds + phone_brain_sent_link event_log row

## Part 5: ongoing — the self-improving loop

After 14 days of production calls + outcomes attributed, the
`prompt_evolution_proposer` agent runs Sunday 7pm CT and SMSes you a
short digest of any (brain, signal_type) cells underperforming + a
concrete prompt revision proposal for each. You review, apply via git,
ship. Next week's outcomes show whether the revision worked.

This is the closing of the outcome-learning loop. The phone brain
gets measurably smarter every week without you having to notice
specific failures.

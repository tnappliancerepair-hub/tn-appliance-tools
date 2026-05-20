# SMS Architecture — TN Appliance Exchange / Appliance Ant Platform

**Date:** 2026-05-19
**Author:** T (with Claude planning support)
**Status:** Active execution plan
**Supersedes:** Twilio-primary SMS architecture (Twilio now backup-only)
**Related docs:** `docs/six-week-plan-2026-05-09.md`, `docs/ant-tech-scheduler-design-v2.md`, `docs/ant-tech-assist-design-v1.md`, `docs/vapi-agent-inventory-2026-05-11.md`

---

## 1. Why this exists

Dawn (office staff, customer scheduling/inbound) entered an unplanned medical absence the week of 2026-05-19 and may not return. This forces an accelerated cutover from the manual scheduling and inbound-phone model to the fully automated Appliance Ant platform. Simultaneously, Telnyx 10DLC + toll-free verification cleared on the local Tennessee numbers, while Twilio remains stuck in the seventh resubmission loop. The platform pivots to Telnyx as primary SMS and voice provider; Twilio becomes failover-only once it eventually clears.

---

## 2. Telnyx number inventory

| Number | Type | Vanity | Use |
|---|---|---|---|
| +1 615 588 9500 | TN local | — | Customer-facing SMS (all transactional) |
| +1 615 857 8800 | TN local | — | Tech + internal SMS (broadcasts, Tech Assist, Danielle, owner alerts) |
| +1 888 268 8998 | Toll-free | 1-888-ANT-8998 | Primary customer inbound voice → Vapi general intake |
| +1 866 268 0111 | Toll-free | 1-866-ANT-0111 | Specialty / warranty inbound voice → Vapi warranty agent |

### Numbers to provision (next two weeks)

| Number | Type | Use | Priority |
|---|---|---|---|
| 1× LA local (504 / 985 / 225) | Local | Louisiana customer SMS | Required — Andre/Billy/John work LA |
| 1× TN local backup | Local | Customer SMS failover | Recommended |
| 1× LA local backup | Local | LA customer SMS failover | Recommended |

Target total: 7 numbers. Trivial cost (~$7-10/month), critical for redundancy.

### Branding note — 268 = ANT

Both toll-frees spell ANT on the keypad. This is the platform-defining branding moment. All marketing, vehicle wraps, business cards, Google Business Profile, website, Vapi greetings should lead with the vanity format: "Call The Ant — 1-888-ANT-8998."

---

## 3. Full SMS inventory (every text in the business)

### Customer SMS — sent from +16155889500 (TN customers); from new LA local once provisioned

**Pre-intake**
1. Welcome + Ant intake link (warranty customer dispatched, or Quick Check customer entered system)

**Pre-scheduling**
2. Jotform waiver link

**Scheduling**
3. Available slot offer
4. Appointment confirmation
5. Reschedule available slots (when needed)

**Day of service**
6. 30-min-out ETA (existing, auto-fires)
7. Tech running late (existing, tech-triggered)

**Mid-job**
8. Parts ETA notification
9. Return-visit scheduling
10. Authorization needed (estimate + approve/decline)

**Post-service**
11. Feedback request (2 hr after completion, existing)
12. Good route — replied 5 → Google review link (existing)
13. Mid-range — replied 1-4 → "anything we can do better"
14. Bad route — replied 0 → owner alert to 615-485-5795, customer apology SMS (existing)

**Future relationship**
15. Open-ended inbound → routes to chat/reply2 brain as new lead

### Tech SMS — sent from +16158578800

**Onboarding (new tech joins platform)**
16. Tech welcome + scheduler kickoff
17. Conversational availability collection (zones, days, times, hard/soft preferences) — via Ant Tech Scheduler

**Daily operations**
18. Daily summary (morning) — already built as `daily_tech_summary` (#9), gated by DAILY_SUMMARY_ENABLED
19. Job broadcast — claim/decline pattern
20. Schedule change notifications
21. Availability check requests

**During job — Tech Assist**
22. TDR completion nudge
23. Part number / diagnostic help (conversational)
24. Return-visit scheduling assistance
25. Soft-block escalation at 2hr (owner alert)

**Earnings transparency (NEW — Phase 3 build)**
26. Weekly earnings ping (Friday EOD)
27. Payment notification on pay day (3rd / 18th)
28. Pending payment query — tech texts "PAY" or "OWED" → full breakdown

**Owner-only**
29. Job reassignment notification
30. Availability override
31. Pattern detection alerts (e.g., "you've declined 4 morning slots this week")

### Internal SMS — also from +16158578800

32. Danielle TDR-ready alert
33. Danielle daily queue summary
34. Owner critical alerts (feedback 0, system errors, no-shows, escalations)

---

## 4. Voice architecture

| Number | Vapi agent | Routes to |
|---|---|---|
| 1-888-ANT-8998 | General intake | New customer leads, scheduling, general questions → Vapi handles → escalate to voicemail/owner if needed |
| 1-866-ANT-0111 | Warranty intake | Warranty company callbacks (AHS, SquareTrade, NSA), authorization updates, parts ETAs |

Existing Vapi numbers (629/504) — TBD whether they're deprecated in favor of these two toll-frees or kept as additional inbound paths. See `docs/vapi-agent-inventory-2026-05-11.md`.

RingCentral 615-280-2949 port to Vapi remains pending — once complete, that number can route to the same Vapi general intake or be deprecated entirely in favor of 1-888-ANT-8998.

---

## 5. Provider routing logic

**Environment variables (Xano):**

```
TELNYX_API_KEY            = (NOC-created key, stored as secret)
TELNYX_PROFILE_ID         = 40019e28-9488-4a86-aef9-764f7a8b2891
TELNYX_FROM_CUSTOMER      = +16155889500
TELNYX_FROM_TECH          = +16158578800
TELNYX_FROM_CUSTOMER_LA   = (to be provisioned)
SMS_PROVIDER              = telnyx                  # kill-switch: telnyx | twilio
SMS_ENABLED               = true                    # master on/off
```

**Routing decision tree (in `send_sms_POST.xs`):**

1. If `SMS_ENABLED` is false → log + skip send
2. If recipient is in `technicians` table (or matches office staff list) → use `TELNYX_FROM_TECH`
3. Else if recipient state is LA (lookup via customer or job) and LA number provisioned → use `TELNYX_FROM_CUSTOMER_LA`
4. Else → use `TELNYX_FROM_CUSTOMER`
5. If `SMS_PROVIDER = telnyx` → POST to Telnyx API
6. If `SMS_PROVIDER = twilio` (failover) → POST to Twilio API with existing logic
7. Log delivery status from response, store in existing `sms_log` table

---

## 6. Telnyx API integration spec

**Endpoint:** `POST https://api.telnyx.com/v2/messages`

**Headers:**
```
Authorization: Bearer ${TELNYX_API_KEY}
Content-Type: application/json
```

**Body:**
```json
{
  "from": "+16155889500",
  "to": "+16154855795",
  "text": "message body here",
  "messaging_profile_id": "40019e28-9488-4a86-aef9-764f7a8b2891"
}
```

**Success response:** HTTP 200 with `data.id` (Telnyx message UUID), `data.to[0].status` ("queued" or "sending")

**Status callback (delivery receipts):** Set the messaging profile webhook URL in Telnyx portal to a new Xano endpoint, `telnyx_delivery_webhook`. Payload differs from Twilio — see Telnyx docs.

**Inbound SMS webhook:** Set messaging profile inbound webhook to `customer-sms-inbound-telnyx` (new Netlify or Xano endpoint). Telnyx payload format differs from Twilio (top-level `data.payload.from.phone_number`, `data.payload.text`, etc.). Signature verification: `Telnyx-Signature-Ed25519-Signature` header.

---

## 7. Phased build order

### Phase 1 — Cutover (this week)

- [x] Telnyx env vars added to Xano
- [ ] Modify `send_sms_POST.xs` to route through Telnyx primary, Twilio fallback (see Section 5 routing logic and Section 6 API spec)
- [ ] Route 1-888-ANT-8998 inbound voice → Vapi general intake (Telnyx portal task, owner)
- [ ] Route 1-866-ANT-0111 inbound voice → Vapi warranty intake (Telnyx portal task, owner)
- [ ] Update Google Business Profile primary phone to 1-888-ANT-8998 (owner)
- [ ] Update website footer / header to 1-888-ANT-8998 (Claude Code if in repo)
- [ ] Send test SMS through each path (tech-side and customer-side) to confirm delivery
- [ ] Flip `TECH_ASSIST_ENABLED` to true; walk one tech through it
- [ ] Send tech kickoff SMS to all 6 techs (see Section 9)

### Phase 2 — Number expansion & LA support (next week)

- [ ] Provision LA local number (504 / 985 / 225)
- [ ] Provision TN local backup number
- [ ] Provision LA local backup number
- [ ] Add `TELNYX_FROM_CUSTOMER_LA` env var
- [ ] Update routing logic in `send_sms_POST.xs` to handle LA → LA number
- [ ] Test LA customer SMS via Andre or Billy's customer base

### Phase 3 — Self-scheduling activation

- [ ] Flip `SCHEDULING_QUEUE_ENABLED` to true once techs have laid out real availability
- [ ] Flip `DAILY_SUMMARY_ENABLED` to true
- [ ] Customer-facing SMS triggers (welcome + Ant intake link, Jotform waiver) — confirm wired into existing chat flow

### Phase 4 — Earnings transparency (Tech Assist expansion)

- [ ] New tool / intent: `tech_payment_status_query`
- [ ] Triggers: tech texts "PAY", "OWED", or "WHAT AM I OWED"
- [ ] Returns: paid (last paycheck), pending payment (with breakdown by warranty co), incomplete TDRs blocking payment (with one-tap fix links)
- [ ] Data sources: existing commission calculation logic in financial dashboard, `tdrs` table, payment cycle dates
- [ ] Optional: weekly Friday EOD auto-ping with summary

### Phase 5 — Polish & gap-fill

- [ ] Authorization SMS flow (estimate → approve/decline)
- [ ] Parts ETA notification (data flow from HCP or parts-ordering source)
- [ ] Reschedule customer self-service link
- [ ] Multi-job customer handling (one invoice or two?)
- [ ] Twilio failover testing (once Twilio clears 10DLC)

---

## 8. Twilio failover plan

Twilio stays in `send_sms_POST.xs` as a fallback path. When Twilio finally clears 10DLC:

- Set `SMS_PROVIDER = telnyx` (current — already set)
- Code path supports `twilio` value if Telnyx ever fails or is throttled
- Tech inbound number +17273508487 (Twilio toll-free) stays as-is for now; migrate later only if needed
- Twilio creds (hardcoded in send_sms_POST.xs per security note) still need to be rotated and moved to env vars — flagged in genealogy

---

## 9. Tech kickoff message (Phase 1, send-today)

Sent from +16158578800 to each of the 6 techs. See companion draft in chat for the actual text content.

Single send. Replies route into `tech_sms_inbound` (existing endpoint, 10 tools including UPDATE_AVAILABILITY and ADD_PREFERENCE). Techs build their schedules conversationally with Ant Tech Scheduler. Once availability data exists for all 6 techs, Phase 3 (SCHEDULING_QUEUE_ENABLED) can activate.

---

## 10. Open questions / decisions deferred

- Vapi 629/504 numbers: deprecate or keep as additional inbound paths? (See `docs/vapi-agent-inventory-2026-05-11.md`)
- LA local area code: 504 (New Orleans), 985 (Hammond / North Shore), or 225 (Baton Rouge)? Recommend 504 for geographic coverage of Andre's NOLA preference plus broader recognition.
- RingCentral 615-280-2949: port to Vapi or deprecate in favor of 1-888-ANT-8998 as public-facing voice? Recommend port for continuity of an established number; eventually feature ANT vanity as primary.
- Dawn's role post-recovery: held open, or platform absorbs entirely? Treat as platform-absorbs for planning; revisit if she returns.

---

## 11. Source-of-truth genealogy

This doc supersedes the SMS-related sections of:
- `docs/six-week-plan-2026-05-09.md` §SMS triggers
- Any Twilio-primary assumption in prior docs

It is consistent with:
- `docs/ant-tech-scheduler-design-v2.md`
- `docs/ant-tech-assist-design-v1.md`
- `docs/vapi-agent-inventory-2026-05-11.md`

Future doc updates should reference this file when describing SMS routing or number assignments.

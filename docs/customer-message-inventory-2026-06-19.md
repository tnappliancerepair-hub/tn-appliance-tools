# 📋 Customer Message Inventory + Minimal-but-Informed Policy (2026-06-19)

Every SMS/voice that can reach a CUSTOMER, so we keep messaging minimal but informative and never spam. Owner review doc. **Status:** customer SMS master gate (`CUSTOMER_FACING_ENABLED`) is OFF; this is the pre-go-live review.

## ⚠️ Two critical findings before go-live
1. **Robocalls BYPASS the SMS gate.** `CUSTOMER_FACING_ENABLED` only gates SMS. The 5 auto-call paths (24h reminder call, running-late call, parts-arrived call, reschedule call, missed-call callback) are gated only by their OWN env flags — and several **default ON**. Flipping the SMS gate does NOT control the robocalls; they must be set deliberately. (They may already be able to fire on their triggers.)
2. **Most dedups are per-JOB, not per-customer.** A warranty customer with 2–3 open AHS jobs gets the full message set PER JOB — greetings, confirmations, reminders multiply. No cross-job throttle.

## The journey (full list)
**Intake/availability:** (1) greeting+availability ask [immediate] · (2) 2nd availability ask AVAILABILITY_REQUEST [dup] · (3) availability nudge [+2h] · (4) availability robocall [+5h] · (5) resume-nudge [daily 9:30a] · (6) stuck-intake "M/A?" [daily 10:45a]
**Scheduling:** (7) confirmation [on booking] · (8) 24h reminder TEXT · (9) 24h reminder CALL
**Day-of:** (10) on-the-way+ETA · (11) arrived · (12) running-late CALL · (13) running-behind text
**Parts:** (14) parts-arrived [event] · (15) parts-arrived [daily 11a] · (16) parts CALL [daily 11a]
**After job:** (17) feedback [+24h] · (18) Google review [+7d] · (19) review on 4–5★ · (20) new-customer welcome [+24h] · (21) invoice [self-pay] · (22) pay link [self-pay] · (23) diagnostic prepay [-12h] · (24) service-agreement offer [+1h] · (25) self-warranty offer [denial] · (26) upsell [-24h] · (27) maintenance reminder [+180d] · (28) proactive failure warning · (29) re-engagement [Tue] · (30) reactivation [Mon]
**Cancel/reschedule:** (31) canceled · (32) cancel follow-up [+24h] · (33) reschedule options · (34) reschedule CALL · (35) missed-call callback CALL [+5min] · (36) retry CALL
**Reactive:** ~50 `sms_response_*` agents answer inbound customer texts (Claude-composed, warm, reply-inviting).

## 🚩 Spam clusters
- **A. Front-loaded "when are you free?" stack:** greeting + (dup ask) + nudge + robocall + 2 daily asks = up to 4 texts + 1 call BEFORE anything's scheduled. **Worst offender.**
- **B. Double-touch:** 24h reminder = text AND robocall. Parts = up to 2 texts + 1 robocall. Pick one channel per event.
- **C. After-job pile-up (self-pay):** invoice + pay link (both immediate, both carry invoice URL) + service-agreement + feedback + welcome + review.
- **D. Multi-job multiplication** (per-job dedup, no per-customer throttle).

## ✅ MINIMAL-BUT-INFORMED POLICY (recommended for go-live)
**KEEP ON (the moments that matter — keep the customer informed):**
- ONE welcome+availability ask (trimmed greeting, portal link + "reply with your availability")
- ONE availability nudge (one-and-done)
- Confirmation when scheduled
- 24h reminder — **TEXT ONLY** (call OFF)
- On-the-way + arrived (day-of)
- Parts arrived — **TEXT ONLY** (one, not the daily double)
- ONE feedback ask after completion

**MUTE for launch (turn on later, deliberately):**
- 2nd availability ask (#2) — duplicate of greeting
- Daily resume-nudge (#5) + stuck-intake (#6) — overlap the cascade
- All availability/reminder/parts ROBOCALLS — keep voice flags OFF until proven
- All self-pay marketing: upsell, service-agreement, diagnostic-prepay, maintenance, proactive-failure, re-engagement, reactivation
- Google review can stay (per-customer 60-day dedup = low spam)

**Net minimal journey ≈ 5–6 texts across a clean job** (welcome → nudge-if-needed → confirm → reminder → on-the-way/arrived → feedback), vs the 15+ worst case.

## Reply-friendliness
Tone is already warm + reply-inviting across the board ("just reply right here," "text us anytime," "no pressure"). Inbound replies get answered by the ~50 reactive agents. The fix needed is VOLUME, not tone.

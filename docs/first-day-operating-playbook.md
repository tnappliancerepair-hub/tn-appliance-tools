# First Day Operating Playbook

**Date written:** 2026-05-31
**Use when:** Pasting Tier 1 and flipping `CUSTOMER_FACING_ENABLED=true`. Keep this open on a second monitor or your phone during go-live.

This playbook walks through the first hour, first 4 hours, and first day after the system goes operational. Each section names: what to expect, where to look, what's normal, what's an abort trigger.

---

## Pre-flight checklist (do this BEFORE you paste)

Run these checks. If any fail, fix first.

**1. Verify env vars are set correctly:**
- `CUSTOMER_FACING_ENABLED=false` — stays false until dry-run passes
- `EMAIL_INTAKE_ENABLED=true` — must be true or `create_job_from_email` rejects
- `SCHEDULING_QUEUE_ENABLED=true` — must be true or the worker no-ops (confirmed via liveness probe yesterday, but double-check)
- 🚨 **`SMS_ENABLED=true`** — **CRITICAL.** If false, broadcast SMS only reaches owner (Teddy). Non-owner techs get `sms_gated` event_log rows instead of real SMS. This gate is independent of `CUSTOMER_FACING_ENABLED`. Verify in Xano UI → Settings → Environment Variables.
- `HCP_PUSH_DISABLED=true` and `HCP_WEBHOOK_DISABLED=true` — parallel-mode safeties stay on
- `PARSER_ACTIVATION_TS_MS` — set to a recent timestamp so old emails don't replay
- `OWNER_PHONE_NUMBER=+16154855795` — should already be set

**2. Verify the test scaffold works:**
```bash
node colony-loop/scripts/test-scheduler-chain.js --no-create
```
Should print initial banner and exit cleanly. (Real run comes after Tier 1 paste.)

**3. Heads-up text to your techs (Jimmy, Lee, Andre, Billy, John):**
```
Going live with the new auto-dispatch in next 30 min. You may
get a text from the system asking "TN Metro: <appliance> <problem>.
who wants it? reply yes to grab." That's the new way jobs come
in. Reply YES from the phone you got it on to claim. Reply N
or just ignore if you can't take it.

For the first day I'll be watching live so any weirdness I'll
catch and tell you.
```
Send before you flip CUSTOMER_FACING_ENABLED on. Avoids the surprise.

---

## Hour 0 — the paste + dry-run

**Step 1**: Xano UI → REPLACE `create_job_from_email` with `scheduler-1-create_job_from_email.txt` → Publish.
**Step 2**: Xano UI → REPLACE `ahs_email_intake` with `scheduler-2-ahs_email_intake.txt` → Publish.

**Step 3** — dry-run, Test A (safest, no real tech disturbance):
```bash
node colony-loop/scripts/test-scheduler-chain.js
```
Default zip 00000 = no cluster match. Expected output:

| Step | Expected | If different |
|---|---|---|
| POST | `job_id=<X>` returned, success=true | endpoint not published correctly; re-paste |
| 1. `parallel_job_created_from_email` | ✓ found in <2s | endpoint not running new code |
| 2. `parallel_job_auto_enqueued` | ✓ found in <2s | scheduler-1 paste didn't take |
| 3. `scheduling_queue row created` | ✓ id=<Y>, action=broadcast | enqueue logic broken |
| 4. `worker pickup` | ✓ status=processing or completed within 60s | `SCHEDULING_QUEUE_ENABLED=false`? |
| 5. `queue row finalized` | ✓ status=completed, notes="broadcast failed: no cluster" | stuck at processing = null-job footgun |
| 6. `outcome: cluster-not-found escalation` | ✓ confirmed via result_notes | look at queue row notes manually |

**You should receive ONE owner-direction SMS** to your phone: something like "[ant] Job <X> in zip 00000: no cluster found, manual schedule needed."

**Step 4** — cleanup test artifacts:
```bash
node colony-loop/scripts/test-scheduler-chain.js --cleanup
```

If steps 1-6 all green, proceed to flip. If any red, **DO NOT FLIP** — diagnose first.

---

## Step 5 — flip `CUSTOMER_FACING_ENABLED=true`

Xano UI → Settings → Environment Variables → `CUSTOMER_FACING_ENABLED` → set to `true` → save.

**The instant you save, all customer-direction SMS that were being gated start firing.** That includes:
- Greeting SMS for any pre-existing not-yet-greeted jobs (should be near-zero — the greeting agent dedups via `get_greeting_sent_for_job`)
- Appointment confirmation SMS for any job that gets a `scheduled_start` set
- Reminder SMS for tomorrow's appointments (if any)
- On-the-way / arrival / followup SMS as techs work jobs

If you have any concerns, **flip it back to false** — no harm done, all events resume gated.

---

## Hour 0–1 — watching the first real broadcast

Open these in tabs:
- `tnapplianceexchange.net/office-pulse.html` — live event_log stream (refresh ~30s)
- `tnapplianceexchange.net/office-kanban.html` — see jobs as they progress
- Your Telnyx SMS console (if it has one) — outbound delivery status

**What you should see in the first hour:**

Customers who chat with Ant on the website → job creates → auto-enqueue → broadcast SMS to qualified TN Metro techs within 60s → tech replies YES → claim → customer SMS confirmation → tech SMS confirmation. Each happens within ~2 min of the prior step.

**Specifically, the new broadcast SMS body to techs looks like:**
```
TN Metro: Whirlpool refrigerator not cooling. . who wants it?
reply yes to grab.
```

Note: **the FROM number is `+16292840444`** (customer-direction). This is a known UX wart from May 21's TCR mitigation. Functionally fine — claims process correctly — but techs may notice they're getting broadcast SMS from the same number that customers see. To fix: change FROM in `scheduling_queue_worker.xs` at lines 348, 573, 973, 1100, 1363 from `+16292840444` to `+17273508487`. Deferred.

---

## Hour 1–4 — pattern recognition

Things to actively watch for:

**Expected (healthy patterns):**
- Multiple broadcasts firing per hour as web-chat traffic flows
- Most broadcasts claimed within 5-15 minutes by the right cluster tech
- `scheduling_queue` rows transitioning `pending → processing → completed` cleanly
- `event_log` shows: `parallel_job_created_from_email`, `parallel_job_auto_enqueued`, `broadcast_attempt` rows, `proposal_accepted` (when claimed), `appointment_scheduled` SMS

**Watch for (yellow flags):**
- A broadcast that's been `open` for >25 minutes → tech didn't reply → escalation imminent (you'll get an SMS at 30 min)
- Multiple broadcasts in same cluster within minutes → techs may feel spam → consider rate-limiting
- `sms_gated` event_log rows showing non-owner phones → `SMS_ENABLED=false`? Stop, fix, resume

**Red flags (consider rolling back):**
- `scheduling_queue_orphan_job_skipped` event_log rows showing up → only if scheduler-3 already pasted, otherwise rows stuck at `processing`
- Any tech replying confused ("which job?") → SMS body needs job_id added → defer fix unless multiple
- Customer complaints about repeat or wrong messaging → flip CUSTOMER_FACING_ENABLED off, investigate
- `ERROR_FATAL` rows in event_log → flip off, investigate, resume

---

## Hour 4 onward — settling in

By hour 4 you should have data on:
- Real claim rate (% of broadcasts claimed within 30 min). Target: >70%. If <50%, techs aren't engaging; investigate.
- Real escalation rate (% requiring you to PICK manually). Target: <15%. If >30%, broadcast handler isn't finding qualified techs.
- Customer SMS error rate. Target: <2%. Telnyx delivery failures (carrier blocks, bad numbers) live here.
- Average time from job-created to job-claimed. Target: <15 min during business hours.

If targets are missed → DM me with the numbers, we tune.

---

## End-of-day debrief (paste, save, ship)

Run `node colony-loop/scripts/test-scheduler-chain.js` once more at end of day. Verify the chain still works at the same speed as it did at hour 0.

Update CLAUDE.md with a brief "first day" note: what landed, what surprised, what to watch tomorrow.

If everything was green: paste scheduler-3 (worker null-job hardening + ?? fixes) tomorrow. Not before. One change at a time.

---

## Abort triggers (when to flip `CUSTOMER_FACING_ENABLED=false`)

Flip it back to `false` immediately if:
1. A customer receives an SMS that's clearly wrong or alarming
2. Multiple customer complaints inside the same hour
3. A tech is confused about claiming AND you can't reach them to clarify
4. `event_log` shows >5 `ERROR_FATAL` rows in 10 minutes
5. `scheduling_queue` has >10 rows stuck at `processing` (worker is broken)
6. Mac mini colony loop is unresponsive (`/get_latest_heartbeat` stale >15min)
7. Anything that makes you say "I don't know what just happened"

Flipping it off does NOT lose data. All jobs, all queue rows, all event_log entries stay. The system just stops sending customer SMS until you flip back on. Diagnose, fix, resume.

---

## What's NOT operational on day 1

Honest list of things you'll notice that aren't going to work yet:

- **No vapi voice yet** — vanity numbers 888-268-8998 + 866-268-0111 owned but unrouted. Customer calls go nowhere. Defer.
- **No AHS poller repoint yet** — AHS emails still hit legacy `ahs_email_intake`, not `create_job_from_email`. Both work, but the legacy path enqueues `broadcast` (after scheduler-2 paste) so should still auto-dispatch. SP emails stay as-is — they come pre-scheduled.
- **No worker null-job hardening yet** — if an orphan row arrives, worker stalls at `processing`. Scheduler-3 fixes this; paste tomorrow.
- **No scheduler health watchdog yet** — coming next session.
- **No SMS body with job_id yet** — techs reply "yes" generically; system uses most-recent open broadcast as match.
- **AHS backlog of ~16k not_ready jobs** — these don't auto-drain. Manual decision when you want to backfill.

---

## Numbers to know

| Thing | Where to find |
|---|---|
| Loop heartbeat | `curl /api:3e_TffpA/get_latest_heartbeat` |
| Queue depth | Office Pulse → `scheduling_queue` count |
| Today's broadcasts | Office Pulse → `broadcast_attempt` filtered to today |
| Errors today | Office Pulse → search "error\|fail\|fatal" |
| `OWNER_PHONE_NUMBER` | `+16154855795` (Teddy) |
| `DANIELLE_PHONE_NUMBER` | `+16154850713` |
| Broadcast SMS FROM (current) | `+16292840444` — should be `+17273508487` later |
| Customer SMS FROM | `+16155889500` |

---

## When you're done with day 1

Send Claude a one-message debrief:
- claim rate %
- avg time to claim
- any surprises
- anything that needs immediate fix tomorrow

We tune from there.

🐜 Good luck.

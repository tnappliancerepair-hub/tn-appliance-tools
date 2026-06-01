# Tuesday Morning Playbook — 2026-06-02

The exact sequence for tomorrow's customer SMS gate flip.

## Before you do ANYTHING (5 min)

Open these 3 URLs in 3 tabs:
1. **`tnapplianceexchange.net/readiness.html`** — go/no-go dashboard
2. **`tnapplianceexchange.net/sms-pulse.html`** — live SMS activity watcher
3. **`tnapplianceexchange.net/office-today.html`** — where you flip the gate

Verify **readiness** shows ✅ GO across all 6 checks. If any is ❌:
- **Heartbeat ❌**: colony loop crashed overnight. Run:
  `launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`
- **Pollers ❌**: Gmail OAuth might have expired again. Re-run `node scripts/gmail-oauth-init.js`
- **Backup ❌**: not urgent (last week's backup is fine), but flag for evening fix
- **Errors_quiet ❌**: open the office-pulse page to see what's erroring before flipping
- **State_machine ❌**: rare, would mean no transitions happened in 24h. Check Xano admin.
- **Scheduler ❌**: cron may have been disabled. Check Netlify dashboard.

If all ✅, proceed.

## The flip (1 tap)

1. Open **office-today.html** → top banner shows `🧪 PRACTICE MODE · ... · Customer SMS: 🔒 OFF`
2. Tap the **🔒 OFF** pill
3. Confirm dialog: "Turn customer SMS ON for parallel jobs?" → **OK**
4. Banner now shows **🟢 ON**
5. You should receive an immediate SMS: `[ant] customer SMS gate flipped 🟢 ON for parallel jobs (by office_today)`

## First 30 minutes (watch carefully)

Keep **sms-pulse.html** open and refreshing (auto-refreshes every 10s):

**What "good" looks like:**
- Inbound number ticking up modestly (customer replies arriving)
- Sent number = roughly Inbound number + a few extras (greetings + confirmations)
- Errors = 0
- Dropped = 0 (gate is on, so customer messages aren't being dropped anymore)
- Each event in the live stream has a sensible body preview

**What "bad" looks like:**
- Errors > 0 → click into the event_log for that error
- Sent rate spikes way faster than inbound (could indicate spam loop)
- Same recipient_last4 receiving many messages in short time (could indicate retry loop)

## If something looks wrong (rollback)

**To flip the gate back OFF in 5 seconds:**
1. Tap the **🟢 ON** pill on office-today.html
2. Confirm
3. All new customer-direction sends will drop + log immediately

No outbound queues to drain — gate is checked on each send_sms call.

## After the first hour

If pulse looks clean:
- Open **office-today.html** and look at the queue
- Are real customer jobs landing from email pollers?
- Tap any one to verify the full lifecycle (open `job-lifecycle.html?job_id=X`)

If volume looks light:
- Pollers might have processed older emails already labeled
- Trigger a manual poll: `curl -X POST https://tnapplianceexchange.net/.netlify/functions/ahs-gmail-poller`

## End of day (5 min)

1. Open **office-dashboard.html** → All Jobs tab
2. Count today's intake (filter to last 1 day if needed)
3. Compare against historical AHS/SP daily volume — should match within reason
4. Note any odd states for tomorrow's review

## If you need to fully roll back the architectural work

```
git checkout pre-phase1-refactor-2026-06-01
git push --force-with-lease origin main
# Then deploy via Netlify dashboard
```

This nukes everything from tonight's session. Probably not needed — but the safety net is there.

## Quick reference URLs

- `tnapplianceexchange.net/readiness.html` — system health
- `tnapplianceexchange.net/sms-pulse.html` — live SMS activity
- `tnapplianceexchange.net/office-today.html` — queue + gate toggle
- `tnapplianceexchange.net/office-dashboard.html` — all jobs
- `tnapplianceexchange.net/job-lifecycle.html?job_id=X` — any job's full timeline
- `tnapplianceexchange.net/sms-pulse.html` — live SMS pulse

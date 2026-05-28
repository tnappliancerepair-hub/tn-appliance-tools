# Colony loop went zombie — root cause TBD

## What happened

At 8:49 CT on 2026-05-28, Teddy received an SMS alert:

> 🚨 [ant] colony loop appears down - no heartbeat in 913 min (last event_id=1081...)

913 minutes = ~15.3 hours, meaning the last successful heartbeat was around **17:35 CT on 2026-05-27** (yesterday afternoon).

## State on diagnosis

- `launchctl list` showed the loop process WAS RUNNING (pid 3492) — not crashed
- `colony-loop.err.log` was zero bytes (last modified May 24) — no stderr output, no exception
- The process was "alive but stuck" — Node event loop blocked, or a Promise hung, or some external API call never returned
- `kickstart -k` cleared it cleanly. New process (pid 37883) immediately resumed dispatching signals and writing heartbeats

## Why root cause is unknown

The previous process's stdout log got truncated by the kickstart/process-restart sequence (launchd's plist did not rotate the log; restart reopened the same file). By the time diagnosis began, only post-restart entries were visible. No forensic data from the stuck window.

## Hypothesis

Probably one of:
1. **Stuck Anthropic / OpenAI API call** — a tool-calling brain hit a network hiccup, awaited a response forever, blocked the tick loop. Mitigation: every fetch in agents needs an AbortController with timeout.
2. **Stuck Xano write** — a db.add or db.edit returned 5xx with no timeout enforced on the client. Same fix.
3. **Filesystem fill or memory pressure** — the log file is 8.3 MB (manageable) but unbounded growth could matter on a smaller disk. Could also be Node heap OOM that triggered swap.
4. **Caffeinate disconnected** — Mac Mini went to sleep, woke up to a stale process that didn't recover its connections.

## Mitigations to consider (deferred)

In priority order:

1. **Add a watchdog inside tick.js** — if no successful tick in N minutes, force `process.exit(1)` so launchd respawns. Self-heal.
2. **Audit all `await fetch()` in agents/** — confirm every one has a timeout via AbortController. The brains shipped recently (tech/office/customer/website Ant) already use this pattern; older agents (waiver_due, no_show_check, etc.) may not.
3. **Rotate logs via launchd plist** — set `StandardOutPath` rotation so we preserve the log when a restart happens.
4. **Add an explicit heartbeat-write check** — after each `recordHeartbeat` call, log success vs failure to local out.log so we can see in forensics whether the heartbeat path itself was blocked.

## Operator action — none required right now

Loop is back up, alert silenced via fresh heartbeat write (event_id 244804). No action from Teddy. The mitigations above are improvements to discuss when there's time.

## Reference

- Restart command: `launchctl kickstart -k "gui/$UID/com.tnappliance.colony-loop"`
- Healthcheck endpoint: `get_latest_heartbeat` — used by `colony-loop/scripts/healthcheck.js`
- Heartbeat write path: `xano.recordHeartbeat()` → `record_heartbeat_POST.xs` → event_log action=`colony_loop_heartbeat`

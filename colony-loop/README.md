# colony-loop

24/7 Node.js daemon for the Mac Mini. Polls `colony_signals` in Xano, dispatches each row to the matching `agents/<signal_type>.js` function, writes results back.

This is Phase A of `docs/colony-loop-design.md`. Producer wiring on existing XS endpoints (Phase B) is not done yet — test this loop end-to-end first.

## Prereqs

- Node 20+ (already on Mac Mini per `docs/mac-mini-setup-checklist.md` §2.3).
- Five XS support endpoints pasted into Xano UI (see "Deploy step 1" below).
- Anthropic API key.

## Layout

```
colony-loop/
  index.js              entry point (setInterval -> tick)
  tick.js               main loop body
  dispatch.js           signal_type -> agents/<file>.js
  xano.js               HTTP client for Xano (fetch-based, no deps)
  claude.js             Anthropic HTTP wrapper (vision-capable)
  sms.js                wraps xano.sendSms, E.164 normalize
  escalate.js           fire-and-forget owner SMS for human-judgment branches
  time.js               America/Chicago time helpers
  config.js             env var loader (reads .env, validates required)
  agents/
    daily_briefing.js          DAILY_BRIEFING signal -> SMS digest to owner
    payroll_calculator.js      PAYROLL_CALCULATOR signal -> commission calc + SMS
    job_created.js             JOB_CREATED signal -> customer greeting + upload link
    customer_intake_reply.js   CUSTOMER_INTAKE_REPLY signal -> Claude pre-diagnosis
  rules/
    commission_rules.json      per-tech commission %s (versioned)
  prompts/
    pre_diagnosis.md           Claude system prompt for CUSTOMER_INTAKE_REPLY
  scripts/
    smoke-test.js              one-shot: env loaded, all 5 XS endpoints reachable
    inject-signal.js           manual signal emitter for testing
  xano-endpoints/intake/       <- paste these into Xano UI; not deployed automatically
  launchd/                     <- macOS plist for auto-start
```

## Env vars

See `.env.example`. Copy to `.env` for local dev. On the Mac Mini, prefer the `EnvironmentVariables` block in the launchd plist over a `.env` file.

Required: `XANO_INTAKE_BASE`, `XANO_CASH_TDR_BASE`, `ANTHROPIC_API_KEY`, `OWNER_PHONE_NUMBER`.

`DRY_RUN=true` is recommended for first runs — SMS and TDR-send calls become no-ops that log to stdout.

## Deploy

### Step 1 — paste the 5 XS support endpoints into Xano

The loop talks to Xano through 5 dedicated XS endpoints. They live in `xano-endpoints/intake/` but Xano doesn't deploy from this repo — paste them via the Xano UI:

| File | API group | Verb | Path |
|---|---|---|---|
| `get_pending_colony_signals_GET.xs` | intake | GET | `/api:3e_TffpA/get_pending_colony_signals` |
| `mark_signal_processed_POST.xs` | intake | POST | `/api:3e_TffpA/mark_signal_processed` |
| `emit_colony_signal_POST.xs` | intake | POST | `/api:3e_TffpA/emit_colony_signal` |
| `get_daily_briefing_fired_today_GET.xs` | intake | GET | `/api:3e_TffpA/get_daily_briefing_fired_today` |
| `get_greeting_sent_for_job_GET.xs` | intake | GET | `/api:3e_TffpA/get_greeting_sent_for_job` |

After pasting, smoke-test from this directory:

```bash
DRY_RUN=true npm run smoke
```

All 5 reachability checks must pass before continuing.

### Step 2 — deploy the loop to the Mac Mini

```bash
ssh tpivacek@<mac-mini>     # or sit at it
cd ~/code/tn-appliance-tools
git pull
cd colony-loop

# fill in real ANTHROPIC_API_KEY in the launchd plist or set as env
# then load:
cp launchd/com.tnappliance.colony-loop.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist

# verify alive:
tail -f ~/Library/Logs/colony-loop.out.log
# should see: {"t":"...","action":"loop_started",...}
```

To restart after a code change:

```bash
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```

## Verify end-to-end

### Greeting flow (the missing trigger)

```bash
# inject a fake JOB_CREATED with Teddy's own phone (owner-bypass-safe)
node scripts/inject-signal.js --type=JOB_CREATED --payload='{
  "job_id": 99999,
  "source": "manual_test",
  "customer_first_name": "Teddy",
  "customer_phone": "+16154855795",
  "appliance_type": "dishwasher"
}'
```

Within 60 seconds: Teddy's phone receives the greeting. `event_log` shows a `new_job_greeting_sent` row.

Re-running the same inject within 24h should be skipped (idempotency via `get_greeting_sent_for_job`).

### Daily briefing

Will fire automatically between 8-11am CT. To test off-hours, set `MOCK_BRIEFING_NOW=true` in env (not implemented v0 — inject manually instead):

```bash
node scripts/inject-signal.js --type=DAILY_BRIEFING --payload='{}'
```

### Pre-diagnosis

Requires a job with attached media OR a problem_summary string. Once one of the chat-sourced jobs has an attachment uploaded:

```bash
node scripts/inject-signal.js --type=CUSTOMER_INTAKE_REPLY --payload='{"job_id":<id>,"trigger":"media_uploaded"}'
```

Watch `event_log` for `signal_processed` rows.

## Observability

The loop writes structured JSON to stdout (captured by launchd → `~/Library/Logs/colony-loop.out.log`). Each line is one event.

Important actions you can grep for:
- `loop_started` — process boot
- `loop_tick` — heartbeat (every 15 min minimum, or when work happens)
- `signal_dispatched` / `signal_processed` / `signal_error` — per-signal lifecycle
- `daily_briefing_emitted` — when the loop's clock-trigger fires DAILY_BRIEFING
- `greeting_held_quiet_hours` — JOB_CREATED arrived outside 8am-9pm CT, held

Important actions written to Xano `event_log` (queryable from anywhere):
- `colony_signal_emitted` — every emit_colony_signal call
- `signal_processed` — every successful dispatch
- `signal_error` — every failed dispatch
- `new_job_greeting_sent` — used by idempotency check
- `daily_briefing_fired` — used by daily de-dup check
- `sms_sent` / `sms_gated` — written by Xano send_sms, not by the loop

## Adding a new agent

1. Pick a `SIGNAL_TYPE` (uppercase snake_case).
2. Add `agents/<signal_type_lowercased>.js` with `export async function run(signal, ctx)`.
3. Restart the loop. The dispatcher imports new agents on first signal of that type — no other wiring needed.
4. (Producer side, Phase B) Make some upstream XS endpoint emit that signal type via `emit_colony_signal`.

## Quiet hours

Per design Q12: no customer-facing SMS before 8am or after 9pm CT. Implemented in `agents/job_created.js` — out-of-hours greetings are held and re-emitted to themselves with `scheduled_for_ms = next 8am CT`. The agent's top-of-run check skips and re-emits if `scheduled_for_ms` is in the future.

This applies to JOB_CREATED only. Owner SMS (escalations, briefing) intentionally ignores quiet hours — Teddy opted in.

## Known limitations (v0)

- **`countCompletedPreDiagnoses` is a stub** in `agents/customer_intake_reply.js`. Returns 0 so the first-20-always-escalate window is effectively permanent until wired. Easy fix: query event_log for `action = pre_diagnosis_auto_fired`. Deferred to after first live shake-down so we don't accidentally auto-fire on day one.
- **`logEvent` for heartbeat-style events is local-only** (stdout/launchd log). Per-signal lifecycle events DO go to Xano event_log via `mark_signal_processed`.
- **Producer wiring (Phase B) not done.** Until then, JOB_CREATED only fires via `scripts/inject-signal.js` or the chat-side `create_job_from_chat` (if we add the emit there first).
- **Customer-SMS inbound webhook not assumed.** CUSTOMER_INTAKE_REPLY only fires from media uploads (which trigger via `save_attachment` -> emit), not from text replies. Per design Q11.

## Stopping

```bash
launchctl unload ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist
```

To stop temporarily without unloading:

```bash
launchctl bootout gui/$UID/com.tnappliance.colony-loop
```

# Colony Loop — Design v0 (2026-05-24)

A 24/7 Node.js daemon on the Mac Mini that polls Xano's `colony_signals` table, dispatches each pending signal to the right in-process agent function, and writes the result back. This is the production runtime referenced in `CLAUDE.md` Architecture section, replacing Xano-task-based agents (10-task limit, XS parser footguns, no Claude in the loop).

This doc is the DESIGN ONLY. No code is written until Teddy reviews and approves.

---

## 1. Scope

**In:**
- Single Node.js process; 60-second tick.
- Reads `colony_signals` rows where `processed_at IS NULL`, dispatches by `signal_type`, writes result + marks processed.
- Three v0 agents: `DAILY_BRIEFING`, `PAYROLL_CALCULATOR`, `PRE_DIAGNOSIS`.
- Time-triggered signals (8am CT for DAILY_BRIEFING) emitted by the loop itself, not by external cron.
- All side effects (Xano writes, SMS, Claude calls) audit-logged to `event_log`.

**Out (v0):**
- High availability / multi-instance run (single Mac Mini only — assume one writer).
- Customer-reply inbound handling (a separate webhook → Xano → signal path; out of scope).
- Process manager beyond `launchd`. No PM2, no forever.
- Retry queues, dead-letter queues, exponential backoff. Failed signals are marked processed with an error in `event_log`; operator re-queues manually if needed. (Avoids poison-pill blocking the loop.)
- Web UI / dashboard. All observability via `event_log`.

---

## 2. Constraints & guiding decisions

| Constraint | Decision |
|---|---|
| "No dependencies we don't need" | Node 20+ native `fetch`. No `node-cron`, no `express`, no DB client. The only external thing the loop talks to is Xano (HTTP) and Anthropic (HTTP). |
| Reuse existing Xano SMS path | Loop does NOT carry Twilio/Telnyx credentials. It POSTs to Xano `send_sms` endpoint, which handles SMS_ENABLED gate, owner-bypass, provider routing, and event_log writes. One choke point, no duplication. |
| Working rule 3 (automate-or-SMS) | Every agent function that hits a human-judgment branch routes through a single `escalateToOwner(question, options)` helper that texts +16154855795 and waits for `approve`/`reject` reply. v0 helper STUBS the wait — see §11. |
| Working rule 6 (auditability) | Every tick + every dispatch + every escalation writes to `event_log`. Nothing happens off-record. |
| Cache-warmth / cost | DAILY_BRIEFING and any prompt-heavy agent that calls Anthropic uses prompt caching (system blocks marked `cache_control`). Saves ~80% on repeated runs. |

---

## 3. Process model

- **Runtime:** Node 20+ (already on Mac Mini per `mac-mini-setup-checklist.md` §2.3).
- **Tick:** `setInterval(tick, 60_000)`. Each `tick` is `async`; runs to completion before the next is scheduled (use a `running` guard to skip an overlap rather than queue ticks).
- **Process supervisor:** `launchd` on macOS with `KeepAlive=true`. If the process crashes or the Mac Mini reboots, launchd restarts it. (Plist sketch in §13.)
- **No clustering, no worker threads.** Single-threaded sequential dispatch within each tick.

```
+----------------------------+
| tick (every 60s)           |
|                            |
|  maybeEmitTimeSignals()    |
|  fetchPendingSignals()     |
|  for sig of signals:       |
|    result = dispatch(sig)  |
|    markProcessed(sig.id)   |
|    logEvent('signal_done') |
|  heartbeat()               |
+----------------------------+
```

---

## 4. Tick algorithm (precise sequence)

```
async function tick() {
  if (running) return;          // skip overlap
  running = true;
  const t0 = Date.now();
  let processed = 0, errors = 0;

  try {
    await maybeEmitTimeSignals();        // step 0
    const signals = await xano.fetchPendingSignals();   // step 1
    for (const sig of signals) {
      try {
        const result = await dispatch(sig);             // step 2
        await xano.writeResult(sig.id, result);          // step 3 (result -> event_log, see §6)
        await xano.markProcessed(sig.id);                // step 3 (continued)
        processed++;
      } catch (err) {
        errors++;
        await xano.markProcessed(sig.id);                // mark processed even on error (no poison-pill)
        await xano.logEvent('signal_error', { signal_id: sig.id, signal_type: sig.signal_type, error: String(err), stack: err.stack });
      }
    }

    // heartbeat: only when interesting OR every 15 minutes
    if (processed > 0 || errors > 0 || (Date.now() - lastHeartbeat) > 15 * 60_000) {
      await xano.logEvent('loop_tick', { tick_ms: Date.now() - t0, signals_processed: processed, errors });
      lastHeartbeat = Date.now();
    }
  } catch (err) {
    // Loop-level catch (network out, Xano down, etc.). Log to stderr if Xano unreachable.
    try { await xano.logEvent('loop_error', { error: String(err) }); }
    catch (_) { console.error('LOOP_ERROR', err); }
  } finally {
    running = false;
  }
}
```

**Step 0 — `maybeEmitTimeSignals()`:**
For each time-triggered agent (currently only `DAILY_BRIEFING`):
1. Compute "today's window start" in America/Chicago (8:00 AM CT).
2. If `now >= window_start AND now < window_start + 3h` (3-hour grace if Mac was asleep at 8am), check `event_log` for any row `action=daily_briefing_fired` with `created_at >= today_midnight_CT`. If none, **emit a `DAILY_BRIEFING` signal** by inserting a `colony_signals` row.
3. Next tick will pick it up via the standard dispatcher path. (Uniformity: every agent is invoked exactly the same way.)

**Step 1 — `fetchPendingSignals()`:**
- Endpoint: Xano custom endpoint (to be built: `get_pending_colony_signals` in the `intake` group). v0 returns `{items: [...]}` where `processed_at IS NULL`, sorted by `signal_strength DESC, created_at ASC`, limit 50/tick.
- Alternative (faster to ship): Mac Mini uses Metadata API `POST /api:meta/workspace/1/table/38/content/search` with `{search: {processed_at: null}, sort: {created_at: "asc"}, per_page: 50}`. **Tradeoff:** Metadata API requires `XANO_METADATA_TOKEN` with `tenant_center:metadata:api` scope. Current token has that scope = 0 — so this path is blocked unless Teddy issues a new token. **Recommended for v0: build the tiny Xano endpoint.** (One legacy XS endpoint is fine; not new-agent work.)

**Step 2 — `dispatch(sig)`:**
- Look up agent function from `agents/<lowercase-signal-type>.js`.
- If signal_type unknown → throw, caller catches as error, signal marked processed with `signal_unknown_type` error.
- Pass `(signal, ctx)` to the agent's exported `run`. `ctx` has: `xano`, `claude`, `sms`, `log`, `escalate`, `env`.
- Agent returns `{ success: bool, ...resultFields }`.

**Step 3 — `writeResult` + `markProcessed`:**
- Result goes into `event_log` (action = `<signal_type>_result`, metadata = the full result object).
- `colony_signals.processed_at` is set to `now` via `PUT /api:meta/workspace/1/table/38/content/{id}` or via a `mark_signal_processed` Xano endpoint. Same auth tradeoff as Step 1 — recommend a tiny dedicated Xano endpoint.

---

## 5. Signal contract

Per the existing `colony_signals` schema (table id 38), every signal carries:

| Field | Loop's use |
|---|---|
| `signal_type` | Dispatcher key. UPPERCASE_SNAKE. |
| `signal_strength` | Priority; higher = processed earlier within a tick. Use 50 as default, 90 for owner-escalations, 10 for low-priority backfills. |
| `source_colony` | Where it came from (`mac-mini-tn`, `xano-webhook`, `manual-test`, etc.). Free-form. |
| `target_colonies` | Comma-separated colony slugs that should consume. Empty = broadcast = this colony handles it. v0: ignore unless filter needed; future multi-Mac-Mini sharding. |
| `payload` | JSON-encoded string. Agents `JSON.parse(payload)` to get their args. |
| `processed_at` | `NULL` = pending. Loop sets to `now` after dispatch. |
| `created_at` | Tie-breaker for FIFO. |

**Payload conventions per agent:** see §8.

---

## 6. Agent function contract

`colony-loop/agents/<signal-type>.js` exports:

```
export async function run(signal, ctx) {
  // signal: row from colony_signals (id, signal_type, signal_strength, payload (string), ...)
  // ctx: {
  //   xano:     { listJobs, getJob, sendSms, callEndpoint, logEvent, ... }
  //   claude:   { messages({system, user, model, cacheControl}) }
  //   sms:      { toOwner(body), toCustomer(phone, body), toTech(phone, body) }   // wraps xano.sendSms
  //   escalate: async (question, options[]) => 'approve' | 'reject' | string     // SMS Teddy, await reply
  //   log:      (action, metadata) => void                                        // shorthand for xano.logEvent
  //   env:      validated env-var bag
  // }
  // returns: { success: bool, ...arbitraryResultFields }
}
```

**Error handling inside agents:** throw on hard failure. Loop catches, logs `signal_error`, marks processed. Agents should NOT swallow errors.

**Idempotency:** agents should be safe to re-run for the same `signal.id` (operator may re-queue a stuck signal). Use `signal.id` as a dedup key when writing downstream rows. v0 enforces via convention only, not contract.

---

## 7. Time-triggered emission (no external cron)

Single-instance assumption lets us trigger time-based signals from inside the loop without a separate cron.

For `DAILY_BRIEFING`:
- On each tick, compute current `America/Chicago` time. Helper: `Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', ...})` — built into Node, zero deps.
- If `hour >= 8 AND hour < 11` (8-11am CT window) AND no `daily_briefing_fired` row in `event_log` since today's CT midnight → emit a `DAILY_BRIEFING` signal row.
- 3-hour window handles: Mac Mini was asleep, network was out, loop just restarted after 8am.
- After 11am with no fire = skip until tomorrow. (Don't fire a daily briefing at 3pm; that's not a morning briefing.)

For future time-based agents (e.g., `PARTS_RECONCILE` at 5pm), add another check inside `maybeEmitTimeSignals()`. No scheduler library needed; the 60-second tick polls time.

**Dedup query:** Xano endpoint `count_events_since` (or Metadata API search with `created_at >= today_midnight AND action=daily_briefing_fired`). v0 builds a tiny `get_daily_briefing_fired_today` Xano endpoint returning `{fired: bool}`.

---

## 8. First three agent specs

### 8.1 `DAILY_BRIEFING`

**Emitted by:** loop itself, 8-11am CT once/day (§7).
**Payload:** `{}` (no input needed; agent does its own queries).
**What it does:**
1. Pull stale jobs: `jobs.scheduling_status='prediagnosis_pending' AND created_at < (now - 24h)`.
2. Pull late payments: `tech_earnings.status='pending' AND pay_window_close < now` (exact query TBD; depends on financial schema — confirmed by `docs/financial-system-design-2026-05-15.md`).
3. Format a single SMS digest for Teddy:
   ```
   [ant] morning briefing 2026-05-24
   stale prediagnoses: 50 (oldest 3d)
   late payouts: $1,240 across 3 techs
   recent errors (24h): 2  (xs_parse, sms_send)
   reply with COMMAND to act, or DETAIL N for one item.
   ```
4. SMS to +16154855795 via `xano.sendSms`.
5. Returns `{success: true, stale_count, late_payout_total, error_count}`.

**Failure modes:** if either query returns 0, still send (so Teddy knows the loop is alive); if both queries fail, throw → loop logs error, no SMS goes out; Teddy notices missing 8am text.

### 8.2 `PAYROLL_CALCULATOR`

**Emitted by:** on-demand. Producers:
- Teddy texts "payroll Jimmy" → SMS-inbound webhook → Xano emits `PAYROLL_CALCULATOR` signal with `payload={tech_id: 2}`.
- Dashboard "Calculate Payroll" button → Netlify proxy → Xano emits signal.
- For v0 testing: manual `scripts/inject-signal.js --type=PAYROLL_CALCULATOR --payload='{"tech_id":2}'`.

**Payload:** `{tech_id: int, period_start?: ISO, period_end?: ISO}`. Defaults to current pay period.
**What it does:**
1. Fetch the tech's completed jobs in the period (existing Xano endpoint or new one — TBD against `tech_earnings` schema).
2. Apply commission rules (rules location: `docs/financial-system-design-2026-05-15.md` defines them; loop reads from a `commission_rules.json` in the repo so they're versioned with the code).
3. Compute total owed, per-job breakdown, deductions.
4. Write a `payroll_calculation` row (new table? or `tech_earnings` rollup row? — open design Q below).
5. Return `{success: true, tech_id, period, total_owed, jobs_count, breakdown}`.

**Owner approval:** v0 does NOT auto-pay. It produces a calculation; Teddy approves via dashboard or by replying to a follow-up SMS. (Working Rule 3: SMS escalation is for human-judgment, but payroll calc alone is computation — sending is the human-judgment step.)

**Open design Q:** does the loop also store the calculation back into Xano, or just send Teddy a summary SMS with the numbers? Recommended: store in `tech_earnings` (or new `payroll_calculation` table) and SMS Teddy a one-line summary with a link to the dashboard.

### 8.3 `JOB_CREATED` — universal new-job greeting (the missing trigger)

**This is the ignition point for the entire long-term vision.** Today, ~99.9% of jobs (HCP poll, AHS email, ServicePower email — 17,777 rows in `job_event.intake_created`) reach Teddy Tool with **zero customer-side media** because the customer never had a chance to upload anything. Only the ~7 chat-sourced jobs ever ended up with attachments via the `chat_attachments_linked` path. Adding this trigger fixes that gap permanently.

**Emitted by:** every job-creation code path, regardless of source. v0 wires producers on the Xano side:

| Source | XS endpoint | Wiring change |
|---|---|---|
| HCP webhook | `hcp_job_webhook_POST.xs` | Append `db.add colony_signals { data: {signal_type: "JOB_CREATED", ...} }` at end of create branch |
| HCP poller | `hcp_poll_recent_jobs_POST.xs` | Same, per inserted job |
| AHS email intake | `ahs_email_intake_POST.xs` | Same |
| ServicePower email intake | `servicepower_email_intake_POST.xs` | Same |
| Customer chat submit | `create_job_from_chat_POST.xs` | Same |
| Warranty webhook | `warranty_job_intake_POST.xs` | Same |

**SLA: customer text fires within 5 minutes of job creation.** Achievable because the loop tick is 60s and Xano emits the signal synchronously inside the create-job call. Total worst-case latency = upstream emit (instant) + loop tick (≤60s) + Xano `send_sms` (≤2s) = well inside 5 min.

**Payload (set by producer):**
```
{
  job_id: int,
  source: "hcp_webhook" | "hcp_poll" | "ahs_email" | "servicepower" | "web_chat" | "warranty_webhook",
  customer_first_name: string | null,
  customer_phone: string,           // E.164 preferred; producer normalizes
  appliance_type: string | null,
  attachment_count_at_creation: int // 0 for all non-chat sources
}
```

**What the agent does:**

1. **Phone format guard.** If `customer_phone` is bare 10-digit (HCP convention — see `session-2026-05-20-feedback-chain-verification.md` line 71 latent bug), normalize to E.164. If still invalid → log + skip + return `{success: false, reason: 'invalid_phone'}`.

2. **Compose the greeting.** Template:
   ```
   Hi [first_name], this is TN Appliance Exchange! To get your [appliance] repair started,
   please tap here to share a quick photo and description: tnapplianceexchange.net/upload.html?job_id=[job_id]
   ```
   Fallbacks: if `first_name` is null/empty → "Hi there"; if `appliance_type` is null/empty → drop the word, "...to get your repair started...". Always include the job-scoped upload URL.

3. **Send via Xano `send_sms`.** `POST /api:3e_TffpA/send_sms` with `{to, message, context: {source_signal_id, job_id, action: "new_job_greeting"}}`. Loop does NOT call Twilio/Telnyx direct (per §9).

4. **Log + return.** Returns `{success: true, action: 'greeting_sent', job_id, phone}`. The Xano `send_sms` endpoint already writes `sms_sent`/`sms_gated` to event_log — loop doesn't double-log.

**Idempotency.** Re-firing JOB_CREATED for the same job_id would double-text the customer. Guard: agent first checks `event_log` for any prior `action=new_job_greeting_sent` with `metadata.job_id == this.job_id` in the last 24h. If found → skip with `{success: true, action: 'skipped_duplicate'}`. (v0 builds a small `get_greeting_sent_for_job` Xano endpoint.)

**Open issues called out (see §17):**
- The upload URL has no signed-token auth — anyone who guesses a job_id can upload to it. Low-risk for intake (worst case: junk Teddy ignores) but documented.
- HCP-sourced rows store phone as bare 10-digit; producer normalization is the right place to fix the latent bug.
- `tnapplianceexchange.net/upload.html` is currently served via Netlify — verify the domain alias is in place before going live, otherwise SMS links 404.

### 8.4 `CUSTOMER_INTAKE_REPLY` — Claude pre-diagnosis after customer responds

Fires after a customer (a) uploads media via the deep link from §8.3, or (b) texts back a symptom description. This is where the actual Claude-driven pre-diagnosis lives.

**Emitted by:**
- `save_attachment_POST.xs` — when an `attachment_type='intake'` row gets `upload_complete_at` set AND `job_id IS NOT NULL`, emit `CUSTOMER_INTAKE_REPLY` with `payload={job_id, trigger: 'media_uploaded', attachment_id}`.
- Customer-SMS inbound webhook (Twilio/Telnyx → Xano) — when a reply comes in on a customer-direction number for a job in `prediagnosis_pending`, emit `CUSTOMER_INTAKE_REPLY` with `payload={job_id, trigger: 'sms_reply', sms_body}`.

**Payload:**
```
{job_id, trigger: "media_uploaded" | "sms_reply", attachment_id?: int, sms_body?: string}
```

**What the agent does:**
1. Load full job context via `GET /api:3e_TffpA/qc_cockpit_load?job_id=<id>` — pulls `{job, appliance, customer, attachments, existing_tdr}`.
2. **Debounce.** If multiple replies arrive in a short window (customer uploads 3 photos in 60s, each emitting a signal), only run pre-diagnosis once per minute per job. Check `event_log` for `pre_diagnosis_run` within last 60s for this `job_id`; skip if recent. Net effect: latest-state pre-diagnosis runs after the burst settles.
3. **Decide if we have enough.** Need at minimum: one of (`problem_summary` text from any source) OR (≥1 attachment). If neither → SMS customer asking for a description; STOP.
4. **Call Claude.** Sonnet 4.6 default. System prompt loaded from `colony-loop/prompts/pre_diagnosis.md`. User message includes: appliance type, brand if known, customer description, list of attachments with S3 keys + brief auto-captions (TBD: do we feed image data to Claude here? See §17 Q7 expansion below). Response shape: `{likely_failure_mode, parts_needed[], confidence_0_to_1, customer_facing_summary}`.
5. **Confidence routing.**
   - `confidence >= 0.7` AND `existing_tdr is null` → call `create_tdr` (mode=pre_diagnosis) → call `send_qc_diagnosis_to_customer` (`/api:VGkW9mcV/send_qc_diagnosis_to_customer`) → customer receives the signed-token TDR link.
   - `confidence < 0.7` OR existing TDR present → `escalate(question, options)` → SMS Teddy the draft + the customer's reply + buttons "approve / reject / edit", mark signal processed with `awaiting_owner_approval`. Working Rule 3.
6. Returns `{success: true, action: 'tdr_sent'|'awaiting_owner_approval'|'symptom_request_sent', confidence, parts_suggested[], claude_ms}`.

---

## 9. SMS path

Loop SMS = HTTP POST to **existing** Xano endpoint:
```
POST https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms
{ "to": "+16154855795", "message": "...", "context": {"source_signal_id": <id>} }
```

`send_sms_POST.xs` already handles:
- SMS_ENABLED gate (currently true per live check 2026-05-24).
- Owner-bypass for +16154855795 even when gate is off.
- Telnyx-primary, Twilio-fallback provider routing.
- Audit write to `event_log` (`action=sms_sent` or `sms_gated`).

**Why not call Twilio/Telnyx direct from the loop?** Duplicates 28+ existing call sites' gate logic and brand-number routing. Single choke point is safer. The loop is "another consumer of `send_sms`" — same as every Xano-side agent today.

**Subtle:** if `send_sms` fails (Twilio outage, etc.), it returns 4xx/5xx. Loop logs the failure and continues. Customer-facing SMS failures should ALSO emit a `SMS_RETRY` signal for the loop to retry later (out of v0; v0 just logs).

---

## 10. Configuration (env vars)

All config via env vars, loaded once at startup, validated, then frozen.

```
# Required
XANO_INTAKE_BASE=https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA
XANO_CASH_TDR_BASE=https://xbtp-g9bh-ditq.n7e.xano.io/api:VGkW9mcV
XANO_METADATA_BASE=https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1
XANO_METADATA_TOKEN=<bearer>                    # if Metadata path is used; v0 may not need
ANTHROPIC_API_KEY=<sk-ant-...>
OWNER_PHONE_NUMBER=+16154855795

# Optional / tunable
COLONY_NAME=mac-mini-tn                         # written to colony_signals.source_colony
TICK_MS=60000                                   # 60s default
DRY_RUN=false                                   # if true: log intended actions, send no SMS, write no signals
LOG_LEVEL=info                                  # debug|info|warn|error
CLAUDE_MODEL=claude-sonnet-4-6                  # override per env if needed
```

Storage: `~/.colony-loop/.env`, loaded with a 20-line homegrown parser (no `dotenv`). launchd plist `EnvironmentVariables` block is the production source; `.env` is for local dev.

**Validation at boot:** any missing required var → exit non-zero with a clear message. Don't start the loop in a broken state.

---

## 11. Owner escalation (Working Rule 3)

The `ctx.escalate(question, options)` helper.

**v0 (simplest):** fire-and-forget — SMS Teddy with the draft + options, return immediately with `escalated_awaiting_reply`. Agent marks the signal processed with that status. A separate inbound-SMS webhook (Xano-side, **already partially built** per `connections-audit-2026-05-20.md`) processes Teddy's reply and emits a follow-up signal (`OWNER_DECISION_RECEIVED` with reference to original signal). The original agent's "approval path" then runs as a fresh dispatch.

**v0.5 (later):** in-loop wait with a 5-minute polling check of an `owner_replies` table, returning the reply text to the calling agent. Simpler from the agent's perspective but adds state to the loop.

**Recommendation for v0:** ship the fire-and-forget pattern. Less in-flight state, simpler reasoning, matches "automate-or-SMS" without committing to synchronous wait semantics.

---

## 12. Repo layout

Subdirectory in this repo (not a separate repo): keeps loop code under the same git history + Claude Code context. Tested-and-deployed-by-Claude-Code-in-one-place per CLAUDE.md Architecture bullet.

```
tn-appliance-tools/
  colony-loop/
    index.js              # entry point: env load, setInterval, tick orchestrator
    tick.js               # tick() function (algorithm in §4)
    xano.js               # all Xano HTTP calls (fetch-based, no client lib)
    claude.js             # Anthropic HTTP wrapper with prompt-cache support
    time.js               # CT-time helpers (Intl.DateTimeFormat-based)
    config.js             # env-var loading + validation
    sms.js                # thin wrapper around xano.sendSms with toOwner/toCustomer/toTech sugar
    escalate.js           # ctx.escalate helper (v0 fire-and-forget)
    dispatch.js           # signal_type → agent file mapping + invocation
    agents/
      daily_briefing.js
      payroll_calculator.js
      job_created.js              # handles PRE_DIAGNOSIS work per §8.3 decision
    rules/
      commission_rules.json       # versioned commission %s per tech
    scripts/
      inject-signal.js            # manual signal emitter for testing
      smoke-test.js               # one-shot: env loaded, Xano reachable, Claude reachable, send_sms reachable
    README.md             # how to run, how to add a new agent, env var list
    launchd/
      com.tnappliance.colony-loop.plist   # launchd config
```

Total v0 lines of code estimate: **~600 LOC** across the loop, dispatcher, three agents, helpers. Should fit easily in one Claude Code session.

---

## 13. Lifecycle (launchd)

`/Users/tpivacek/Library/LaunchAgents/com.tnappliance.colony-loop.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tnappliance.colony-loop</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/tpivacek/code/tn-appliance-tools/colony-loop/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/tpivacek/code/tn-appliance-tools/colony-loop</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>XANO_INTAKE_BASE</key><string>https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA</string>
    <key>XANO_CASH_TDR_BASE</key><string>https://xbtp-g9bh-ditq.n7e.xano.io/api:VGkW9mcV</string>
    <key>ANTHROPIC_API_KEY</key><string>...</string>
    <key>OWNER_PHONE_NUMBER</key><string>+16154855795</string>
    <key>COLONY_NAME</key><string>mac-mini-tn</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/tpivacek/Library/Logs/colony-loop.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/tpivacek/Library/Logs/colony-loop.err.log</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load: `launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist`.
Restart after code change: `launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`.

---

## 14. Observability

All written to `event_log` (existing table, JSON `metadata` column):

| action | when | metadata |
|---|---|---|
| `loop_started` | on process boot | node_version, colony_name, config_hash |
| `loop_tick` | per tick (only if work done OR every 15min heartbeat) | tick_ms, signals_processed, errors |
| `signal_dispatched` | before agent runs | signal_id, signal_type, agent |
| `signal_processed` | after agent returns success | signal_id, signal_type, agent, ms, result_summary |
| `signal_error` | agent throws | signal_id, signal_type, error, stack |
| `loop_error` | tick-level catch | error, stack |
| `daily_briefing_fired` | DAILY_BRIEFING signal emitted | window_start, fired_at |
| `escalated_to_owner` | escalate() called | original_signal_id, question, options, sms_message |
| `owner_decision_received` | reply processed (Xano-side) | original_signal_id, reply_text, parsed_decision |
| `sms_sent` / `sms_gated` | already written by send_sms — loop doesn't double-log |

**Operator queries:**
- "Is the loop alive?" → `event_log` rows for `action=loop_tick` in last 16 minutes.
- "What happened since yesterday?" → `event_log` filtered by created_at descending, day's worth.
- "Why didn't briefing fire?" → `event_log` for `action=daily_briefing_fired` since CT midnight + `loop_error` rows.

---

## 15. Failure modes & how the loop survives them

| Failure | Loop behavior |
|---|---|
| Xano down | `fetch` throws → tick-level catch → log to stderr (if Xano unreachable for logging, console only) → next tick retries. No state lost; signals stay `processed_at=null`. |
| Anthropic down | Agent throws → loop marks signal processed + logs `signal_error` → no infinite retry. Operator can re-queue (insert duplicate signal) if needed. |
| `send_sms` 500 | Same as Anthropic — agent logs, continues, no retry. Future v0.5 emits `SMS_RETRY` signal. |
| Mac Mini sleeps overnight | launchd resumes process on wake; `maybeEmitTimeSignals()` 3-hour grace window catches 8am briefing if Mac woke by 11am. After 11am: skipped, fire tomorrow. |
| Mac Mini reboots | launchd `KeepAlive=true` + `RunAtLoad=true` → process auto-restarts on boot. |
| Loop crashes hard | launchd `KeepAlive=true` → restarts. Crash itself goes to stderr log file. |
| Bad signal payload | Agent throws on parse → marked processed with error → operator sees in `event_log`. |
| Unknown signal_type | Dispatcher throws → same path as bad payload. |
| Two ticks somehow overlap | `running` guard skips the second. |
| Two Mac Minis running the loop simultaneously | OUT OF SCOPE v0 — single-writer assumption. If we ever go HA, add a `colony_signals` row-claim mechanism (UPDATE … WHERE processed_at IS NULL AND claimed_by IS NULL). |

---

## 16. v0 build plan (estimate: 2-3 Claude Code sessions)

### Phase A — Loop infrastructure + Xano support endpoints

Dependencies on Xano side (small XS endpoints purely to support the loop's Xano client; not new agents):

1. `get_pending_colony_signals` (intake group) — returns up to 50 unprocessed signals.
2. `mark_signal_processed` (intake group) — `{signal_id}` → sets `processed_at=now`. Accepts optional `result_payload`.
3. `emit_colony_signal` (intake group) — `{signal_type, signal_strength, source_colony, target_colonies, payload}` → inserts row.
4. `get_daily_briefing_fired_today` (intake group) — `{fired: bool, last_fired_at}`.
5. `get_greeting_sent_for_job` (intake group) — `{job_id}` → `{sent: bool, last_sent_at}`. Idempotency guard for §8.3.

Loop core code:

6. `colony-loop/index.js` + `tick.js` + `xano.js` + `dispatch.js` (~300 LOC).
7. `colony-loop/agents/daily_briefing.js` (~80 LOC).
8. `colony-loop/agents/payroll_calculator.js` (~120 LOC).
9. `colony-loop/agents/job_created.js` (greeting + upload link; ~100 LOC).
10. `colony-loop/agents/customer_intake_reply.js` (Claude pre-diagnosis; ~180 LOC).
11. `colony-loop/scripts/smoke-test.js` + `inject-signal.js` (~80 LOC).
12. `colony-loop/README.md` + launchd plist.

### Phase B — Producer wiring (the "make every source emit JOB_CREATED" step)

Each existing job-creation XS endpoint gets one new `db.add colony_signals { data: {...} }` line. **These are XS edits to LEGACY endpoints to support the loop's input** — not new agents. (Per Working Rule 5: agents are loop functions; legacy XS edits for plumbing are fine.)

13. `hcp_job_webhook_POST.xs` — emit on create branch.
14. `hcp_poll_recent_jobs_POST.xs` — emit per inserted job in the loop.
15. `ahs_email_intake_POST.xs` — emit on create.
16. `servicepower_email_intake_POST.xs` — emit on create.
17. `create_job_from_chat_POST.xs` — emit on create (chat-sourced jobs ALSO get the greeting, even though they may already have attachments — the greeting confirms intake and reinforces the upload UX).
18. `warranty_job_intake_POST.xs` — emit on create. Note this endpoint currently writes NO event_log row (per `customer-automation-inventory-2026-05-20.md`); fixing that gap can ride along.
19. `save_attachment_POST.xs` — emit `CUSTOMER_INTAKE_REPLY` when `upload_complete_at` is set AND `job_id IS NOT NULL`.

### Phase C — Deploy + verify

20. Mac Mini: `git pull` → `launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist` → verify with `tail -f ~/Library/Logs/colony-loop.out.log` and `event_log` rows for `loop_started`.

21. **Verification of the 5-min SLA:** create a test job via `POST /api:3e_TffpA/create_job_from_chat` with Teddy's phone (+16154855795 → owner-bypass-safe). Time from POST to `sms_sent` event_log row should be **under 5 minutes** in the worst case, under 90 seconds in the typical case.

22. **Verification of the reply loop:** open the resulting upload link, upload a photo, confirm `save_attachment` emits `CUSTOMER_INTAKE_REPLY`, confirm the agent runs Claude and produces a draft TDR or escalation SMS.

23. **Backfill (one-shot decision):** the 50 stale `prediagnosis_pending` jobs from 2026-05-20 — do we fire the greeting at them retroactively? Operator-only decision, see §17 Q8.

---

## 17. Open questions — answered 2026-05-24

1. **Subdirectory vs. separate repo.** → SUBDIRECTORY. `colony-loop/` under this repo.
2. **Xano support endpoints vs. Metadata API.** → SMALL XS ENDPOINTS. Five files in `colony-loop/xano-endpoints/intake/`, pasted into Xano UI on first deploy.
3. **Filename = signal_type convention.** → YES. `agents/<signal_type_lowercased>.js`.
4. **Escalation v0 = fire-and-forget.** → YES. Agent SMSes Teddy, marks signal processed, reply comes back as a separate `OWNER_DECISION_RECEIVED` signal (Xano-side inbound webhook completes that loop in a later phase).
5. **Payroll-calc storage.** → `tech_earnings`. (Caveat: `tech_earnings.commission_earned` is always 0 today per `handoff-2026-05-22-end-of-day.md` open issue #3 — the loop computes commission from job rows + `rules/commission_rules.json` directly, not from the broken column.)
6. **`CUSTOMER_INTAKE_REPLY` model.** → `claude-sonnet-4-6`.
7. **Auto-fire vs. escalate.** → ALWAYS ESCALATE for the first 20 jobs, then auto-fire at confidence ≥ 0.7. Pass actual image data to Claude vision (Sonnet 4.6) via S3-signed view URLs.
8. **Backfill the 50 stale jobs?** → NO. Leave them alone; Teddy handles them manually in Teddy Tool. The loop does not retroactively text past-SLA customers.
9. **Upload URL — signed-token?** → SHIP v0 UNSIGNED. `tnapplianceexchange.net/upload.html?job_id=<id>` is the link. Token hardening deferred.
10. **Phone normalization.** → NORMALIZE TO E.164 IN EACH PRODUCER. Producer-side, not agent-side. (Phase B work — out of Phase A scope.)
11. **Customer-SMS inbound webhook.** → SHIP v0 WITH MEDIA-ONLY INTAKE. Do not block on Telnyx inbound. Customers must use the upload link; text-reply branch deferred.
12. **Quiet hours.** → YES. No texts before 8am or after 9pm CT. Out-of-hours JOB_CREATED greetings get held by the agent and re-emit themselves with a delayed signal_strength so the next-tick-after-8am picks them up. (Implementation: agent re-emits a HOLD signal with a `scheduled_for` timestamp; the dispatcher skips holds until current_time >= scheduled_for. v0 simplification: agent just returns `{success: true, action: 'held_for_quiet_hours'}` and writes a follow-up signal for 8am CT.)

# SMS_ENABLED kill-switch — deployment manifest

**Authored:** 2026-05-11 (Week 1 Day 1)
**Spec:** `docs/system-blueprint-decisions-2026-05-09.md` Decision 6
**Pattern reference:** `docs/sms-enabled-gate-pattern.md`
**Companion git commits:** `e1241ba` (gate-pattern doc) + the commit that lands this manifest + the Netlify function gate

---

## A. Files modified locally (xano-workspace/, NOT in git)

`xano-workspace/` is gitignored by design (`xano-workspace/` line in `.gitignore` — contains hardcoded Twilio creds + Swagger tokens, never commit). Each of the files below was edited locally during this session. **They must be pushed to Xano via `xano workspace push` (see Section B below) — git push does NOT deploy them.**

Wrap pattern per site: gate vars (`$gateNNN_recipient_e164`, `$gateNNN_recipient_bare`, `$gateNNN_is_owner`, `$gateNNN_sms_enabled`, `$gateNNN_should_send`) → conditional with `event_log` gated/bypass logging → original Twilio `api.request` only when `should_send=true`. Variable names use the original call-site line number (e.g., `gate892_*`) as the unique suffix so no name collisions within or across files.

Each wrap also includes a `// ── SMS_ENABLED gate (call_site: <FILE>:<LINE>) ──` comment immediately before the gate vars so it's greppable in the source.

### File-by-file inventory (29 sites total)

| # | File | Sites | Lines (original) | Notes |
|---|------|-------|------------------|-------|
| 1 | `xano-workspace/api/intake/send_sms_POST.xs` | 1 | 42 | **Canonical wrapper.** Covers 5 indirect callers transparently. Init response vars before gate so gated path returns success-shaped `{success:true, twilio_sid:null, twilio_status:0, error:null}`. |
| 2 | `xano-workspace/api/intake/feedback_reply_webhook_POST.xs` | 3 | 70, 99, 146 | 3 distinct paths: positive-feedback review SMS, negative-feedback apology SMS, owner alert SMS (line 146 hardcoded `+16154855795`). |
| 3 | `xano-workspace/api/intake/get_tech_for_zip_POST.xs` | 3 | 37, 72, 183 | All 3 sites notify `$env.OWNER_PHONE_NUMBER` (zone rejected / zone inactive / no active tech). Owner-bypass path always engages. |
| 4 | `xano-workspace/api/intake/handle_negative_followup_POST.xs` | 2 | 76, 92 | Owner alert (hardcoded `+16154855795`) + customer thank-you. |
| 5 | `xano-workspace/api/intake/hcp_job_webhook_POST.xs` | 1 | 791 | Tech arrival/wrap-up SMS. Downstream `tech_sms_sent/failed` event_log moved inside the gate's else branch so it only fires when SMS actually sent. |
| 6 | `xano-workspace/api/intake/jotform_waiver_webhook_POST.xs` | 1 | 134 | Booking SMS to customer after waiver signed. Downstream `var.update $sms_sent` + `booking_sms_sent` event_log + `job_event` write moved inside else branch — `$sms_sent` stays `false` on gated path so the response reflects truth. |
| 7 | `xano-workspace/api/intake/send_feedback_sms_POST.xs` | 1 | 40 | Initial customer feedback request. Downstream `db.patch jobs feedback_sent=true` + `feedback_sms_sent` event_log moved inside else branch so feedback isn't marked sent when gated. |
| 8 | `xano-workspace/api/intake/send_waiver_sms_POST.xs` | 1 | 63 | Waiver SMS. Downstream `db.edit jobs waiver_sent_at` + event_log are OUTSIDE the gate's outer `if ($twilio_configured)` so they fire regardless — that's existing behavior, kept as-is. |
| 9 | `xano-workspace/api/intake/start_tech_assist_session_POST.xs` | 1 | 326 | Tech opening message on `work_status=in_progress`. Downstream status check + `tech_assist_opening_sms_sent/failed` event_log moved inside else branch. |
| 10 | `xano-workspace/api/intake/tech_assist_chat_POST.xs` | 2 | 629, **805** | Escalation-to-owner (629, `$env.OWNER_PHONE_NUMBER`) + customer template-based send (805, `$cust_phone_e164`). Line 805 was NOT in the original spec's 16; verified during inventory check. Downstream `db.query agent_conversation` + `db.add agent_message` + `db.edit agent_conversation` moved inside else for site 805 so customer thread persistence only happens when SMS actually fired. |
| 11 | `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` | **6** | 892, 1187, 1248, 1433, 1462, 1577 | Spec said "sites to verify" — verified 6 distinct outbound paths in the daily-mode handler: broadcast win → notify losers (892), unauthorized reschedule alert (1187), `__ESCALATE_TO_OWNER__` token (1248), owner-reassign-job notify new tech (1433), owner-reassign-job notify old tech (1462), owner-override-availability notify (1577). |
| 12 | `xano-workspace/task/compute_tech_assist_escalation.xs` | 1 | 81 | 2hr stale-session escalation to `$env.OWNER_PHONE_NUMBER`. Existing `$env.TECH_ASSIST_ENABLED` precondition stays at the top of the task; SMS_ENABLED gate is independent. |
| 13 | `xano-workspace/task/daily_tech_summary.xs` | 1 | 224 | Per-tech daily summary SMS. Downstream `daily_summary_log` row + debug.log moved inside else branch so we don't log a "sent" record when gated. Existing `$env.DAILY_SUMMARY_ENABLED` precondition stays separate. |
| 14 | `xano-workspace/task/process_feedback_queue.xs` | 1 | 38 | Customer feedback queue worker. Downstream `db.patch jobs feedback_sent=true` + `feedback_sms_sent_from_queue` event_log moved inside else. Note: `db.del feedback_queue` STILL fires unconditionally outside the gate — gated items are removed from the queue, not retried forever. |
| 15 | `xano-workspace/task/scheduling_queue_worker.xs` | **3** | 310, 575, 667 | Spec said "cron" generically — 3 distinct sites: broadcast fan-out inside foreach (310, pushes `{tech_id, phone, sid, success, gated:true}` to `$notified_records` when gated so the broadcast_attempt row reflects truth), sick-day customer 2-option SMS (575, customer rescheduled — counter increment + `sick_day_customer_notified` event_log moved inside else), sick-day tech confirmation (667). |
| 16 | `netlify/functions/send-teddy-sms.js` | 1 | 19 | Netlify-side. Recipient is hardcoded `+16154855795` (Teddy) so owner-bypass path always engages. Uses `process.env.SMS_ENABLED` (Netlify env, separate from Xano env). Logs gated/bypass events via `console.log` (no event_log access from Netlify); visible via `netlify logs --function send-teddy-sms`. |

**Total wraps: 29** (28 in xano-workspace + 1 in Netlify) — matches inventory.

### New file created locally (xano-workspace/, NOT in git)

| File | Purpose |
|------|---------|
| `xano-workspace/api/admin/sms_enabled_status_GET.xs` | Admin status endpoint. Returns `{sms_enabled, env_var_raw, total_gated_sends_last_24h, total_owner_bypass_sends_last_24h, last_gated_sends[]}`. Requires an `admin` API group in Xano — **if "admin" group doesn't exist, create it via the Xano dashboard before pushing this file**, OR change the `api_group = "admin"` line in the file to `"intake"` if you prefer to host it there. **NOTE: Xano auto-generates random URL slugs for new API groups. The display name in the dashboard is 'admin' but the public URL prefix is `/api:SXH92Wk7`. This is normal Xano behavior — the slug does not match the display name.** |

---

## B. DEPLOY COMMAND

The `xano-workspace/` directory holds local edits. To deploy them to the live Xano server:

```bash
cd /c/Users/jpiva/Documents/code/tn-appliance-tools
xano workspace push --force
```

This pushes ALL changed files in `xano-workspace/` in one bundle. If you want to push file-by-file (slower but easier to debug if one file fails), use `--include` per file:

```bash
xano workspace push --include "api/intake/send_sms_POST.xs" --force
xano workspace push --include "api/intake/feedback_reply_webhook_POST.xs" --force
xano workspace push --include "api/intake/get_tech_for_zip_POST.xs" --force
xano workspace push --include "api/intake/handle_negative_followup_POST.xs" --force
xano workspace push --include "api/intake/hcp_job_webhook_POST.xs" --force
xano workspace push --include "api/intake/jotform_waiver_webhook_POST.xs" --force
xano workspace push --include "api/intake/send_feedback_sms_POST.xs" --force
xano workspace push --include "api/intake/send_waiver_sms_POST.xs" --force
xano workspace push --include "api/intake/start_tech_assist_session_POST.xs" --force
xano workspace push --include "api/intake/tech_assist_chat_POST.xs" --force
xano workspace push --include "api/scheduling/tech_sms_inbound_POST.xs" --force
xano workspace push --include "api/task/compute_tech_assist_escalation.xs" --force
xano workspace push --include "api/task/daily_tech_summary.xs" --force
xano workspace push --include "api/task/process_feedback_queue.xs" --force
xano workspace push --include "api/task/scheduling_queue_worker.xs" --force
xano workspace push --include "api/admin/sms_enabled_status_GET.xs" --force
```

**Before pushing the admin endpoint** (last line above), confirm the `admin` API group exists in Xano. If it doesn't:
- Xano dashboard → API → create new group "admin" (URL slug becomes `/api:admin/`), OR
- Edit `xano-workspace/api/admin/sms_enabled_status_GET.xs` line 12 (`api_group = "admin"`) to `api_group = "intake"` and move the file to `xano-workspace/api/intake/sms_enabled_status_GET.xs` before pushing.

**Netlify side (separate from Xano push):**

The git commit that lands alongside this manifest includes the gate on `netlify/functions/send-teddy-sms.js`. Netlify auto-deploys from the git push, so once the commit is pushed to `main`, the Netlify function picks up the gate automatically on the next deploy (~30-60 seconds).

**Add the env var:**

After pushing, in Xano dashboard → Environment Variables → add `SMS_ENABLED` with value `"false"` (string, not boolean — Xano env vars are strings). The wraps treat anything other than the literal `"true"` as off, so the default behavior on missing-var is correctly off.

In Netlify dashboard → Site settings → Environment variables → add `SMS_ENABLED = "false"` (string).

Adding `SMS_ENABLED="false"` after push is optional for safety since missing-var also defaults to off, but having it explicit makes the future flip-to-`"true"` a one-touch action.

---

## C. PRE-DEPLOY VERIFICATION (review changes before pushing)

Since `xano-workspace/` isn't tracked in git, the standard `git diff` doesn't work. Use these commands to review local changes against the last `xano workspace pull`:

```bash
cd /c/Users/jpiva/Documents/code/tn-appliance-tools
```

**Quick site count — confirms 29 wraps in place:**

```bash
grep -rE "SMS_ENABLED gate \(call_site:" xano-workspace/ netlify/functions/send-teddy-sms.js | wc -l
# Expected: 29
```

**Per-file site count — confirms each file has the expected number of gates:**

```bash
for f in \
  xano-workspace/api/intake/send_sms_POST.xs \
  xano-workspace/api/intake/feedback_reply_webhook_POST.xs \
  xano-workspace/api/intake/get_tech_for_zip_POST.xs \
  xano-workspace/api/intake/handle_negative_followup_POST.xs \
  xano-workspace/api/intake/hcp_job_webhook_POST.xs \
  xano-workspace/api/intake/jotform_waiver_webhook_POST.xs \
  xano-workspace/api/intake/send_feedback_sms_POST.xs \
  xano-workspace/api/intake/send_waiver_sms_POST.xs \
  xano-workspace/api/intake/start_tech_assist_session_POST.xs \
  xano-workspace/api/intake/tech_assist_chat_POST.xs \
  xano-workspace/api/scheduling/tech_sms_inbound_POST.xs \
  xano-workspace/task/compute_tech_assist_escalation.xs \
  xano-workspace/task/daily_tech_summary.xs \
  xano-workspace/task/process_feedback_queue.xs \
  xano-workspace/task/scheduling_queue_worker.xs \
  netlify/functions/send-teddy-sms.js \
; do
  count=$(grep -cE "SMS_ENABLED gate \(call_site:" "$f")
  echo "$count $f"
done
# Expected counts: 1, 3, 3, 2, 1, 1, 1, 1, 1, 2, 6, 1, 1, 1, 3, 1
```

**Brace balance per file — quick parse sanity (XS uses curly braces extensively):**

```bash
for f in $(find xano-workspace -name "*.xs" -newer .gitignore); do
  node -e "
const f = require('fs').readFileSync('$f','utf8');
const o = (f.match(/\\{/g) || []).length;
const c = (f.match(/\\}/g) || []).length;
console.log((o-c === 0 ? '✓' : '✗ DIFF=' + (o-c)) + ' ' + '$f');
"
done
```

**Spot-check one wrap end-to-end:**

```bash
sed -n '40,140p' xano-workspace/api/intake/send_sms_POST.xs
```

You should see the 5 gate vars, the `conditional { if/else }` block, the `sms_owner_bypass` inner conditional, and the original `api.request` inside the else.

---

## D. POST-DEPLOY SMOKE TEST

After `xano workspace push` completes AND `SMS_ENABLED` is set to `"false"` in Xano env vars (or absent — same effect):

### Test 1 — non-owner phone, expect gated

```bash
curl -X POST "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15551234567","message":"SMS_ENABLED gate test - non-owner"}'
```

**Expected response (HTTP 200):**

```json
{
  "success": true,
  "twilio_sid": null,
  "twilio_status": 0,
  "error": null
}
```

**Expected side effects:**

- **Twilio Console** message log: NO new message to `+15551234567`. Check at https://console.twilio.com/us1/monitor/logs/sms.
- **Xano event_log table:** ONE new row with `action = "sms_gated"`, `metadata.recipient = "+15551234567"`, `metadata.gated_reason = "SMS_ENABLED=false, non-owner recipient"`, `metadata.call_site = "send_sms_POST.xs:42"`.

### Test 2 — owner phone (Teddy), expect Twilio fires

```bash
curl -X POST "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms" \
  -H "Content-Type: application/json" \
  -d '{"to":"+16154855795","message":"SMS_ENABLED owner-bypass test - confirm received"}'
```

**Expected response (HTTP 200):**

```json
{
  "success": true,
  "twilio_sid": "SM…",
  "twilio_status": 201,
  "error": null
}
```

**Expected side effects:**

- **Teddy's phone:** real SMS arrives with body "SMS_ENABLED owner-bypass test - confirm received".
- **Twilio Console:** new outbound message to `+16154855795`, status `queued` → `delivered`.
- **Xano event_log table:** ONE new row with `action = "sms_owner_bypass"`, `metadata.recipient = "+16154855795"`, `metadata.call_site = "send_sms_POST.xs:42"`.

### Test 3 — admin status endpoint

```bash
curl "https://xbtp-g9bh-ditq.n7e.xano.io/api:SXH92Wk7/sms_enabled_status"
```

(If the admin API group doesn't exist and you put the file in `intake` instead, use `/api:3e_TffpA/sms_enabled_status`.)

**Expected response (HTTP 200):**

```json
{
  "sms_enabled": false,
  "env_var_raw": "false",
  "window": "last 24 hours",
  "total_gated_sends_last_24h": 1,
  "total_owner_bypass_sends_last_24h": 1,
  "last_gated_sends": [
    {
      "created_at": "<recent timestamp>",
      "recipient": "+15551234567",
      "gated_reason": "SMS_ENABLED=false, non-owner recipient",
      "call_site": "send_sms_POST.xs:42",
      "body_preview": "SMS_ENABLED gate test - non-owner"
    }
  ]
}
```

If counts are off by one or two from what you expect, that's likely from other background SMS attempts (crons, webhooks) firing in parallel — read the `last_gated_sends` array to see which call_sites contributed.

### Pass criteria — all three tests

- Test 1: non-owner blocked + event_log row exists + response shape correct → **gate works on non-owner**.
- Test 2: owner SMS arrives + event_log bypass row exists → **owner bypass works**.
- Test 3: admin endpoint returns correct flag + non-zero counts that match Tests 1 + 2 → **observability works**.

If any test fails, see Rollback (Section E) and debug before flipping `SMS_ENABLED="true"`.

---

## E. ROLLBACK PROCEDURE

If anything misfires after deploy, two options to disable the gate quickly:

### Option E1 — flip to fully enabled (gate becomes transparent)

In Xano dashboard → Environment Variables → set `SMS_ENABLED = "true"`. Effect: every wrap evaluates `$gate_should_send = true || is_owner = true` → original Twilio call fires, no gating, no extra event_log rows. Returns the system to pre-wrap behavior immediately (next request after env var change picks it up — Xano reads env vars per-invocation).

Same for Netlify: dashboard → Site settings → Environment variables → set `SMS_ENABLED = "true"`. Netlify functions may need a redeploy trigger (`netlify deploy --build --prod` or empty git commit + push) to pick up env changes.

### Option E2 — revert the code

Pull the previous workspace state and push it back:

```bash
cd /c/Users/jpiva/Documents/code/tn-appliance-tools
# Stash current local edits (optional — backup before revert)
cp -r xano-workspace /tmp/xano-workspace-backup-$(date +%s)

# Pull current production state (overwrites local with what's on server, but
# server still has the gated version we just pushed — so this only helps if
# you can roll the server back via a Xano snapshot or previous deploy).
xano workspace pull
```

For the Netlify function: `git revert <commit-hash>` then `git push origin main`. Netlify auto-redeploys.

Practically, **Option E1 (flip env var to "true") is faster and safer**. The code-level rollback is only needed if the gate itself has a bug (e.g., the conditional structure broke a file's parser).

---

## F. FOLLOW-UP TASKS (separate from this kill-switch)

The kill-switch is a master off-switch on top of the existing SMS infrastructure. It does NOT fix the underlying security debt below — those are independent follow-ups:

1. **Hardcoded Twilio creds in `xano-workspace/api/intake/send_sms_POST.xs`** (and several other call sites): the `$env.TWILIO_ACCOUNT_SID` and `$env.TWILIO_AUTH_TOKEN` are already in env vars per the 2026-05-08 rotation, BUT the May 4 handoff (`docs/handoff-2026-05-04-phase-0-8-completion.md`) notes that send_sms_POST.xs once had hardcoded creds that may have lingered. **Action: grep `xano-workspace/` for any literal `AC[0-9a-f]{32}` or `Bearer [a-zA-Z0-9_-]{20,}` patterns and rotate / move-to-env if any are found.** Cross-reference `docs/system-blueprint-v1.md` §12 (Security debt) item 6.

2. **The "admin" API group may not exist in Xano yet.** If you push the admin endpoint and the push fails, create the group via the Xano dashboard first, OR change `api_group = "admin"` to `"intake"` in the file and re-push.

3. **The deployment manifest itself doesn't gate inbound SMS** — that's intentional per spec ("Inbound SMS untouched"). Inbound TwiML responses from `tech_sms_inbound_POST.xs` still fire normally even when SMS_ENABLED is off. This means: inbound texts to `+17273508487` will still receive a reply. The OUTBOUND SMS originating elsewhere (broadcasts, sick-day cascades, etc.) is what gates. If for some reason you also want to gate inbound replies, that's a separate change to the TwiML response composition logic.

4. **Phase 8b polish (day-of-week math + no-op prose)** from May 4 handoff is still pending — unrelated to this kill-switch, but adjacent work in the same file (`tech_sms_inbound_POST.xs`). Don't bundle.

5. **Cross-reference `docs/system-blueprint-v1.md` §16 (XanoScript footguns)** before any future SMS-related edits. The footgun list grew during this build from observing parser behavior across 29 sites; no NEW footguns were discovered today, but the existing ones (em-dash, paginated query shape, dynamic-filter-args, etc.) all still apply.

---

## Commit history vs local state — note for future-me

Earlier in this session, commit `e1241ba` ("SMS_ENABLED kill-switch — wrapper + gate pattern doc (milestone 1 of 3)") had a misleading commit message: it claimed the wrapper for `send_sms_POST.xs:42` was IN the commit. **It was not** — `xano-workspace/` is gitignored, so the wrapper edit stayed local. Only `docs/sms-enabled-gate-pattern.md` made it into commit `e1241ba`.

The wrapper IS correctly edited in the local file system — verified by `grep -c "SMS_ENABLED gate" xano-workspace/api/intake/send_sms_POST.xs` returning 1. To deploy, run `xano workspace push` as described in Section B.

Do NOT force-push to fix the misleading commit message; the commit history will read confusingly for that one commit, and that's acceptable noise in exchange for not rewriting pushed history. This manifest serves as the correction.

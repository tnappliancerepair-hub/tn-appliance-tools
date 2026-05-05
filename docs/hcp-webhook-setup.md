# HCP Webhook → Xano Setup

End-to-end glue for getting real warranty job events from Housecall Pro into Xano. The receiving endpoint is built and tested (a SquareTrade dispatch test on 2026-04-29 created customer 116 and job 200 successfully). The remaining work is configuring HCP to deliver real production events to it.

---

## Endpoint details (already live)

- **URL:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook`
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Auth:** none required (endpoint accepts unauthenticated POSTs). If HCP's webhook config requires/recommends a shared secret or signing header, capture what it offers and we'll add a precondition check in a follow-up — don't block setup on this.
- **Source file:** `xano-workspace/api/intake/hcp_job_webhook_POST.xs`

### Events the handler currently consumes

| HCP event | Behavior in Xano |
|---|---|
| `job.appointment_scheduled` | Creates Xano job row if `housecall_pro_job_id` is new; sets `scheduled_start`/`end`, `technician_id`, `service_eta_window`, `scheduling_status="scheduled"`. Creates customer if phone doesn't match. |
| `job.scheduled` | Same as above (treated as alias). |
| `job.appointment_rescheduled` | Same as above. |
| `job.work_status_changed` (`work_status="in_progress"`) | Sends "tech arrival" SMS to assigned tech with tech-ant.html link. Optionally bootstraps Tech Ant Assist live session if `TECH_ASSIST_ENABLED="true"`. |
| `job.work_status_changed` (`work_status="completed"`) | Sets `scheduling_status="completed"`, queues customer feedback SMS, sends "wrap up" SMS to assigned tech. Optionally fires `validate_tdr_completeness` if `TECH_ASSIST_ENABLED="true"`. |
| `customer.created` / `customer.updated` / `customer.deleted` | Logged and ignored (returns success). Subscribe to keep HCP delivery clean; won't create duplicate customer rows. |

Anything else is logged as `hcp_event_unhandled` and ignored (returns success). Safe to over-subscribe.

---

## HCP dashboard setup

> ⚠️ **Plan tier requirement:** Webhooks in HCP are typically only available on **MAX** or **Enterprise** tiers. If you don't see a Webhooks/API section in Settings, check your plan first — that's the most common blocker. As of this writing the lower-tier plans expose Zapier integrations but not raw webhooks.

### Steps

1. Sign in to HCP at https://pro.housecallpro.com/.
2. Go to **Settings** (gear icon, top right or sidebar).
3. Look for one of: **API & Webhooks**, **Webhooks**, or **Integrations → Custom Webhooks**. Exact label varies by plan and HCP UI version.
4. Click **Add webhook** (or "New endpoint" / "Create").
5. Fill in:
   - **URL:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook`
   - **Method:** POST
   - **Content-Type:** application/json
   - **Description / name:** `Xano - intake / scheduling sync` (anything memorable)
6. Subscribe to these event types (check all that apply):
   - `job.appointment_scheduled`
   - `job.appointment_rescheduled`
   - `job.work_status_changed`
   - `customer.created`
   - `customer.updated`
   - `customer.deleted` (optional — handler ignores it but useful for a complete audit trail)
7. **Authentication / signing:** leave blank for now. If HCP requires a secret, copy whatever it gives you (header name + secret value) and ping engineering — we'll add a precondition check on the Xano side before going live with real warranty traffic.
8. **Save**.
9. If HCP shows a **"Send test event"** or **"Test webhook"** button on the saved row, click it before going live. That fires a synthetic event to the endpoint so you can confirm Xano received it (see Verification below) before any real warranty job depends on the wiring.

### What HCP's delivery log looks like

Most HCP plans show a delivery log per webhook with status code per attempt. A healthy run shows `200 OK`. If you see `4xx` or `5xx`, click into the entry — HCP usually shows the request payload + response body, which makes diagnosing parse errors fast.

---

## Verification

### Quick reachability check (instant, no auth needed)

```sh
curl -i https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook
```

Expect `HTTP/1.1 404 Not Found`. That's correct — the endpoint only accepts POST. A 404 here proves DNS, TLS, and Xano routing are all good.

### Did Xano just receive a real production HCP event?

Run from the developer machine (where `~/.xano/credentials.yaml` exists). Pulls the most recent 50 event_log entries and prints just the HCP-related ones:

```sh
curl -sS -H "Authorization: Bearer $(awk '/access_token:/{print $2; exit}' ~/.xano/credentials.yaml)" -H 'Content-Type: application/json' -X POST -d '{"sort":{"created_at":"desc"},"per_page":50}' 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content/search' | grep -oE '"created_at":[0-9]+|"action":"hcp_[^"]*"|"hcp_job_id":"[^"]*"' | paste - - - | head -20
```

What to look for:
- `hcp_webhook_received` — HCP delivered a payload to Xano. ✓
- `hcp_webhook_parsed` — Xano parsed the event_type out of `body.event`. ✓
- `hcp_job_created_from_webhook` — a brand-new Xano job row was created. ✓
- `job_scheduled` — appointment fields written through. ✓
- `hcp_appt_no_matching_job_creating` — appointment event arrived but no matching job, so we created one. (Normal for first-touch dispatches.)
- `hcp_event_unhandled` — event_type wasn't one we handle. Not an error; we'd just decide if we want to extend coverage.
- `hcp_webhook_no_body` — HCP sent an empty body. Misconfigured webhook (Content-Type wrong, or HCP firing pings).

If you'd rather see all fields, drop the `grep` filter and pipe to `jq` (if installed):

```sh
curl -sS -H "Authorization: Bearer $(awk '/access_token:/{print $2; exit}' ~/.xano/credentials.yaml)" -H 'Content-Type: application/json' -X POST -d '{"sort":{"created_at":"desc"},"per_page":50}' 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content/search' | jq '.items[] | select(.action | startswith("hcp_")) | {created_at, action, metadata}' | head -60
```

### Confirm a real job row landed

After a real warranty dispatch fires the webhook, look for the new row:

```sh
curl -sS -H "Authorization: Bearer $(awk '/access_token:/{print $2; exit}' ~/.xano/credentials.yaml)" -H 'Content-Type: application/json' -X POST -d '{"sort":{"created_at":"desc"},"per_page":3}' 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/7/content/search' | jq '.items[] | {id, created_at, customer_id, housecall_pro_job_id, customer_type, warranty_company, scheduling_status}'
```

A real HCP-sourced row will have `housecall_pro_job_id` populated with HCP's actual job id (not `job_create_test_001` — that was the 4/29 test).

---

## Success criteria

End-to-end success on the next real warranty dispatch (post-config):

1. HCP fires the webhook within seconds of the real event happening (visible in HCP's webhook delivery log as `200 OK`).
2. Xano `event_log` shows `hcp_webhook_received` then `hcp_webhook_parsed` with the event_type and the real `hcp_job_id` (not `job_create_test_001`).
3. If the event was `job.appointment_scheduled` (first-touch): Xano `event_log` shows `hcp_job_created_from_webhook` with the new `job_id`, and `hcp_customer_created` if the customer was new.
4. The Xano `jobs` table has a new row where `housecall_pro_job_id` matches HCP's id and `customer_type="warranty"`.
5. The Xano `customer` table has the corresponding row (matched by phone or freshly created).

If any step fails, troubleshooting order:

| Symptom | First check |
|---|---|
| HCP delivery log shows non-200 | Click into the failed delivery, copy HCP's response body. Most likely a parse error in Xano — search Xano `event_log` for `hcp_webhook_no_body` or non-200 entries near the timestamp. |
| HCP delivery log shows 200 but no `hcp_webhook_received` in Xano event_log | Time-zone mismatch or different webhook URL. Re-confirm the URL in HCP matches `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook` exactly. |
| `hcp_webhook_received` fires but `hcp_event_unhandled` follows | HCP is sending an event_type we don't recognize. Read the `metadata.event_type` in `hcp_event_unhandled` — that's the literal string HCP is firing. Add a case for it in the handler if it's relevant. |
| Job row appears but `customer_id=0` and no customer row | HCP payload didn't include `body.job.customer.mobile_number`. Look at the raw payload in `hcp_webhook_received.metadata.raw_payload` to see what HCP actually sent. |
| Webhook never fires, even on test button | HCP plan tier doesn't support webhooks. Check Settings → Plan & Billing for current tier. |

---

## After config: what to do

Once a real warranty job comes through cleanly:
- Tell engineering. We'll flip `TECH_ASSIST_ENABLED="true"` in Xano env vars to start routing real jobs through the Tech Ant Assist pipeline (`start_tech_assist_session`, completion gate, escalation cron).
- We'll also reconcile the recent dev-test data in `customer` and `jobs` tables — likely soft-deleting or marking the test rows so the live data is clean from day one.
- The `meister_task_id` column in the `jobs` schema is currently dead (no code reads or writes it). If MeisterTask is meant to feed Xano too, that's a separate integration to scope.

---

## Cutover sequence — Netlify gateway migration

Adds HMAC-SHA256 signature verification by routing HCP traffic through a Netlify function that does the verification, then forwards to Xano. Sidesteps a Xano platform limitation: `util.get_raw_input` only returns parsed JSON, which prevents byte-faithful HMAC verification from inside XanoScript.

### Architecture after cutover

```
HCP -> https://superlative-naiad-233aa7.netlify.app/.netlify/functions/hcp-webhook-proxy
       (Netlify function: verifies x-housecallpro-signature via HMAC-SHA256)
       -> https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook
          (Xano endpoint: precondition checks _internal_auth body field, then
           runs the existing event-routing handler)
```

### Components

- **Netlify function:** `netlify/functions/hcp-webhook-proxy.js`
- **Xano endpoint:** `xano-workspace/api/intake/hcp_job_webhook_POST.xs` (precondition added at top of stack; existing handler logic unchanged)
- **HCP signing secret:** stored as `HCP_WEBHOOK_SECRET` env var in Netlify (NOT in repo, NOT in Xano).
- **Internal auth shared secret:** generated via `openssl rand -hex 16`, stored as `HCP_INTERNAL_AUTH_SECRET` in BOTH Netlify and Xano (NOT in repo). Forwarded by Netlify as a `_internal_auth` body field on every request to Xano. Xano's precondition checks for matching value.
- **Verification gate:** `SIGNATURE_VERIFICATION_ENABLED` env var on Netlify side. `false` = log diagnostics, forward regardless of signature match. `true` = reject mismatches with 401.

### Sequence (execute in order, verify each step before advancing)

1. **Deploy Netlify function.** Push `hcp-webhook-proxy.js` (committed in repo) → Netlify auto-deploys. Confirm by curling: `curl -i -X POST https://superlative-naiad-233aa7.netlify.app/.netlify/functions/hcp-webhook-proxy -H 'Content-Type: application/json' -d '{"foo":"bar"}'` should return HTTP 200 with the test-ping success body forwarded from Xano.
2. **Push Xano changes.** `xano workspace push -i "api/intake/hcp_job_webhook_POST.xs" --force`. The new `_internal_auth` precondition exists in code but is **skipped** because `$env.HCP_INTERNAL_AUTH_SECRET` isn't set yet. Existing direct-to-Xano traffic keeps working unchanged. Confirm via the same curl above hitting the direct Xano URL.
3. **Set Netlify env vars** (Site settings → Build & deploy → Environment): `HCP_WEBHOOK_SECRET`, `HCP_INTERNAL_AUTH_SECRET`, `SIGNATURE_VERIFICATION_ENABLED=false`, optional `XANO_HCP_WEBHOOK_URL`. Trigger a Netlify redeploy if needed for env vars to take effect.
4. **Test Netlify function manually.** Run `curl -i -X POST https://superlative-naiad-233aa7.netlify.app/.netlify/functions/hcp-webhook-proxy -H 'Content-Type: application/json' -d '{"event":"customer.created","id":"evt_cutover_test","created_at":"2026-05-05T22:00:00Z","data":{"customer":{"id":"cus_cutover_test"}}}'`. Expect HTTP 200 with `{"status":"success","message":"Customer event ignored"}` from Xano. Check Netlify function logs for the `[hcp-webhook-proxy] DIAGNOSTIC mode: received=(none) computed=<hex> match=false` line.
5. **Update HCP webhook URL.** In HCP dashboard → Settings → Webhooks → edit the existing webhook → change URL from `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook` to `https://superlative-naiad-233aa7.netlify.app/.netlify/functions/hcp-webhook-proxy`. Save. All 16 event subscriptions stay the same. HCP signing secret stays the same.
6. **Verify next event flows through.** Wait for the next real HCP event (or fire HCP's "Test webhook" button). Check three places:
   - HCP delivery log shows HTTP 200
   - Netlify function logs show `[hcp-webhook-proxy] DIAGNOSTIC mode: received=<hex> computed=<hex> match=true|false`
   - Xano `event_log` shows `hcp_webhook_received` and `hcp_webhook_raw_input_capture` entries with the expected event_type
7. **Activate the Xano-side internal auth precondition.** Add `HCP_INTERNAL_AUTH_SECRET` to the env block in `xano-workspace/workspace/jamess_workspace.xs`, value = same 32-char hex stored in Netlify. Push with `xano workspace push --env -i "workspace/jamess_workspace.xs" --force`. **From this moment, direct-to-Xano POSTs without the body field get rejected with 401.** Netlify-routed traffic continues to work because Netlify injects the field.
8. **Verify lockout of direct-to-Xano POSTs.** Run `curl -i -X POST https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook -H 'Content-Type: application/json' -d '{"foo":"bar"}'`. Expect `{"success":false,"error":"unauthorized"}`. Run `curl` against the Netlify URL with the same body. Expect HTTP 200 with the test-ping success body. Confirms gateway-only access.
9. **Activate strict signature verification.** After 10+ real HCP events have been observed in Netlify logs with `match=true`, set `SIGNATURE_VERIFICATION_ENABLED=true` in Netlify dashboard env vars. Trigger a Netlify redeploy. From this moment, signature mismatches return 401 from Netlify and never reach Xano.

### Verification commands (paste-ready)

After step 6, this command pulls recent HCP-related event_log entries to confirm traffic is flowing through correctly:

```sh
curl -sS -H "Authorization: Bearer $(awk '/access_token:/{print $2; exit}' ~/.xano/credentials.yaml)" -H 'Content-Type: application/json' -X POST -d '{"sort":{"created_at":"desc"},"per_page":50}' 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content/search' | grep -oE '"created_at":[0-9]+|"action":"hcp_[^"]*"|"hcp_job_id":"[^"]*"' | paste - - - | head -20
```

After step 7, this command confirms direct-to-Xano POSTs get rejected:

```sh
curl -i -X POST https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook \
  -H 'Content-Type: application/json' \
  -d '{"event":"customer.created","data":{}}'
# Expect: HTTP 200 with body {"success":false,"error":"unauthorized"}
```

### Rollback

At any step, if something breaks, rollback options in order of severity:

- **Step 9 fails** (real signatures don't match): set `SIGNATURE_VERIFICATION_ENABLED=false` in Netlify. Reverts to log-only diagnostic mode. Investigate signature shape from logs.
- **Step 7 fails** (legitimate Netlify traffic gets 401): empty out `HCP_INTERNAL_AUTH_SECRET` in Xano workspace env, push. Precondition reverts to skip mode. Investigate why Netlify isn't injecting the field.
- **Step 5 fails** (HCP delivery log shows non-200): revert HCP webhook URL to the direct Xano URL. Falls back to pre-Netlify behavior (no signature verification, but functional). Diagnose Netlify side independently.
- **Step 2 fails** (Xano push compile error): revert the `.xs` file via `git checkout HEAD -- xano-workspace/api/intake/hcp_job_webhook_POST.xs` and re-push.
- **Step 1 fails** (Netlify function 5xx): revert the netlify-function commit; HCP keeps hitting direct Xano URL (which still works).

The deploy is structured so each step is independently reversible without affecting the previously verified steps.

### Diagnostic log retention

The `[hcp-webhook-proxy] DIAGNOSTIC mode: received=... computed=... match=...` lines in Netlify function logs are the canonical record of "what shape are HCP signatures actually arriving in." After step 9 ships and 30 days of clean strict-mode operation pass with no false rejections, the diagnostic log line can be reduced to error-only logging in a follow-up commit. Until then, keep the verbose log — it's the only record of any signature-shape regressions.

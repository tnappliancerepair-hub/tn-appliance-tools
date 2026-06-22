# ☁️ Railway cold-standby for the colony loop (storm / Mac-death insurance)

**Goal:** a fully-configured copy of the loop on Railway, kept **paused**, that you
can bring up in ~1 minute if the Mac Mini dies — so background automations
(greetings, briefings, auto-route, warranty digest) don't stay dark for hours.

> **What already survives a Mac death without this:** phones (Vapi), the website,
> intake, payments, customer text replies, the office board, Schedule Check, the
> Frontdoor queue, and every Netlify cron — all cloud, zero Mac dependency. And
> `colony-watchdog` (Netlify, every 5 min) **texts you** if the loop goes quiet.
> This standby only covers the background **colony loop**.

## ⚠️ Why COLD standby, not hot
Two loops must **never** run live at the same time:
- The Mac runs `LOOP_STORE=local` and **retires shared Xano signals as it drains
  them** — a second loop on the Xano queue would steal/clobber that work.
- So even a "dry-run" standby running *alongside* the live Mac is unsafe.

Therefore: Railway stays **paused (0 replicas)** while the Mac is alive. You only
scale it up when the Mac is **confirmed down**. Only ever ONE loop live at a time.

## Setup (one time, ~15 min — your dashboard, your secrets)
1. **railway.app → New Project → Deploy from GitHub repo** → `tnappliancerepair-hub/tn-appliance-tools`.
2. Service **Settings → Root Directory:** `colony-loop`  (start command + restart
   policy come from `colony-loop/railway.json` automatically).
3. **Variables tab** — paste the VALUES from your Mac's `colony-loop/.env` for the
   names below. (Names only here; never paste secret values into chat.)

   **Required to boot:**
   ```
   XANO_INTAKE_BASE        XANO_CASH_TDR_BASE
   ANTHROPIC_API_KEY       OWNER_PHONE_NUMBER
   ```
   **Needed to actually act:**
   ```
   VAPI_PRIVATE_KEY        XANO_METADATA_TOKEN     DANIELLE_PHONE_NUMBER
   PUBLIC_SITE_BASE        NETLIFY_FUNCTIONS_BASE  CLAUDE_MODEL
   ```
   **Behavior flags — set these EXACTLY for a safe standby:**
   ```
   COLONY_NAME = cloud-standby     # so logs/SMS show which loop is talking
   DRY_RUN     = true              # standby boots muted (no SMS/calls) until you flip it
   ```
   **Do NOT set** `LOOP_STORE` on Railway (leave it on the Xano queue — Railway has
   no persistent local SQLite). Skip Mac-only vars: `XANO_CLI_BIN`,
   `DEPLOY_XS_BRANCH`, `ANT_BACKUP_DIR`, `BACKUP_S3_*`.

4. **Deploy once to verify, then PAUSE it.** Watch logs for `loop_tick` every ~60s
   (it's in `DRY_RUN`, so it only logs — no real SMS/calls, and it won't fight the
   Mac because dry-run + you'll pause it immediately). Then **Settings → set
   replicas to 0** (or pause the service). It now sits ready and idle.

## 🔁 Failover — when the Mac is confirmed DOWN (you got the watchdog text)
1. Make sure the **Mac loop is actually dead** (it is, if the storm killed power).
   If the Mac is merely flaky, fix the Mac instead — don't run both.
2. Railway → set the standby's `DRY_RUN = false`, then **replicas to 1**.
3. Within ~60s it's the live loop: briefings, greetings, auto-route resume from the
   cloud. Calls obey the same anti-spam cap.

## ↩️ Fail-back — when the Mac is healthy again
1. Railway → set `DRY_RUN = true` and **replicas to 0** (pause) FIRST.
2. Then bring the Mac loop back: `launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`.
3. Confirm only one is live: `get_loop_health` green + heartbeat fresh.

**Rule of thumb:** exactly one loop with `DRY_RUN=false` at any moment. Pause one
before you un-pause the other.

# ☁️ Move the colony loop off the Mac (kill the single point of failure)

Goal: run the colony loop on a managed cloud host so a Mac power/hardware/network
death no longer pauses background automation (greetings, briefings, route-fill,
warranty digest). After this, the Mac is **just** your XS-deploy box.

The loop is already cloud-ready: `config.js` reads from the host's env vars when
there's no `.env` file, and it boots from `node index.js`.

## What survives a Mac death even WITHOUT this (for context)
Phone (Vapi + proxy), office board, scheduling, search, customer portal — all on
Netlify + Xano, zero Mac dependency. This migration is specifically to keep the
**background colony loop** alive too.

---

## Recommended host: Railway (simplest for a Node worker). Render works the same way.

### Step 1 — create the service
1. Go to railway.app → New Project → **Deploy from GitHub repo** → pick
   `tnappliancerepair-hub/tn-appliance-tools`.
2. In the service **Settings**:
   - **Root Directory:** `colony-loop`
   - **Start Command:** `node index.js` (or leave blank — the `Procfile` sets it)
   - It auto-detects Node (engines: >=20).

### Step 2 — set the environment variables (the important part)
Copy the **values** from your Mac's `colony-loop/.env` into Railway's
**Variables** tab. Required to boot (loop exits without these):

```
XANO_INTAKE_BASE      = https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA
XANO_CASH_TDR_BASE    = https://xbtp-g9bh-ditq.n7e.xano.io/api:VGkW9mcV
ANTHROPIC_API_KEY     = (copy from Mac .env)
OWNER_PHONE_NUMBER    = +16154855795
```

Then the rest (copy from Mac .env / set as shown):

```
# identity — IMPORTANT: different name so you can tell which loop is running
COLONY_NAME           = cloud-tn

# secrets (copy values from Mac colony-loop/.env)
VAPI_PRIVATE_KEY      = (copy)            # outbound calls
XANO_METADATA_TOKEN   = (copy)            # metadata reads/writes
HCP_API_KEY           = (copy, if set)
EMAIL_SHARED_SECRET   = (copy, if set)

# routing / phones
DANIELLE_PHONE_NUMBER = +16154850713
PUBLIC_SITE_BASE      = https://tnapplianceexchange.net
NETLIFY_FUNCTIONS_BASE= https://tnapplianceexchange.net/.netlify/functions

# behavior — match what the Mac runs
CLAUDE_MODEL          = (copy from Mac, e.g. claude-sonnet-4-6)
TICK_MS               = 60000
AUTO_FIRE_CONFIDENCE  = 0.7
ROUTE_FILL_LIVE       = (copy — true/false as on Mac)
# any *_ENABLED flags + ANT_DAILY_SPEND_CAP_USD etc. — copy whatever the Mac has

# START SAFE: dry-run first so it can't double-send while the Mac is still live
DRY_RUN               = true
```

> Skip these (Mac-only, harmless if absent): `XANO_CLI_BIN`, `DEPLOY_XS_BRANCH`,
> `ANT_BACKUP_DIR`, `BACKUP_S3_*`. `deploy_xs` + `xano-backup` agents just no-op
> in the cloud — XS deploys stay manual on the Mac (unchanged), and the nightly
> backup can keep running on the Mac or be pointed at S3 later.

### Step 3 — deploy + verify in DRY-RUN (no double-send)
1. Deploy. Watch the logs — you should see `loop_tick` lines every ~60s.
2. Because `DRY_RUN=true`, it dispatches to logs only — it will NOT send real
   SMS/calls, so it's safe to run alongside the Mac for this check.
3. Confirm it's reaching Xano: the logs show signals being processed.

### Step 4 — cut over (make cloud the one true loop)
Do these close together so only ONE loop is live:
1. **Stop the Mac loop:**
   `launchctl unload ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist`
   (re-load later with `launchctl load ...` only if you ever roll back)
2. **Flip the cloud to live:** set `DRY_RUN=false` in Railway → it redeploys.
3. **Verify:** `curl ".../get_loop_health"` → heartbeat fresh + green. The
   heartbeat's `COLONY_NAME` will read `cloud-tn` so you KNOW the cloud is the
   one running. Send a test (`scripts/inject-signal.js` or just watch the next
   scheduled briefing fire).

### Rollback (if anything's off)
Set cloud `DRY_RUN=true` (or pause the Railway service), then
`launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist` to
bring the Mac loop back. Signals queue in Xano and process when a loop is live,
so nothing is lost in the gap.

---

## Why this kills the SPOF
- Railway/Render run the worker on redundant infra with auto-restart — no single
  physical machine. A host blip self-heals; you're not driving to a Mac.
- The existing cloud watchdog still SMS-alerts on a stale heartbeat, so you keep
  detection on top of the new resilience.
- Cost: ~$5–7/mo.

## After cutover
- Mac = XS deploys only (`xano workspace push`) + optional nightly backup.
- Update `COLONY_NAME` everywhere you reason about "which loop" — cloud is canon.

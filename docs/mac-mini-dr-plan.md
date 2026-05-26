# Mac Mini Disaster Recovery Plan

**Status**: required ops doc. Until a backup Mac is provisioned, this Mac Mini is a SPOF for the entire Ant platform — if it dies, no SMS goes out, no signals get dispatched, no colony agents run, no architect builds happen.

This doc covers:
- What goes wrong when the Mac Mini fails
- How the healthcheck detects it
- Step-by-step recovery on a replacement Mac
- Full env-var inventory needed
- Verification checklist after recovery

---

## Failure modes the Mac Mini can experience

| Symptom | Likely cause | Healthcheck behavior |
|---|---|---|
| Loop process crashed but launchd not restarting it | bug in `index.js`, OOM, plist misconfigured | Healthcheck pages within 10-15 min (no heartbeat in event_log) |
| Mac Mini powered off | Power outage, somebody pulled the cord | Healthcheck pages within 10-15 min |
| Mac Mini lost network | ISP outage, router crashed | Healthcheck on the Mac itself can't reach Xano → fails silently. **The remote /alerting from elsewhere is the only safety net.** Worth adding a second healthcheck from a Netlify scheduled function (future build). |
| Disk full | Logs grew unbounded | Loop crashes when it can't write logs. Healthcheck pages. |
| OS update reboot | macOS Sonoma auto-updates if not configured otherwise | Loop comes back when launchd restarts at login. Healthcheck pages during the gap. |
| Mac Mini hardware failure | SSD, GPU, fan, board | Healthcheck pages within 10-15 min. **Manual intervention needed.** |

---

## How the healthcheck works

- `colony-loop/scripts/healthcheck.js` runs every 10 minutes via launchd (`com.tnappliance.colony-healthcheck.plist`)
- It queries Xano `event_log` for the most recent `colony_loop_heartbeat` row
- If the latest heartbeat is older than `STALE_MINUTES` (default 10), it pages Teddy via SMS to `OWNER_PHONE_NUMBER`
- A `COOLDOWN_MINUTES` window (default 30) prevents alert storms — only one page per cooldown
- State is persisted at `~/.colony-healthcheck-state.json`
- Tick.js writes a heartbeat to Xano `event_log` every `HEARTBEAT_MS` window (currently 5 minutes)

**Critical limitation**: if the Mac Mini itself is offline, the healthcheck on the Mac Mini can't run either. The healthcheck protects against in-process failures (crash, hang, stuck loop) — NOT against full-machine outages. For full-machine outage detection, add a sibling healthcheck on Netlify (cloud) that hits the same event_log query.

---

## Recovery procedure (when healthcheck pages or you notice silence)

### Step 1 — Diagnose remotely first

Before touching the Mac Mini, check Xano:

```bash
# From any machine with Xano CLI authenticated:
curl -s -H "Authorization: Bearer <metadata-token>" \
  "https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content/search" \
  -X POST -H "Content-Type: application/json" \
  -d '{"search":{"action":"colony_loop_heartbeat"},"per_page":5}' \
  | jq '.items[] | {id, created_at}'
```

If the latest heartbeat is, say, an hour old, the Mac Mini is the issue. If recent, the healthcheck itself may be the issue.

### Step 2 — Try the easy fix first

Physically at the Mac Mini OR via SSH (`ssh tpivacek@<mac-mini-ip>`):

```bash
# Is the loop process running?
pgrep -lf "colony-loop/index.js"

# Is launchd managing it?
launchctl list | grep colony

# Kick the loop manually
launchctl kickstart -k "gui/$(id -u)/com.tnappliance.colony-loop"
sleep 5
pgrep -lf "colony-loop/index.js"

# Watch the next tick
tail -f ~/Library/Logs/colony-loop.out.log
```

If the loop comes back and the next tick fires within 60 seconds — done. Move to step 5 (verify).

### Step 3 — Full Mac Mini recovery (if step 2 fails)

If the loop won't start, or the Mac itself is dead, provision a replacement Mac. Any modern macOS will work (M1+ recommended for Anthropic API throughput).

```bash
# 1. Install dependencies
xcode-select --install            # git, etc.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@20 git
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 2. Install Xano CLI
npm install -g @xano/cli@1
xano profile add  # follow prompts to authenticate

# 3. Install Netlify CLI (for env-var inspection if needed)
npm install -g netlify-cli
netlify login

# 4. Clone the repo
mkdir -p ~/tn-appliance-tools
cd ~
git clone https://github.com/tnappliancerepair-hub/tn-appliance-tools.git
cd tn-appliance-tools

# 5. Restore the colony-loop .env (see "Env-var inventory" section below)
nano colony-loop/.env

# 6. Smoke test the loop locally before hooking up launchd
cd colony-loop
DRY_RUN=true node index.js
# Watch stdout for "loop_started" + at least one "loop_tick" event. Ctrl-C after verifying.

# 7. Install launchd services
mkdir -p ~/Library/LaunchAgents
cp launchd/com.tnappliance.colony-loop.plist ~/Library/LaunchAgents/
cp launchd/com.tnappliance.colony-healthcheck.plist ~/Library/LaunchAgents/

launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist
launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-healthcheck.plist

# 8. Verify both are running
launchctl list | grep colony
pgrep -lf colony-loop
```

### Step 4 — DNS / network preconditions

The recovered Mac needs unrestricted outbound HTTPS to:
- `https://xbtp-g9bh-ditq.n7e.xano.io` (Xano)
- `https://api.anthropic.com` (Claude)
- `https://api.telnyx.com` (SMS — outbound via Xano `send_sms`, indirect)
- `https://github.com` (architect git push)
- `https://api.housecallpro.com` (only needed for migration run, not steady state)
- `https://maps.googleapis.com` (drive-time function on Netlify — Mac doesn't need direct, but Netlify functions do)

If the Mac is behind a corporate firewall or VPN, these MUST be allow-listed.

### Step 5 — Verify everything is working

After launchd is loaded, run these in order:

```bash
# A. Loop is producing local log output
tail -20 ~/Library/Logs/colony-loop.out.log
# Expect: loop_started + loop_tick within 60s

# B. Loop is writing to Xano event_log
curl -s -X POST "https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content/search" \
  -H "Authorization: Bearer <metadata-token>" -H "Content-Type: application/json" \
  -d '{"search":{"action":"colony_loop_heartbeat"},"per_page":3}' \
  | jq '.items[0].created_at'
# Expect: timestamp from the last 5 minutes

# C. Healthcheck runs without alarming
node ~/tn-appliance-tools/colony-loop/scripts/healthcheck.js
# Expect: "loop is healthy"

# D. Inject a test signal and watch it dispatch
cd ~/tn-appliance-tools/colony-loop
node scripts/inject-signal.js --type=JOB_CREATED --payload='{"job_id":1,"source":"dr_smoke"}'
# Then watch the next tick in colony-loop.out.log for "signal_dispatched"

# E. Confirm git is clean and origin is reachable
git fetch --dry-run origin main
# Expect: silence (or "Already up to date")
```

If A through E all pass → recovery is complete.

---

## Env-var inventory (everything the colony-loop needs)

These live in `colony-loop/.env` and are mirrored in `colony-loop/launchd/com.tnappliance.colony-loop.plist`. **Keep these two files in sync** when adding new vars.

| Variable | Required? | Source / how to get | Example |
|---|---|---|---|
| `XANO_INTAKE_BASE` | ✅ | Xano workspace settings (api group `3e_TffpA`) | `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA` |
| `XANO_CASH_TDR_BASE` | ✅ | Xano workspace settings (api group `VGkW9mcV`) | `https://xbtp-g9bh-ditq.n7e.xano.io/api:VGkW9mcV` |
| `ANTHROPIC_API_KEY` | ✅ | console.anthropic.com → API Keys → create | `sk-ant-...` |
| `OWNER_PHONE_NUMBER` | ✅ | Teddy's mobile in E.164 | `+16154855795` |
| `DANIELLE_PHONE_NUMBER` | optional | Warranty handler phone in E.164 | `+16154850713` |
| `COLONY_NAME` | ✅ | Free-form colony identifier (lets future multi-colony deploys distinguish) | `mac-mini-tn` |
| `TICK_MS` | optional | Loop tick interval. Default 60000 (60s). | `60000` |
| `DRY_RUN` | ✅ | `true` = no SMS sent (test mode), `false` = real SMS. **Default to false in production.** | `false` |
| `LOG_LEVEL` | optional | `info`, `debug`, etc. | `info` |
| `CLAUDE_MODEL` | ✅ | Anthropic model id | `claude-sonnet-4-6` |
| `AUTO_FIRE_CONFIDENCE` | optional | Threshold for auto-firing customer SMS | `0.7` |
| `ALWAYS_ESCALATE_FIRST_N` | optional | First N intakes always go to Teddy for review | `20` |
| `PUBLIC_SITE_BASE` | ✅ | Customer-facing site root | `https://tnapplianceexchange.net` |
| `NETLIFY_FUNCTIONS_BASE` | ✅ | Netlify functions URL | `https://superlative-naiad-233aa7.netlify.app/.netlify/functions` |
| `HCP_API_KEY` | optional (required for migration only) | Housecall Pro API console | `Token <hash>` (just the token, no "Token " prefix) |
| `STALE_MINUTES` | optional (healthcheck) | Page if no heartbeat in this many minutes | `10` |
| `COOLDOWN_MINUTES` | optional (healthcheck) | Don't repage within this window | `30` |

**How to back these up safely**: copy `colony-loop/.env` to a 1Password / Bitwarden secure note. Do NOT commit it to git (already covered by `.gitignore`). Re-encrypt yearly.

---

## launchd cron setup for healthcheck

```bash
# Load
cp ~/tn-appliance-tools/colony-loop/launchd/com.tnappliance.colony-healthcheck.plist \
   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-healthcheck.plist

# Verify scheduled (should run every 600s = 10 min)
launchctl list | grep healthcheck

# Force run now
launchctl kickstart -k "gui/$(id -u)/com.tnappliance.colony-healthcheck"
tail -20 ~/Library/Logs/colony-healthcheck.out.log

# Unload (if you ever need to disable)
launchctl unload ~/Library/LaunchAgents/com.tnappliance.colony-healthcheck.plist
```

---

## Periodic rehearsal

Once a quarter, run a DR rehearsal:

1. Note the current heartbeat timestamp.
2. `launchctl unload ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist` (simulates a loop death).
3. Wait 15 min.
4. Verify Teddy received the healthcheck alert SMS.
5. `launchctl load ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist` (recover).
6. Verify next heartbeat appears in event_log within 5 minutes.
7. Run `node colony-loop/scripts/healthcheck.js` and confirm "loop is healthy".

If any step fails — fix it now, not in the middle of a real outage.

---

## Future hardening (not blocking)

- **Cloud-side healthcheck on Netlify**: a scheduled Netlify function that hits the same event_log query independently of the Mac. Detects full-Mac outages.
- **Hourly Xano backup to S3**: `colony_signals` + `jobs` + `event_log` + `customer` + `technician_decision_report` dumped via Metadata API, stored in `tn-appliance-media-...` bucket. 30-day retention.
- **Second Mac Mini as warm spare**: identical setup, but launchd plist disabled by default. Flip the disable flag if primary dies — `launchctl load` and the loop picks up.
- **Migrate to a real PaaS** (Fly.io, Render, Railway) for the colony loop: removes Mac Mini SPOF entirely. Cost: ~$25/mo. Trade-off: no local file access, but the loop doesn't currently need that.

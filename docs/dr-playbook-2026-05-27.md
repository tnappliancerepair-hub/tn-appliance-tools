# Mac Mini DR Playbook — 2026-05-27

Operator-readable. Keep this current.

## 0. First check (every monitoring page)

- **health-check.html** → loop alive?
- **office-pulse.html** → activity in last 5 min?
- `launchctl print gui/$UID/com.tnappliance.colony-loop` → state=running?

## 1. Loop process died

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.tnappliance.colony-loop.plist
# OR force restart:
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```

## 2. Mac Mini hardware death

1. New Mac Mini (or borrowed Mac).
2. Install: Node 20+, git, the xano CLI (`brew install xano-io/xano/xano`).
3. `git clone https://github.com/tnappliancerepair-hub/tn-appliance-tools ~/tn-appliance-tools`
4. Copy `.env` from password manager → `~/tn-appliance-tools/colony-loop/.env`
5. Install all 5 launchd plists:
   ```
   for f in ~/tn-appliance-tools/colony-loop/launchd/*.plist; do
     cp $f ~/Library/LaunchAgents/
     launchctl bootstrap gui/$UID ~/Library/LaunchAgents/$(basename $f)
   done
   ```
6. Verify health-check.html shows green within 10 min.

## 3. Xano data loss

1. Pull latest backup: `cp -R ~/backups/xano-YYYY-MM-DD ~/restore-stage`
2. For each table file: review row counts vs `_manifest.json`
3. Use Xano UI to bulk-import the JSON (no script for this yet — operator action)
4. Re-deploy any deleted XS endpoints from git: `xano workspace push --force`

## 4. SMS gateway (Telnyx) down

- All SMS-emitting agents will start logging `loop_error` with Telnyx 5xx codes.
- Check Telnyx status page.
- DRY_RUN=true in colony-loop/.env will stop further sends until Telnyx recovers (operator manually flips).
- Customer-side: nothing breaks — they just don't get SMS notifications until restored.

## Verification after recovery

- health-check.html → GREEN
- office-pulse → activity within last 5 min
- Inject test: `node colony-loop/scripts/inject-signal.js --type=DAILY_BRIEFING --payload='{"test":true}'` and confirm Teddy gets SMS within 90s.

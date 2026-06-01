# Architecture Recovery Runbook

If the Phase 1 architectural refactor (state machine + intake consolidation + registry dispatch) goes sideways, here's how to roll back.

## The 3 safety nets

### Layer 1: Git tag — the moment-in-time snapshot
```
git tag                                    # list all tags
git checkout pre-phase1-refactor-2026-06-01  # go back to exact baseline
```
- Created: 2026-06-01 ~17:00 CT
- Includes: every file in the repo BEFORE state machine work began
- Use case: "the refactor is fundamentally broken, take me back to start"

### Layer 2: Xano workspace snapshot (in this repo)
The `api/`, `function/`, `task/`, `workspace/`, `service/`, `addon/`, `agent/`,
`workflow/`, and `event/` directories at the safety-net commit
contain the exact XS definitions of every Xano endpoint as of pre-refactor.
- Use case: "endpoint X is broken on Xano — what was it before?"
- Recovery: read the file at the tag commit and paste it into Xano UI, OR
  `xano workspace push -i "path/to/endpoint*" --force` from a clean checkout.

### Layer 3: Daily Xano data backup
- Script: `colony-loop/scripts/xano-backup.js`
- Schedule: 3:15 AM CT via launchd (`com.tnappliance.xano-backup.plist`)
- Output: `~/backups/xano-YYYY-MM-DD/<table>.json` per table
- Retention: indefinite until disk fills (manual cleanup)
- Use case: "we lost all our customer rows somehow — restore yesterday"
- Recovery: read the JSON, POST rows to `db.add` via Metadata API or XS bulk-insert endpoint.

## How to revert a single change

If one specific endpoint refactor breaks production:

1. Find the commit that changed it:
   `git log --oneline -- api/intake/<name>.xs`
2. Revert just that commit:
   `git revert <commit-sha>` and push.
3. Push the reverted XS back to Xano:
   `xano workspace push -i "**/<name>*" --force`
4. Verify in Xano UI.

## How to revert the whole Phase 1 refactor

If everything's on fire:

```
# Hard reset main to the safety net
git reset --hard pre-phase1-refactor-2026-06-01
git push origin main --force-with-lease  # use --force-with-lease, not --force

# Roll back the entire Xano workspace to baseline
xano workspace push --force  # pushes every file in the repo back to Xano
```

After both: the system is in the exact state it was at 17:00 CT 2026-06-01.

## Per-checkpoint tags during the refactor

I'll drop additional tags after each Phase 1 step:
- `phase1-step5-registry` — after #5 registry dispatch lands
- `phase1-step1-statemachine` — after #1 state machine lands
- `phase1-step2-intake` — after #2 intake consolidation lands
- `phase1-step6-backup` — after #6 backup verification

This means you can roll back to any partial-progress state — not just all-or-nothing.

## Sanity checks before any rollback

1. **Is it actually broken, or just looks broken?** Check `event_log` for recent
   errors. Check `/health-check.html`. The colony loop has a `loop_self_watch`
   agent that detects stuck signals.
2. **Are real customers affected?** Check `customer_facing_enabled` gate state.
   If it's still OFF, customer-side blast radius is small.
3. **Is it reversible without git?** A bad XS endpoint can often be patched in
   place faster than a full revert. Try `xano workspace push -i "**/<name>*" --force`
   with the previous version of the file before reaching for revert.

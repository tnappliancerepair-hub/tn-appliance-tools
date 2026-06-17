# TONIGHT — make "talk to Ant" the gold standard (paste-and-go)

Goal: one call to Ant fills the **tech tool + TDR + office** at once, in real time.

Three steps. Do them at the Mac Mini when **no tech is mid-call** (evening is fine).

---

## 1. Wire Ant to write the TDR LIVE during the call
The end-of-call backstop is already live (writes the TDR from the transcript).
This adds the *live, field-by-field* writing so it fills as the tech talks.

```
cd ~/tn-appliance-tools && git pull origin main
# DRY RUN first — shows exactly what it will change, changes nothing:
node colony-loop/scripts/wire-field-assist-live-tdr.js
# If it looks right, apply it:
node colony-loop/scripts/wire-field-assist-live-tdr.js --apply
```

Then **make ONE test call** — tap “Talk to Ant” on any job, say a fake diagnosis +
part + labor, hang up, and watch the TDR. (Safe to run anytime; it’s idempotent —
re-running does nothing once wired.)

## 2. Deploy the backend auto-start guard (XS)
So completing a job you never tapped “Start” on works on every surface, not just
the tech-job page (which is already covered live).

```
/opt/homebrew/bin/xano workspace push -i "api/**/tech_job_complete*" --force
```

Look for `Pushed 1 documents`. Known footgun: the CLI sometimes says “Pushed” but
no-ops — verify by completing a still-`scheduled` job and confirming it lands.

## 3. Restart the colony loop
It’s currently DOWN — so morning briefings, automations, and the warranty
**auto-draft** (turns a finished TDR into Danielle’s ready-to-submit packet)
aren’t running. Restart:

```
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```

Confirm it’s alive: a `loop_tick` event should appear within ~60s
(`health-check.html`, or check event_log).

---

### Already live (no action needed)
- ✅ End-of-call TDR write (voice → TDR → office) — every field-assist call.
- ✅ Front-end auto-start before Complete (tech-job.html).
- ✅ “🎤 From your Ant call” live panel on tech-job.html — the tech watches the
  TDR fill (read-only mirror; never touches their typed report).

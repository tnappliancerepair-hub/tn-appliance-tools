# Danielle's Runbook — Ant System While Teddy's Away

Last updated: 2026-05-28 (pre-vacation)

This is your one-stop reference for running ops while Teddy is on vacation. If you get stuck on anything not in this doc, text Teddy at **615-485-5795** — he'll have spotty signal but should reply within a few hours.

---

## Your daily flow

| Time | What | Where |
|---|---|---|
| ~7:30 AM | Check **Office Todo** for anything that hit overnight | `tnapplianceexchange.net/office-todo.html` |
| Throughout day | Process the **Needs Scheduled** queue (warranty emails) | `tnapplianceexchange.net/needs-scheduled.html` |
| Throughout day | Handle inbound customer SMS replies that come to your phone | (auto-routed via Ant) |
| Throughout day | Submit warranty claims for completed jobs (AHS / ServicePower / Frontdoor portals) | (your existing portals) |
| End of day | Look at **Office Pulse** to spot anything weird | `tnapplianceexchange.net/office-pulse.html` |

---

## Your most powerful tool: 🐜 Ask Ant

Every office page has a **🐜 blue floating button in the bottom-right**. Tap it. Ask anything. Examples that work:

- *"What needs my attention right now?"*
- *"Who has capacity tomorrow?"*
- *"Look up the Smith customer at 615-555-1234"*
- *"Who should we assign job 18250 to?"*
- *"Reschedule job 18250 to Friday 10am"* (Ant will preview + ask you to confirm before committing)
- *"Draft a running-behind SMS for job 18250, 30 min late, prior job ran long"*
- *"What did we do at this customer last time?"* (after looking up their job)

**Important**: Ant **previews** all schedule/reschedule/cancel actions before committing. You'll see *"Will reschedule job #X to Y. Confirm? (yes/no)"* — only when you say **yes** does it actually happen.

---

## Common scenarios

### 1. "A new AHS / ServicePower / Frontdoor warranty email just came in"
- It lands automatically in **Needs Scheduled** (`needs-scheduled.html`).
- You'll get an SMS from Ant: *"[ant] new AHS job in Needs Scheduled: Sarah, Nashville. tnapplianceexchange.net/needs-scheduled.html"*
- Open the queue, click the job, click **Schedule**.
- Pick a tech + date + time → click Save.
- Customer gets auto-confirmation SMS. Tech gets assigned-job SMS. Done.

**Stuck on tech assignment?** Tap 🐜 and ask: *"Who should we assign job [X] to?"* — Ant scores all techs and recommends one with reasoning (closest, lowest load, region match).

### 2. "Customer texts in 'I need to reschedule'"
- Ant classifies this and SMSes you: *"[ant] 🔄 reschedule request from {customer} job #{N}"*
- Open `job-detail.html?job_id={N}` (deep-linked from the alert).
- Tap **Reschedule** in the action modal, pick new time, save.
- Customer gets confirmation SMS automatically.

Or just tap 🐜 anywhere and say *"Reschedule job {N} to [new time]"*.

### 3. "A tech is running behind on a job"
- Tap 🐜 on any page.
- Say *"Draft a running-behind SMS for job {N}, [X] minutes late, [reason]"*
- Ant produces a polished customer-facing SMS.
- Copy → send via your usual SMS interface to the customer's number.

Same for **ahead of schedule** — use that wording and Ant asks the customer if earlier works.

### 4. "A tech taps Complete on a warranty job"
- You'll get an SMS from Ant with the warranty digest (5-section format).
- If TDR was complete: digest is "clear to submit" — just upload the package to the vendor portal.
- If TDR was incomplete: digest says "BLOCKED — missing X, Y, Z" — text the tech to fill those fields. Once they do, the warranty digest auto-re-fires.

Or open `warranty-review.html` to see all recent completions in one list.

### 5. "Something looks broken / weird"
- First, check **Loop Health**: `tnapplianceexchange.net/health-check.html` — green = healthy, yellow = stale, red = down.
- If red: open Terminal on the Mac Mini and run: `launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`
- Still broken: text Teddy.

### 6. "A customer calls and asks where their tech is"
- Open `customer-portal.html?job_id={N}` (or have them open it themselves with the link in their confirmation SMS).
- If the tech has tapped "On My Way," a **live truck map** appears showing the tech's position + ETA. Walk the customer through it.

---

## Pages cheat-sheet

| Page | What it's for |
|---|---|
| `office.html` | Home base — links to everything |
| `office-todo.html` | "What needs human action right now" |
| `office-pulse.html` | Live activity feed (last 30 events) |
| `office-calendar.html` | Week view of all jobs, click cell to manage |
| `needs-scheduled.html` | **Your warranty intake queue** |
| `customer-search.html` | Look up any customer by phone/name/address |
| `warranty-review.html` | Recent warranty completions ready to submit |
| `office-dashboard.html` | Broader business metrics |
| `office-tn.html` / `office-la.html` | Region-specific views |
| `health-check.html` | Loop liveness indicator |

Office password is the same one Teddy uses. If lost, ask the techs — Jimmy or Lee knows it.

---

## What's automated (you don't need to touch)

- Customer auto-confirmation SMS when a job gets scheduled
- Tech assignment SMS when you assign someone
- Daily 7am tech briefings
- 6am architect (builds dormant agents overnight — ignore it)
- Loop heartbeat (Mac Mini pinging that it's alive)
- TDR auto-fill from tech SMS findings
- Lawsuit-grade photo/video upload retention
- No-show check (6h after Start Job)

---

## What's blocked / requires Teddy

- New tech hiring decisions
- Pricing / refund decisions
- HCP-related changes (HCP is decommissioned, but if anything weird shows up there)
- Vendor / supplier disputes
- Anything involving money out the door

---

## Vacation backup mode

**Teddy:** before you leave, set `VACATION_BACKUP_PHONE=+16154850713` in `colony-loop/.env` on the Mac Mini and restart the loop. Every SMS that would go to your phone will ALSO be CC'd to Danielle's phone with a `[bkup]` prefix. When you're back, unset it.

```bash
cd ~/tn-appliance-tools/colony-loop
echo 'VACATION_BACKUP_PHONE=+16154850713' >> .env
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```

To verify it's active, check the loop logs for the next owner-bound SMS — Danielle should also receive one prefixed `[bkup]`.

To turn off:
```bash
# Remove the line from .env (or set it to empty)
sed -i '' '/^VACATION_BACKUP_PHONE=/d' colony-loop/.env
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```

---

## Emergency contacts

- Teddy: **615-485-5795** (use sparingly — vacation signal)
- Jimmy (senior tech, can advise): **615-967-1304**
- Lee (senior tech): **615-829-1654**

---

## If the Mac Mini dies entirely

The cron-style loops will stop running. Customer-facing portal still works (Netlify-hosted). Office Ant still works (Netlify-hosted). What dies:

- Pre-job briefings to techs
- Daily 7am tech morning SMS
- Warranty submission alerts to you
- Hold-and-re-emit timers (waiver-due, no-show-check, etc.)

To restart: SSH or sit at the Mac Mini, run:
```bash
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```

If the machine itself crashed: reboot it. Loop auto-starts via launchd.

---

**You've got this. The system was built for this.** 🐜

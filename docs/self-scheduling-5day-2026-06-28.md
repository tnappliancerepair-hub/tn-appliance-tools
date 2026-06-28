# Self-Scheduling Autopilot — 5-DAY DELIVERY (committed 2026-06-28)

GOAL: self-scheduling LIVE in 5 days. The TECH is the decision-maker; Ant computes
one route-smart, availability-honoring offer → tech taps YES → auto-books → customer
confirmed. Owner only on exception. (Full vision: self-scheduling-autopilot-plan-2026-06-19.md)

## Reality check — most of it is already BUILT (why 5 days is real)
- ✅ Offer engine `tech_job_offer.js` (shadow/live, unit-tested) + `grab.html` book chain + `APPOINTMENT_SCHEDULED` → customer confirm.
- ✅ `computeOffer()` fires for EVERY new job (JOB_INTAKE_COMPLETE) and **honors customer availability** (`avail.dayOk()`), tech route + capacity, and parts-ETA. (Two of the three "gaps" in the old plan are already closed.)
- ✅ Availability cascade fills `customer_preference_text` (greeting ask → nudge → Vapi call).
- ✅ Two flags: `TECH_OFFER_ENABLED` (path on) · `TECH_OFFER_LIVE` (tech vs shadow).
- ❌ THE ONE REAL GAP: the **wait-then-escalate sweep** (offer rank-1 → no answer in window → re-offer next-ranked tech → only then escalate to owner). Without it, an ignored offer just sits. Must exist before LIVE.

## Day-by-day

**Day 1 (today)** — START SHADOW + build the gap.
- Teddy: turn shadow ON (commands below). Real new jobs → Ant texts Teddy the offer it WOULD make ("would offer Jimmy, Thursday, fits his day + your availability"). No tech pinged. Zero risk.
- Claude: build the **escalate sweep** agent (the one pre-live gap) + a scheduling scoreboard metric. Push to main.

**Day 2** — Watch + tune shadow picks.
- Read the shadow offers (event_log `tech_job_offer_shadow`). Verify: right tech? right day? availability honored? Tune `computeOffer` until the picks are consistently good.
- Teddy pulls the escalate sweep; runs it in shadow too.

**Day 3** — Prove the escalate walk in shadow.
- Verify: rank-1 offered → window passes → re-offers next tech → after ranks, escalates owner. Confirm availability + capacity hold. Fix mis-picks.

**Day 4** — GO LIVE (gated).
- Flip `TECH_OFFER_LIVE=true` (optionally one cluster/tech first). One real job: offer → tech YES → auto-books → customer gets confirmation + window. Watch it end-to-end.

**Day 5** — Full live + cockpit.
- All clusters live. Add the **Scheduling card to the Teddy Tool** (cockpit window: Ant's pick + why + offer status + override). Watch the churn scoreboard.

## Turn SHADOW on TODAY (Mac — no new code needed, zero customer/tech impact)
```
cd ~/tn-appliance-tools && git pull origin main
echo 'TECH_OFFER_ENABLED=true' >> colony-loop/.env        # leave TECH_OFFER_LIVE OFF
launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```
→ Ant computes real offers on real new jobs and texts Teddy the preview. Nobody else is touched.
Kill switch: remove the line + kickstart.

## Guardrails (do not repeat past incidents)
- Shadow before live, always. Kill switches on. Weekend mute + SMS breaker stay.
- No per-job Xano write-flood (the melt). Sweep runs on the existing tick cadence, lean.
- Customer availability is a HARD constraint — never offer a day they said they can't.

## Risks / dependencies (honest)
- Loop changes deploy via Mac (`git pull` + kickstart) — Claude builds + pushes, Teddy deploys.
- Needs availability flowing (cascade is live; intake-collector stays off — greeting/nudge cover it).
- Parts-ETA gating is already in computeOffer for jobs that have `parts_eta_date`.

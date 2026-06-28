# Self-Scheduling Autopilot — 5-DAY DELIVERY (committed 2026-06-28)

GOAL: self-scheduling LIVE in 5 days.

## ❤️ THE WHY (Teddy 2026-06-28)
**These techs are Teddy's people — family and close friends.** John = his cousin, Jimmy = his
brother, Andre = his son, Lee = his friend. *"These are my people. If they win, we will."*
Build every tech-facing thing with that in mind: this is taking care of the people he loves, not
managing staff. Warmth, respect, and genuine help are the bar — not efficiency for its own sake.

## 🌟 GOVERNING PRINCIPLE (Teddy 2026-06-28)
**"No more surprises — it's all communication, with a positive attitude."**
Everything in this system is PROACTIVE, TRANSPARENT, POSITIVE communication. Nobody —
tech or customer — is ever caught off guard. The tech knows his day and that it was built
around his life; the customer sees their preference honored + a live window; running behind
is handled WITH them, not sprung on them. Ant is on everyone's side. Every feature is held
to this: if it would surprise someone or carry a negative tone, it's built wrong. This is the
through-line of the whole autopilot — the schedule is a conversation, not a command.

## ⚡ MODEL EVOLUTION (Teddy 2026-06-28) — TECH-PROFILE FIRST, then AUTO-PLACE
The foundation is understanding each TECH deeply, then building him a day he can run with pride.

**0. FOUNDATION — AI interviews each TECH (the new centerpiece).**
   An AI assistant **calls each technician** and does an **in-depth interview** to build a rich
   profile of how he wants to work + his real life:
   - working style: starts early vs works late; preferred hours
   - hard constraints: e.g. **Tuesdays off (wife's day off)**, no 7am (kids/school), day-off patterns
   - soft preferences: prefers afternoons, certain areas, machines he's strongest on
   - what a good, productive day looks like TO HIM
   Stored as a structured tech profile — **hard constraints honored absolutely, soft prefs optimized around.**

**1. REGULAR PATH — auto-place from the profiles.**
   Ant uses each tech's profile (+ route/cluster density, capacity, parts-ETA, customer need)
   to **auto-build each guy a productive day and ADD the jobs to his schedule.** No offer.
   Goal: a day he can do **with pride** because it's built around his real life.

**2. TECH NOTIFY:** auto-added to his dashboard + **heads-up text with a 'flag a problem' tap** (Teddy's pick).

**3. EXCEPTION ONLY (occasional/tricky):** if a job can't fit a profile cleanly → call/offer the
   tech → he can send it back → offer others → owner last resort. The old tech-offer/escalate
   engine becomes this EXCEPTION handler, not the regular flow.

(Supersedes BOTH the "offer-first" model in self-scheduling-autopilot-plan-2026-06-19.md AND the
earlier mis-read "call the customer" version — the call is to the TECH, to build his profile.)

## ✅ The customer side is ALREADY DONE (don't rebuild it) — Teddy 2026-06-28
- Customer availability ("when I am / am not free") is **captured at the Quick Check intake**
  → `customer_preference_text`. No customer call needed for scheduling.
- It's **already shown openly on the daily dashboard** in the customer's exact words (built 6/27)
  → tech + office are fully informed and work accordingly.
So both inputs the engine needs: **customer availability ✓ (intake)** + **tech availability/profile
(the interview — the one missing piece)**. With both, the engine just **clusters customers onto the
days that tech is available** and adds them to his day. Everyone wins, everyone's informed.

## ✅ BUILT 2026-06-28 — the tech-interview assistant (path A)
- Vapi assistant **"Ant — Tech Setup"** id `ec2be4b8-c1c4-4c68-a7ea-d44f7d63a3e6` (inbound voice copied).
- Conducts the in-depth interview + tells the tech: "want more work, tell me" + "running behind, I'll notify customers & help."
- Saves via `save_tech_profile` tool → `tech-interview-tool.js` → event_log `tech_profile_v1` → read by `get-tech-profile`.
- Control (vapi-admin, secret-gated): `?action=setup_tech_interview[&update_id=]` (create/update prompt) · `?action=interview_call&to=+1...&assistant_id=ec2be4b8-...&tech_id=N&tech_first=Name` (place the call).
- Profile store: `set-tech-profile` / `get-tech-profile` (live, empty). Roster: Jimmy 615-967-1304, Andre 504-909-9413, Lee 615-829-1654, John 813-352-7686, Teddy 615-485-5795.
- **NEXT:** test-call Teddy → tune her → call the crew → wire profile (hard filter + soft score) into the scheduler.

## ✅ MODEL LOCKED — AUTO-PLACE (Teddy 2026-06-28): "just add it to their schedule"
**No offer, no acceptance, no escalate sweep.** If a job fits the tech's profile +
the customer's availability + doesn't exceed his stop cap → Ant **adds it to his day**
and sends a warm heads-up ("added to your {day}, built around your schedule, reply if it
doesn't work"). Customer confirmation rides the existing APPOINTMENT_SCHEDULED chain.
If nothing fits → fall through to the exception path (legacy 3-options to Teddy).
**This RETIRES the offer/escalate model — the wait-then-escalate sweep is NO LONGER NEEDED.**
- `job_intake_complete.js`: autopilot path books directly (`source='auto_place'`) instead of
  emitting TECH_JOB_OFFER. Shadow (`techOfferEnabled`, `techOfferLive` off) = preview to Teddy,
  places nothing. Live (`techOfferLive` on) = books + warm tech heads-up + 1-line Teddy FYI.
- `appointment_scheduled.js`: skips its generic tech text for `auto_place` (autopilot sends the
  warm one) — customer confirm still fires.

## ✅ DONE — tech profile WIRED into computeOffer (the centerpiece)
`job_intake_complete.js computeOffer()` now fetches each tech's interview profile
(via the deployed `get-tech-profile` endpoint) and honors it:
- **HARD (filter, never violated):** recurring days off (`days_off_hard`, e.g. Tue=wife's day),
  earliest-start / latest-end hours (`start_earliest`/`end_latest`), good-day stop cap
  (`stops_max`), avoided appliances (`appliance_avoid`) + avoided areas (`areas_avoid`) →
  the last two fall through to the exception/owner path instead of forcing a bad placement.
- **SOFT (optimized):** slot aims for his `start_ideal`, kept inside the (tightened) window.
- **Graceful:** no profile yet → unconstrained, identical to old behavior. Helpers unit-tested
  (day-name + clock parsing, 12/12). Ships dark; lights up per-tech as interviews land.
- **Deploy:** Mac `git pull origin main` + `launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`.

## So the build reduces to:
1. **Tech profiles** (the interview) — the only missing INPUT.
2. **Clustering / auto-place** honoring customer availability (have it) + tech profile (wire it).
3. **Transparency** — customer preference on the dashboard (have it); add the placed-day + 'flag a problem'.

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

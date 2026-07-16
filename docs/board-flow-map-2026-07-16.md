# Office Board — canonical flow map (Teddy 2026-07-16)

The single source of truth for how a job moves across the office board
(`office-board.html`). When routing is unclear, check THIS doc — don't guess.
`placeOf()` in office-board.html implements the AUTO rules below; every
MANUAL move is a Danielle drag that sticks via `office_stage` (and her live
drop wins via `pendingStage`).

## The lifecycle

There are two completion outcomes out of Tech Report, and they route
differently. ✅ Completion is ONLY the parts-received checkpoint — a *finished*
job never sits there.

```
1  Needs Scheduled
      │  Danielle books a day + a tech            (MANUAL)
      ▼
2  Scheduled  ◄──────────────────────────────┐
      │  tech taps Start (in_progress)  (AUTO)│
      ▼                                        │
3  [Tech] · Report                             │
      │                                         │
      ├─► FINISHED (completed, no return —       │
      │   same-day / no-failure)                 │
      │        │  (AUTO on completed)            │
      │        ▼                                 │
      │   7 Follow Up ──(48h)──► 8 Needs Invoice │
      │                                          │
      └─► NEEDS PARTS / RETURN                    │
             ▼  (AUTO on part ETA set)           │
          5 Waiting Parts                         │
             │  parts RECEIVED  (AUTO)            │
             ▼                                    │
          6 ✅ Completion  ← parts-received       │
             │  checkpoint: verify the parts,     │
             └── office books the return ─────────┘  (MANUAL → Scheduled)
                 …return visit runs, tech marks completed → 7 Follow Up

7  Follow Up ──(after 48h)──► 8 Needs Invoice ──► 9 [Tech] · Invoice ──► 10 💰 Paid
   (48h auto-advance = TO BUILD; today Follow Up → Needs Invoice is a manual drag)
```

`Upgrade` = parked/dormant. Kept in the code so it never has to be rebuilt,
but it is NOT part of the flow and nothing auto-routes to it.
`Waiting for Autho` = RETIRED 2026-07-16 (no longer used).

## Each area

| # | Area (col id) | What it means | What puts a job IN (trigger) | Auto/Manual |
|---|---|---|---|---|
| 1 | Needs Scheduled (`schedule`) | Accepted, not on a tech's day yet | Intake | AUTO |
| 2 | Scheduled (`scheduled`) | Booked: real day + a tech, not started | Danielle books it (day + tech) | AUTO once day+tech set |
| 3 | [Tech] · Report (`rep-<t>`) | Tech has STARTED the job | Tech taps Start → `in_progress` | AUTO |
| — | Upgrade (`upgrade`) | Dormant/parked — not in flow | (none) | — |
| 5 | Waiting Parts (`parts`) | Parts ordered, ETA set, not arrived | Danielle sets the part ETA | AUTO |
| 6 | ✅ Completion (`done`) | Parts-received checkpoint ONLY — verify parts, book the return. A finished job never sits here. | `parts_status=arrived` | AUTO |
| 7 | Follow Up (`followup`) | A FINISHED job lands here (same-day / no-failure / return-visit done); customer gets 48h | Job marked `completed` | AUTO |
| 8 | Needs Invoice (`needinv`) | Ready to BILL — a Follow Up job past its 48h | After 48h in Follow Up (TO BUILD), or office drag | MANUAL (auto TO BUILD) |
| 9 | [Tech] · Invoice (`inv-<t>`) | Per-tech billing folder | Office drags it | MANUAL |
| 10 | 💰 Paid (`paid`) | Invoiced + paid, closed | Marked paid | MANUAL / mark-paid |

## The two branches out of Tech Report

A job in **[Tech] · Report** goes exactly ONE of two ways:
- **Done this visit** → **✅ Completion** (auto when the tech marks it completed).
- **Needs parts** → **Waiting Parts** (auto once Danielle sets the part ETA).
  When the part **arrives** (`parts_status=arrived`), the job auto-moves to
  **✅ Completion** FIRST — so the office can verify/track the received parts —
  and from there the office books the return visit (→ **Scheduled**), which
  re-enters the cycle at Scheduled → Tech Report → Completion. (Teddy
  2026-07-16; supersedes the 2026-07-08 "parts received → Needs Scheduled".)

## The billing tail is office-driven

From **✅ Completion** onward the OFFICE walks the job: Completion → Follow Up
→ Needs Invoice → [Tech] · Invoice → Paid. These are manual drags (each
sticks via `office_stage`), NOT status-driven — so a completed job lands in
Completion and waits for the office to move it forward. "Completion is for
completions, not for ready-to-invoice jobs" = Completion is the finish stage;
**Needs Invoice** is the ready-to-bill folder later in the walk.

## Tech completion options → routing (what the tech taps when he finishes)

The tech's "How did THIS visit end?" screen (`tech-job.html`) has four options.
Each maps to a `scheduling_status` and a board lane:

| Tech taps | completion_type | status | Board lane | Flow |
|---|---|---|---|---|
| ✅ Fixed it — done | `repair_complete` | `completed` | **Follow Up** | Same-day: → Follow Up → 48h → Needs Invoice → bill |
| 🔩 Needs parts — coming back | `parts_needed` | `awaiting_parts` | **Waiting Parts** | Parts cycle → Completion (parts in) → return → done |
| 🔁 Recommend replacement | `no_repair` | `no_fix_possible` | **[Tech] · Report** | Stays as active work; office files the replacement claim |
| 🙋 Pass off — 2nd opinion | `reassignment_needed` | `needs_more_info` | (option 4 — TBD) | (to be mapped) |

### Option 3 — Recommend replacement (the replacement gate)

Tapping 🔁 Recommend replacement fires an **unmissable modal** (`replacementGate()`
in tech-job.html) that BLOCKS the completion until the tech provides:
1. A **photo of the model number + the machine** (uploaded to the job).
2. A **detailed written reason** why it needs replacing (≥40 chars; prefixed
   "🔁 REPLACEMENT RECOMMENDED —" into the report so the office files/bills from it).

Copy hammers: "Skipping this only delays YOUR pay for this job." The job then
routes to the **tech's Report folder** (not Completion / Follow Up) so the office
has the package to file the replacement claim same-day. (Teddy 2026-07-16.)

## Guardrails already in the code

- A **stale `scheduled` stamp** on a job that has moved on (started / waiting
  parts / completed) is dropped so it can't pad the Scheduled count.
- Nothing is ever silently dropped: `safeCol()` re-homes any job whose column
  isn't rendered (departed tech, cross-region) into a real, visible lane.
- Canceled jobs leave the board entirely.

## Changelog
- 2026-07-16: First written. Retired Waiting for Autho; kept Upgrade dormant;
  renamed ✅ Completed → ✅ Completion; completed jobs route to Completion
  (first stop), office walks Completion → … → Paid.

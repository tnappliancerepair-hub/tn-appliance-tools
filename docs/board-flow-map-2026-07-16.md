# Office Board — canonical flow map (Teddy 2026-07-16)

The single source of truth for how a job moves across the office board
(`office-board.html`). When routing is unclear, check THIS doc — don't guess.
`placeOf()` in office-board.html implements the AUTO rules below; every
MANUAL move is a Danielle drag that sticks via `office_stage` (and her live
drop wins via `pendingStage`).

## The lifecycle (the full cycle)

```
1  Needs Scheduled
      │  Danielle books a day + a tech            (MANUAL)
      ▼
2  Scheduled  ◄──────────────────────────────┐
      │  tech taps Start (in_progress)  (AUTO)│
      ▼                                        │
3  [Tech] · Report                             │
      ├──►  Completion   (finished this visit) │  (AUTO on completed)
      └──►  Waiting Parts (parts needed)        │  (AUTO on part ETA set)
                 │  parts RECEIVED              │
                 └──── back to scheduling ──────┘  (AUTO: → Needs Scheduled
                        to book the return visit)
6  ✅ Completion   ← a completed job's FIRST stop
      │  office walks it forward                 (MANUAL)
      ▼
7  Follow Up
      │                                          (MANUAL)
      ▼
8  Needs Invoice   ← ready to bill
      │                                          (MANUAL)
      ▼
9  [Tech] · Invoice
      │                                          (MANUAL)
      ▼
10 💰 Paid (Shop Money) — closed                 (mark paid)
```

`Upgrade` = parked/dormant. Kept in the code so it never has to be rebuilt,
but it is NOT part of the flow and nothing auto-routes to it.
`Waiting for Autho` = RETIRED 2026-07-16 (no longer used).

## Each area

| # | Area (col id) | What it means | What puts a job IN (trigger) | Auto/Manual |
|---|---|---|---|---|
| 1 | Needs Scheduled (`schedule`) | Accepted, not on a tech's day yet | Intake; OR parts received → book the return | AUTO |
| 2 | Scheduled (`scheduled`) | Booked: real day + a tech, not started | Danielle books it (day + tech) | AUTO once day+tech set |
| 3 | [Tech] · Report (`rep-<t>`) | Tech has STARTED the job | Tech taps Start → `in_progress` | AUTO |
| — | Upgrade (`upgrade`) | Dormant/parked — not in flow | (none) | — |
| 5 | Waiting Parts (`parts`) | Parts ordered, ETA set, not arrived | Danielle sets the part ETA | AUTO |
| 6 | ✅ Completion (`done`) | The completion — tech finished the work (1st visit or return) | Job marked `completed` | AUTO |
| 7 | Follow Up (`followup`) | Office follow-up / second look | Office drags it | MANUAL |
| 8 | Needs Invoice (`needinv`) | Repair done, ready to BILL | Office drags it here from Completion/Follow Up | MANUAL |
| 9 | [Tech] · Invoice (`inv-<t>`) | Per-tech billing folder | Office drags it | MANUAL |
| 10 | 💰 Paid (`paid`) | Invoiced + paid, closed | Marked paid | MANUAL / mark-paid |

## The two branches out of Tech Report

A job in **[Tech] · Report** goes exactly ONE of two ways:
- **Done this visit** → **✅ Completion** (auto when the tech marks it completed).
- **Needs parts** → **Waiting Parts** (auto once Danielle sets the part ETA).
  When the part **arrives**, the job returns to **Needs Scheduled** to book
  the return visit, then re-enters the cycle at Scheduled → Tech Report →
  Completion.

## The billing tail is office-driven

From **✅ Completion** onward the OFFICE walks the job: Completion → Follow Up
→ Needs Invoice → [Tech] · Invoice → Paid. These are manual drags (each
sticks via `office_stage`), NOT status-driven — so a completed job lands in
Completion and waits for the office to move it forward. "Completion is for
completions, not for ready-to-invoice jobs" = Completion is the finish stage;
**Needs Invoice** is the ready-to-bill folder later in the walk.

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

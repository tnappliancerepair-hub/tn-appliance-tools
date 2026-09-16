# Phone cutover plan — Xano Ann → platform Ann

**Status 2026-09-16:** the dual-feed line is **standing**. Nothing published has moved.
Every customer-facing number still rings the Xano Ann.

---

## What is true right now (measured, not assumed)

| | |
|---|---|
| TN platform Ann number | **+1 615-235-9256** (Telnyx, bought 2026-09-16, `mode: buy`) |
| Assistant | `assistant-feb17518-5adc-4686-ad6a-625a688c8620` |
| Warm transfer | ✅ `transfer_wired: true` (the first-provision gap is already closed) |
| Precall greeting webhook | ✅ wired, **0.39–0.59s** against a **1.8s** hard budget |
| Warm cron | ✅ `platform-warm` every 5 min — this is what keeps precall winning the race |
| **Ann accuracy on TN's real board** | ✅ **30 of 30 correct, 0 data gaps** (`platform-call-score`, 2026-09-16) |
| Texting from the new DID | ⚠️ `pending` (10DLC) — **does not matter**, see below |
| Published lines | ❌ all still Xano Ann, including 615-280-2949 |

**The texting gap is a non-issue for the call lane.** `send_link` sends from
**615-588-9500** (`sendFrom588`), not the shop's own DID. All four call actions —
`request_day`, `callback`, `send_link`, native `transfer` — work on this line today.

---

## The one thing that makes this safe

**A phone number's inbound binding is a pointer, and a pointer is instantly reversible.**
There is no migration, no data move, no cutover window. Repointing a Telnyx number at a
different assistant takes one edit and takes effect on the next call. That is why this lane
can be tried tonight and undone in sixty seconds — and it is the reason the plan below is
mostly *listening*, not *building*.

---

## Step 0 — decide whether to keep the test line (2 minutes, tonight)

I provisioned 615-235-9256 while putting this plan together. It is unpublished and costs
about $1/month. Two clean options:

- **Keep it** — it is exactly the dual-feed line steps 1–3 need. Nothing further to do.
- **Release it** — one call, no residue:
  ```
  curl -sX POST https://tnapplianceexchange.net/.netlify/functions/platform-phone \
    -H 'content-type: application/json' \
    -d '{"secret":"<admin>","action":"release","company_id":"be4d11a1-5219-469b-916a-ab990be7ea7f"}'
  ```

---

## Step 1 — call it yourself (10 minutes, tonight)

**Dial 615-235-9256 from your own cell.** This single call tests the entire lane end to end,
and it is a better test than any probe I can run, because precall only recognizes a caller it
can find on the board — and your cell is on it.

What to listen for, in order:

1. **She greets you by name and names your situation** — *"Hi Teddy! Thanks for calling TN
   Appliance Exchange…"*. That proves precall won its 1.8s race.
   ⚠️ **The FIRST call after idle may lose it** and give a generic greeting. That is a cold
   start, not a fault. Call twice; the second call is the real read.
2. **Ask "what day am I scheduled?"** → she should use `get_status` and read back **a DAY,
   never a clock time**, and say *"your technician"* if none is named.
3. **Ask "are you open right now?"** → she must check `get_hours`, not guess.
4. **Ask for a person** → in hours she says *"let me connect you"* and transfers; after 6pm CT
   she should take a message instead of ringing anyone.
5. **Ask her to text you the intake link** → it arrives from 615-588-9500.

**Anything that fails here stops the cutover.** Nothing published moves until all five pass.

---

## Step 2 — dual-feed one low-traffic published number (a week)

Pick **one** number that is *not* the main line. The right candidate is a line whose traffic
you can afford to lose entirely for a week — `731-503-1142` (West TN fallback) or
`888-268-8998` (toll-free secondary). **Not 615-280-2949. Not 866-268-0111.**

In Telnyx: that number's inbound binding → the platform Ann assistant above.
Leave every other number on the Xano Ann.

**Then listen for a full week.** This is the whole point and the part that cannot be rushed.

What to read each day:
- `platform-call-score` — the accuracy audit runs nightly (`40 12 * * *` ≈ 7:40am CT) and
  stores a row per run, so a **trend** accrues. It is 100% today; watch that it stays there
  as real callers hit it.
- The board — did calls that should have become jobs actually land as jobs?
- `platform-call-act` write rows — did `request_day` / `callback` actually record?

**The bar to advance:** a week with no call you would be embarrassed by, and the accuracy
number holding. Not "no bugs" — "nothing that cost a customer."

---

## Step 3 — move the main line (the actual cutover)

Only after step 2 clears. Repoint **615-280-2949** at the platform Ann.

**Do it on a weekday morning, not a Friday night**, so a bad hour is caught by a human who is
awake and the office is staffed to catch anything that slips.

**Rollback is one edit:** point 615-280-2949's inbound binding back at the Xano Ann. Takes
effect on the next call. Keep the Xano Ann assistant **alive and unmodified** through this
entire step — it is the parachute, and deleting it is what would make this irreversible.

---

## What is NOT code and carries real lead time

These do not block the plan, but they are the things that cannot be done at 11pm:

- **10DLC registration for TN** — until it clears, the new DID cannot originate texts. The call
  lane does not need it (send_link uses 588-9500), but the *texts* lane does.
- **Carrier spam labeling** — a brand-new DID has no reputation. If 615-235-9256 ever becomes a
  published line, register it at **freecallerregistry.com** first. (615-588-9500 and
  615-857-8800 already carry CNAM "TN APPLIANCE".)

---

## Honest read on cutting over tonight

**Step 0 and Step 1 are safe tonight.** Provisioning is done; calling the number yourself costs
nothing and risks nothing.

**Step 2 is safe tonight** if you pick a genuinely low-traffic number — the downside is one
seldom-used line behaving differently for a week, with a one-edit undo.

**Step 3 tonight would be a mistake**, and not because the code isn't ready — the accuracy
audit says it is. It's that the only thing that catches a bad call is *a human hearing it*, and
at night nobody is listening. The week of dual-feed isn't ceremony; it's the only test that
covers the calls I can't simulate — the confused caller, the warranty rep, the angry one.

**Minimum viable tonight: Steps 0 → 1 → 2.** The main line moves next week.

---

## Rollback, all of it, in one place

| If | Do |
|---|---|
| The test line misbehaves | Repoint it back to the Xano Ann. One edit. |
| You want the number gone | `platform-phone action=release` (above). |
| The main line misbehaves after step 3 | Repoint 615-280-2949 → Xano Ann. Next call is fixed. |
| Ann answers but gets facts wrong | `platform-call-score` names the exact jobs. The fix is board data, not the brain. |

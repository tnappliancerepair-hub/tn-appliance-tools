# Close-Flow Outcome Capture — the brain's missing answer key (spec, 2026-08-21)

**Why:** Measured the brain 2026-08-21 against 300 graded jobs — exact-part accuracy
**~1%**, and the root cause is upstream of the brain: **closed jobs don't record a clean
"what fixed it."** The winning part comes back as prose ("Washer Drain Pump Assembly
5859EA1004P"), as "Na"/"None"/"No parts needed," or blank. With no clean answer key the
brain (a) can't learn from the close — `brain-autolearn` saw 104 closed jobs and learned
from **0** — and (b) can't be graded. Same gap as "no pre-ordered parts." Fix the capture
and the whole flywheel starts turning.

**Pace (Teddy 2026-08-21):** "Yes unless it slows the system today — we can run it over the
weekend." → This is spec-only today (zero prod impact). Execution posture below is
**weekend-safe** and the core lever ships with **no XanoScript / no Mac paste at all.**

---

## What "clean answer key" means
Per closed job, exactly one of:
1. **A part fixed it** → one or more *clean part numbers* (e.g. `WPW10185982`), not prose.
2. **No part needed** → an explicit, structured "no part" outcome (so it's deterministically
   EXCLUDED from the accuracy denominator instead of polluting it as "Na").
3. **Not fixed / second trip** → already captured by the `repair_completed` field.

Today the card can express #1 (messily) and #3, but **#2 has no clean form** — so techs type
"Na" into the part field, which is 40% of the graded noise.

---

## Part 1 — CORE fix (Netlify only · no XS · additive · can't slow anything)
All in `ant-tdr-card.js` (the tech's close card). Two changes, both client-side; the card
already makes exactly one write call per field via `update_tdr_field_from_voice` — we add
**no new blocking network round-trips**, so there is no latency cost.

### 1a. Normalize the part to a clean number on save
The card writes the part at `ant-tdr-card.js:1096` (`add('parts_needed', _pn)`) and again in
the manual field editor. Before writing, run the part text through a clean-token extractor
(same logic as `_lib/brain-eval.js extractPartTokens`) so "Washer Drain Pump Assembly
5859EA1004P" is stored as `5859EA1004P`. Keep the tech's prose in the *narrative*
(`failed_component`) as it already does — only the value that lands in `verified_part_number`
gets cleaned. One small helper, reused at both write points.

### 1b. Add a one-tap "🔧 Fixed — no part needed" outcome
On the finish/complete step, add a chip next to the part field. Tapping it:
- Writes a clean marker to `repair_completed` (a prose field — safe): `"Complete — no part needed"`.
- Sets the card's `partsOk` true (satisfies the completeness gate at `ant-tdr-card.js:1136` /
  `:307` / `:320`) so a no-part job can close **without** the tech typing "Na".
- Leaves `verified_part_number` **empty** → grading already treats an empty part as
  *ungradeable* (`brain-eval.gradeAgainstOutcome` → `part_gradeable=false`), so the job is
  cleanly excluded from the accuracy denominator instead of counting as a miss.

**Net effect of Part 1:** every close lands either a clean part# or a clean "no part" flag.
The flywheel gets a real answer key. Ships as one `ant-tdr-card.js` edit + cache-buster bump;
I can test it headless before it goes live. **No Mac, no XanoScript.**

---

## Part 2 — belt-and-suspenders (XS · Mac paste · OPTIONAL, weekend)
Part 1 fixes the *card*, which is where ~all tech closes happen. Part 2 guarantees clean
capture for **every** writer (voice scribe, office paste, supplied-parts flow) by cleaning at
the server. Optional — do it only if we want the guarantee; the brain benefits from Part 1 alone.

- **`update_tdr_field_from_voice` (XS):** when the incoming `field == "parts_needed"`/writes
  `verified_part_number`, strip prose to clean part token(s) before the `db.edit` — a few
  string ops in an existing endpoint (negligible cost). This is the only code paste, and it's
  a pure add inside one handler. **Carefully author + verify on the Mac** (XS can't be tested
  from chat — per the standing rule, no blind XS ship).
- **Optional dedicated column (Xano UI):** add `technician_decision_report.no_part_needed`
  (bool) for a bulletproof, unambiguous exclusion signal instead of parsing `repair_completed`
  prose. Xano UI / Database-scoped token only. Nice-to-have, not required.

---

## Why this is weekend-safe (and why it can't slow "the system today")
- Part 1 is a **client-side UI addition** to the close card — no new server calls, no change to
  any hot path (phones, board, intake, scheduling all untouched). The one write it makes is the
  same call the card already makes today.
- Part 2 touches one TDR-write endpoint with a few string ops; it does not touch any
  high-traffic or customer-facing path.
- Nothing here changes phones, the office board, warranty flow, or customer messaging.
- Rollback = revert one `ant-tdr-card.js` commit (Part 1) / re-paste the prior XS (Part 2).

## Execution checklist (this weekend)
1. **[Claude, Netlify]** Ship Part 1a + 1b in `ant-tdr-card.js`, bump the embedding pages'
   cache-buster, headless-verify the chip + clean-write, merge to main.
2. **[Teddy, Mac — optional]** Paste the Part-2 `update_tdr_field_from_voice` normalization;
   verify a prose part in → clean part# stored. (Skip if we're happy with card-only.)
3. **[Teddy, Xano UI — optional]** Add the `no_part_needed` bool column.
4. **[Claude]** After a few days of real closes, re-run the brain grade — watch clean part#
   capture climb and the ungradeable-noise share fall. That's the flywheel starting to turn.

## What this does NOT do
It does **not** make the brain accurate overnight — accuracy is a *data* problem and the
grounded corpus is still thin (~180 live rows). This is the **precondition**: without a clean
answer key on every close, no ranking work can compound. With it, every job Teddy's crew
closes starts teaching the brain for real — and grading turns "0% vibe" into a number that
moves.

---
*Changelog: 2026-08-21 — created. Pairs with the same-day confidence-honesty guardrail
(`ant-brain-predict.js`) and the measured finding that symptom-conditioning gives ~0 lift on
the current thin corpus (the corpus, not the ranking, is the bottleneck).*

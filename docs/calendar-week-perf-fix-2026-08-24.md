# get_office_calendar_week perf fix — kill the per-job N+1 (2026-08-24)

**Symptom:** the office **Schedule** page (`new-scheduling.html`) times out — "network error:
signal timed out" — and the **job board** is slow. Measured live: `get_office_calendar_week`
took **12–45s** (sometimes stalled past 45s), while light Xano lookups were **0.35s**. So it's
not a Xano outage — it's this one endpoint.

**Root cause:** the endpoint looped over the week's jobs and did **`db.get customer` per job** —
up to **500 scheduled + 100 unscheduled = ~600 sequential customer round-trips per request.**
Classic N+1. (Exactly what made `get_office_kanban` slow back in June.)

**The fix (already applied in the repo):** the `jobs` table already carries denormalized
`customer_first` / `customer_last` / `customer_phone` columns (backfilled + kept fresh by the
`denorm-job-customer` sweep). `get_office_kanban` already reads those instead of looking up the
customer. This change makes `get_office_calendar_week` do the same in **both** job loops:

- Read `$j.customer_first/last/phone` (and `$u.…`) straight off the job row.
- Fall back to `db.get customer` **only when the name is blank** (a brand-new job not yet swept),
  so a name always shows.

Result: ~600 customer round-trips → **~0** on a normal week. Should drop the endpoint from
12–45s to roughly what kanban runs (a couple seconds).

## Deploy (Mac Mini — XS pushes from here, not the Metadata API)
```
cd ~/tn-appliance-tools && git pull origin main
/opt/homebrew/bin/xano workspace push -i "api/**/get_office_calendar_week*" --force
```
Look for **"Pushed 1 documents."** (Ignore any "table does not exist" cache warnings — the push
still lands.) ⚠️ Note from 2026-07-02: this file has been flagged before as hard to push; if the
push errors on a syntax complaint, it'll name the line — send it to me and I'll fix that block.
The change mirrors the working `get_office_kanban` idioms exactly, so it should compile.

## Verify after push
```
curl -s -o /dev/null -w "time:%{time_total}s\n" \
  "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_office_calendar_week"
```
Expect a couple seconds instead of 12–45. Then have Danielle refresh the Schedule tab — it should
load fast, and every job should still show the customer name/phone (the denorm columns).

## Front-end already shipped (band-aid, keep it)
`new-scheduling.html` now auto-retries the load (3 tries, 35s each) so the page stops erroring out
while Xano is slow. That stays as a safety net even after this fix lands.

## If a job ever shows a blank name after this
That job's denorm columns weren't populated. The `denorm-job-customer?action=sweep` cron fills new
jobs every 30 min; a one-off `?action=sweep` run backfills any stragglers. (The fallback db.get
covers it live regardless, so it's cosmetic-only.)

## ✅ DEPLOYED + VERIFIED (2026-08-24)
Pushed live (`Pushed 1 documents … in 3.9s`). Measured after: **~0.9s** (was 12-45s), HTTP 200,
week snaps to Monday, every job carries its customer name off the denorm columns. Done.

## 🐞 THE REAL "unexpected 'id'" ROOT CAUSE (new XS footgun — cost 8 push attempts)
This file had been flagged **unpushable since 2026-07-02** with `Syntax error: unexpected 'id'`.
The error location was a **lie** — the true cause was a **`//` comment sitting INSIDE an object
literal**, wedged between two keys of the `$u_entry` `value = { … }` block:

```
customer_availability_grid: ($u… ?? "")
// Vendor pre-scheduled slot info …      <-- THIS breaks the XS parser
scheduled_start : ($u.scheduled_start ?? null)
```

**XS tolerates `//` comments BETWEEN statements (kanban has them) but NOT inside an object-literal
expression.** When it hits one, it desyncs the object-literal parser and reports the *first* `id`
key it can find (`id : $t.id`) as "unexpected" — so the error points at a spot that is completely
innocent. Removing the in-object comment fixed it instantly.

**How it was finally found (the method that works):** stop guessing at tokens. When one XS file
won't push but a structurally-identical one (here `get_office_kanban`) does, (1) re-push the good
file to confirm the CLI itself works, then (2) diff the bad file against the good one for anything
the good one never does — scan for non-ASCII/em-dashes/tabs, check brace balance, and compare
grammar constructs one by one. The offender is whatever the pushable file never contains.

**Add to the footgun catalog:** NEVER put a `//` comment inside a `value = { … }` object literal.
Put it on the line above the `var $x {`, or between statements. (Also reconfirmed this session:
em-dashes break the parser even inside comments; `$db.field == null` in a where is unsupported;
a bare-variable filter arg `transform_timestamp:$var` is unsupported — use a paren-wrapped literal
or expression like `transform_timestamp:("+" ~ ($n|to_text) ~ " days")`.)

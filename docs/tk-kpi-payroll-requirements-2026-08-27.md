# TK Cousins — "The Appliance Guy" — KPI + Payroll requirements (2026-08-27)

Prospect **TK Cousins** (cell +1 804-334-6984, shop slug `the-appliance-guy`, appliance
trade) is IN on the Ant platform. Trial Ann live (`assistant-d6dc0ea0…`, Brooke voice),
owner cell wired for lead texts. He met Teddy the same day Marcone DMs were in town —
serious operator. His two concerns below are **the sellable core** of the platform, and
both are TN's own needs too. Everything here is **derived from write-once job data** — the
whole point: capture the work once, KPIs + pay fall out, no Workiz/QuickBooks fighting.

## Concern 1 — KPIs "front and center"
He wants his real operating numbers visible at a glance, not buried:
- **First-stop completion rate** — % of jobs fixed on the FIRST visit (no return trip).
- **Machines condemned** — count/% of units called not-worth-fixing (`no_fix_possible`).
- **Callbacks** — return trips to the SAME machine because the first fix didn't hold
  (distinct from a legit new job on the same customer months later).
- "all those specific numbers" — pipeline (scheduled / awaiting-parts / in-progress),
  per-tech breakdowns, warranty vs cash, parts-awaiting aging.

### Proposed metric definitions (confirm with TK before building the board)
- **First-stop completion** = jobs where completed on visit 1 with no return / no
  awaiting-parts second trip ÷ all completed jobs. Signal: a job that went
  `awaiting_parts` → return trip is NOT first-stop.
- **Condemned** = jobs whose disposition is `no_fix_possible` (raw Xano status).
- **Callback** = a NEW job on the SAME unit within N days of a prior completion
  (default N = 30). Same-customer-different-machine or months-later ≠ callback.

### Data reality (grounded 2026-08-27, TN's 811 mirrored jobs)
- ✅ **Now:** repeat-customer rate (132/639 ≈ 21%), pipeline mix, warranty vs cash,
  parts-awaiting — all from the mirrored board data (enriched this session with
  warranty_company / claim_number / parts_status / parts_eta / raw xano_status).
- ⚠️ **Needs the TDR/completion data mirrored too (phase 2):** accurate first-stop % and
  condemned — these live in the TDR disposition + return-trip records, a second Xano
  source beyond the board feed. Don't fake them; bring the data, then show them.

## Concern 2 — Pay handling (replace Workiz + QuickBooks)
TK's shop ran payroll via **QuickBooks through Workiz** and had constant issues. Ant's
answer (already the TN money-system plan): the **invoice is the single source of truth,
entered once** → tech commission, pay-on-collection, and the books all derive from it.
- Platform already has `invoice` + `invoice_line` + office pay fields.
- Commission = % of labor per tech; **pay-on-collection** (tech paid when the job's money
  lands, so a net-30 warranty job doesn't front the tech).
- A tech **pay dashboard** (owed-now / paid / this period) + owner payroll view.
- No re-keying into a separate accounting tool — the thing techs already fill (the job +
  invoice) IS the payroll input.

## Build order (ties into the platform-office-parity roadmap)
1. **Enrich the mirror** with KPI/warranty source fields — ✅ DONE this session
   (warranty_company, claim_number, parts_status, parts_eta, xano_status).
2. **KPI board** (`platform/` surface) — front-and-center: callback rate, pipeline,
   warranty vs cash, parts-awaiting aging, per-tech. First-stop + condemned added once
   the TDR/completion data is mirrored.
3. **Mirror TDR/completion data** → unlocks accurate first-stop % + condemned.
4. **Payroll**: invoice → commission → pay-on-collection; tech pay dashboard + owner view.

## Open decisions (TK/Teddy own these)
- Confirm the three metric definitions above (esp. callback window N, first-stop rule).
- TK's commission structure (% of labor per tech? flat?) — needed for payroll.
- TK's exact shop details (hours, service area, FAQ) to sharpen his Ann + intake.

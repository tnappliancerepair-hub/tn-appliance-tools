# Multiple machines per stop → a TDR per machine (Option B) — plan (2026-07-07)

Teddy (2026-07-07): techs often work **multiple machines at one stop** (esp. AHS
multi-item claims — e.g. Michelle Bond had a dishwasher AND a stove on one job, the
stove buried in the notes with no TDR of its own). Need: **add a machine → it gets
its own TDR**, so multiple machines = multiple TDRs, and Danielle navigates each.
"Many of these daily." Teddy chose **Option B**.

## Option B — linked sibling machines (reuse everything)
Each machine is its own job record, so it gets a full TDR / warranty submission /
parts flow **for free** (the whole app is already per-machine). We just LINK them to
the same stop and present them as ONE tile with a machine switcher.

### Linking (no schema change — event_log marker)
- `stop_machine` event: `{ stop_id, machine_job_id, appliance, added_by, at_ms }`.
- `stop_id` = the ORIGINAL job of the stop (the "primary"). The primary's own job_id
  is the stop_id. Each added machine logs one `stop_machine` linking it to the stop.
- "machines for a stop" given any machine's job_id J:
  - primary = (stop_machine where machine_job_id==J → its stop_id) else J itself.
  - machines = [primary] + [machine_job_id of every stop_machine where stop_id==primary].

### Pieces — STATUS 2026-07-07: shipped to main (Netlify auto-deploy)
1. **`netlify/functions/add-machine.js`** ✅ SHIPPED — POST {parent_job_id, appliance_type,
   brand?, model?, problem?, added_by?}. Reads the parent job (metadata `searchOne` by id),
   CLONES a whitelist of inheritable fields (`CLONE_KEYS`: customer/address/zip/claim/
   warranty/tech/scheduled_start/scheduling_status/dispatch_source_id/access/consent/…),
   sets the new appliance + `channel:'tech_add_machine'`, inserts via the metadata API
   (**side-effect-free — no create_job_from_chat, so NO customer greeting SMS**), logs the
   `stop_machine` link. Resolves the stop_id even when the parent is itself an added machine
   (all siblings share one stop_id). Returns {machine_job_id, stop_id}.
2. **`netlify/functions/get-stop-machines.js`** ✅ SHIPPED — GET ?job_id=<any machine on the
   stop>. Reads recent `stop_machine` markers, resolves the stop_id, returns the machine list
   (primary first) with appliance/brand/model/problem/status/is_primary/has_report per machine.
3. **tech-job.html machine switcher** ✅ SHIPPED — a `#machine-switcher` card UP TOP (right
   under the release banner). Chips `[🍽 Dishwasher ✓][🍳 Stove][＋ Add machine]`; current
   machine highlighted, ✓ = report started. Tapping a chip navigates to that machine's job
   page (each machine IS a job → reuses the whole page + its own TDR). "＋ Add machine" →
   prompt appliance → `add-machine` → opens the new machine. Always shows (even a 1-machine
   stop) so the add affordance is discoverable. CSS `.mchip` added.
4. **Office/Danielle (FOLLOW-ON, not built):** group linked machines under one stop on the
   board + drawer, each machine's TDR navigable for warranty submit. Each machine already
   shows as its own job today; the `stop_machine` link is what lets us group next.
5. **Intake (FOLLOW-ON, not built):** when an AHS multi-item claim lands, auto-create the
   machines from the dispatch (`add-appliance-job.js` is the office-facing seed of this).

### Notes / guardrails
- add-machine is side-effect-free (raw metadata insert → no customer greeting SMS).
- Machines share the claim_number + warranty_company (same AHS claim), each its own TDR.
- Scheduling: machines inherit the parent's tech + day (one visit). They show as linked,
  not as separate stops, once the office grouping lands.

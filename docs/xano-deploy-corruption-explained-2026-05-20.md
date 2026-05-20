# Xano deploy corruption — root cause explained

**Date:** 2026-05-20
**Status:** SOLVED. Not a platform bug. Documented mechanism with avoidance pattern.
**Discovered during:** tech_sms_inbound migration debugging (see `docs/tech-sms-migration-design-onboarding-2026-05-20.md`)
**Supersedes:** `docs/sms-architecture-2026-05-19.md` notes about "Xano XanoScript serializer round-trip stripping `??` and table identifiers"

---

## The mechanism

When you push a XanoScript file (via `xano workspace push` CLI OR via the Xano UI XanoScript editor), Xano's import resolver checks every reference inside the file against:

1. Other documents in the SAME push set, AND
2. Documents that already exist on the server

If a reference cannot be resolved against either source, Xano REPLACES the unresolved reference with a "placeholder statement" during import. **The push still reports success.** The resulting endpoint exists but contains broken stubs in place of the original references.

The CLI surfaces this in its verbose output:

```
=== Unresolved References ===

The following references point to objects that don't exist in this push or on the server.
These will become placeholder statements after import.

  WARNING          query              log_event
                                      db.* → table "event_log" does not exist
```

That's the canonical warning. It looks like an informational "FYI" but it has a destructive consequence: the affected `db.*` block becomes `db.* "" { ... }` in the deployed endpoint. At runtime, calls hit this and throw:

```
{"code":"ERROR_CODE_INPUT_ERROR","message":"Invalid syntax: missing parameter - dbo","payload":{"param":null}}
```

(`dbo` = database object = the missing table reference.)

---

## What gets replaced

Confirmed for table references in:

- `db.query <table> { ... }` → `db.query "" { ... }`
- `db.add <table> { ... }` → `db.add "" { ... }`
- `db.edit <table> { ... }` → `db.edit "" { ... }`

Plausibly affects other reference types (functions, addons, etc.) but only DB-op references observed in the 2026-05-20 incident.

`$db.<table>.<column>` expressions inside `where` clauses are NOT stripped — only the top-level table identifier of the db.* block is replaced. That's why the corrupted endpoint can still hold internally consistent `where` expressions that look fine in code review but blow up at runtime because the table reference itself is gone.

The `??` and `|trim` operator stripping we previously attributed to a "serializer round-trip" — that's a SEPARATE issue (likely a real serializer quirk inside `if(...)` comparison contexts) that has a much smaller blast radius. The catastrophic corruption that broke tech_sms_inbound was the unresolved-references mechanism described here.

---

## Why this is silent in normal use

Most Xano workspaces grow organically through the UI, where every new reference is created in context (you point-and-click an existing table, the editor stores the reference correctly). The unresolved-references path is only exercised when you push a XanoScript file that references things the importer can't trace.

For us, the trigger was that `event_log`, `agent_message`, `technicians`, `agent_conversation`, and `tech_preferences` were all created in the workspace originally — but the import resolver couldn't see them when our pushed file referenced them. We never fully reproduced WHY the resolver couldn't see them (the tables existed at runtime; we wrote rows to them), but the empirical finding is consistent across multiple pushes.

Possible explanations (not verified):

1. Tables created via UI register differently than tables pushed via XanoScript. Resolver may require an XanoScript-side `table` document in the import set to resolve references to the table.
2. Some workspaces have stale resolver state where existing tables aren't indexed.
3. The CLI's `--include` filter excludes table documents from the push set unless explicitly listed, AND the resolver doesn't fall back to server-side tables even when they exist.

Whatever the cause, the practical effect is the same: if you push a file that references a table the importer doesn't recognize, you get silent placeholders.

---

## Reproduction

Minimal:

1. Write any new XanoScript endpoint that does `db.add some_existing_table { ... }`
2. Push with `xano workspace push -i path/to/your_endpoint.xs --sync --force`
3. Pull immediately and grep the live file: `grep 'db.add ""' <pulled file>` → finds your endpoint, table name stripped

Confirmed on 2026-05-20 with:
- `corruption_probe_v1` (15 lines, single `db.query technicians`) → corrupted
- `corruption_probe_v2` (same with `return = list`) → corrupted
- `corruption_probe_v3` (with local var + paren-wrapped where) → corrupted
- `corruption_probe_intake` (same in `intake` api_group) → corrupted
- `log_event` (today's canary, `db.add event_log`) → corrupted (and not even visible in /apigroup/N/api listing — possibly a separate silent-rejection bug compounded on top)
- `tech_sms_inbound` UI paste, May 20 evening → all 59 db.* blocks corrupted

Counter-example: `send_sms_POST.xs` was pushed via UI paste and survived intact. The difference was likely that send_sms was pushed when the workspace was in a state where the resolver could see its referenced tables (technicians) — or that send_sms got lucky with a particular cache hit.

---

## Avoidance patterns

In rough order of safety:

### Pattern 1 — Bypass XanoScript entirely (chosen 2026-05-20)

Use Xano's Metadata API directly from Netlify (or any external caller). Endpoints under `/api:meta/workspace/{id}/table/{table_id}/content` support:

- `GET` — list/filter rows
- `GET /{row_id}` — read one row
- `POST` — insert
- `PATCH /{row_id}` — update
- `DELETE /{row_id}` — delete

No XanoScript involved. No import resolver. No corruption surface. Confirmed working today (the Jimmy preference-recovery + tech_sms_inbound migration both use this path).

Tradeoff: bypasses any Xano business logic baked into endpoints. For greenfield logic that lives in your application code (Netlify, etc.), this is fine. For logic that genuinely needs to run inside Xano (transactional consistency, real-time triggers), you still need XanoScript.

### Pattern 2 — Include all referenced tables in the push set

```bash
xano workspace push -d xano-workspace \
  -i "api/yourgroup/yourendpoint.xs" \
  -i "api/yourgroup/yourgroup.xs" \
  -i "table/event_log.xs" \
  -i "table/agent_message.xs" \
  ... etc for every table referenced \
  --sync --force
```

Caveat: each table you include may itself have FK references that also need to be in the set. This can cascade into needing to push half the workspace. Not all FK targets are in our local pull (e.g. `user`, `account`) so this can be infeasible without an `--include-deps` flag (which the CLI doesn't appear to expose).

### Pattern 3 — Push the whole workspace

```bash
xano workspace push -d xano-workspace --sync --force
```

Fully self-contained. No unresolved references possible if everything that exists locally exists in the push set.

Caveat: HIGH RISK. Overwrites every API group, every endpoint, every table, every function — schema, definitions, the lot. Any change made in the UI since the last `xano workspace pull` is lost. Only safe in a true mono-deploy workflow where the local repo is the unambiguous source of truth.

### Pattern 4 — Manual UI build of new endpoints

Click through the Xano UI to create endpoints by hand. Each block created interactively never goes through the XanoScript import path, so unresolved references can't happen. Slow, doesn't version well, but reliable for one-off small endpoints.

---

## Symptom signatures

Use these when triaging future endpoint failures.

| Signal | Likely cause |
|---|---|
| Runtime error: `ERROR_CODE_INPUT_ERROR "Invalid syntax: missing parameter - dbo"` | Unresolved-references placeholder corruption (this doc) |
| Pulled file shows `db.* "" { ... }` where local has `db.* table_name { ... }` | Same |
| `xano workspace push` verbose output shows `Unresolved References` warning naming a table | Same — about to corrupt or already corrupted |
| Pulled file shows `if (... ? null ...)` where local has `if (... ?? null ...)` | `??` stripped inside `if(...)` comparison — separate, less catastrophic serializer quirk |
| Pulled file shows `(... ? "")` where local has `((... ?? "")\|trim)` | `??` AND `\|trim` both stripped inside `if(...)` — same separate quirk |
| `xano workspace push` reports "Pushed N documents" but endpoint not visible in `/apigroup/X/api` listing AND returns 404 on direct call | Silent create-rejection — different from corruption. Encountered 2026-05-20 with `log_event` canary; not yet root-caused. May be related to warnings during transactional push. |

---

## Cross-references

- `docs/sms-architecture-2026-05-19.md` — original (incorrect) hypothesis that this was a generic serializer bug. Section 8 notes about Twilio failover still valid; the corruption attribution there is superseded by this doc.
- `docs/tech-sms-migration-design-onboarding-2026-05-20.md` — the architecture that bypasses this entire corruption surface via Metadata API direct.
- `docs/tech-sms-migration-inventory-onboarding-2026-05-20.md` — the behavioral source-of-truth being migrated.
- Memory: `reference_xanoscript_serializer_bug.md` — needs amendment to reflect this finding; the `??`/`|trim` stripping was real but a separate issue from the catastrophic table-identifier stripping.
- Memory: `reference_xanoscript_db_query.md` — db.query syntax notes (still accurate).

---

## What to do next time

1. **For any new external-facing logic, default to Pattern 1.** Build it in Netlify, use Metadata API for DB ops. Don't write a new XanoScript endpoint unless you genuinely need Xano-side execution.
2. **If you must write a XanoScript endpoint:** push it under Pattern 2 (explicit table includes) or Pattern 4 (UI build). NEVER push without checking the verbose output for `=== Unresolved References ===`.
3. **After any XanoScript push, ALWAYS:** pull immediately, grep the pulled file for `db.\* ""`, and fail loudly if matches found. Bake this into the deploy script.
4. **If you see the runtime error `Invalid syntax: missing parameter - dbo`**, you have this corruption. Don't waste time on parser theories — go straight to the unresolved-references explanation in this doc.

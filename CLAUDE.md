# Appliance Ant

AI operations platform for **TN Appliance Exchange LLC**. Owner: James "Teddy" Pivacek (tech ID 1, `tnappliancerepair@gmail.com`).

## Infrastructure

- **Xano API base:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA`
- **Netlify site:** `superlative-naiad-233aa7.netlify.app`
- **Metadata API base:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1` (bearer auth via `XANO_METADATA_TOKEN`)

## Tech roster

| ID | Name              | Region |
|----|-------------------|--------|
| 1  | Teddy Pivacek     | TN (Antioch) — owner |
| 2  | Jimmy Pivacek     | South Nashville |
| 3  | Andre Pivacek     | Hammond, LA (dual-state) |
| 4  | Lee Harding       | Clarksville, TN |
| 5  | Billy Savoy       | Hammond, LA |
| 6  | John Houk         | Walker, LA |

## Agent platform

- **17 live agents** today; building toward **379 agents across 20 colonies**.
- New agents land via the `agent_proposals` → human approve → `agent_builder` → `agent_queue` pipeline. See `agent-proposals.html` (Build It button) and `xano-workspace/api/intake/agent_builder_POST.xs`.

## XanoScript rules (fast reference)

Full catalog: `docs/xanoscript-footguns.md`. The hard rules:

- **No em-dashes** anywhere — parser crashes.
- **No try/catch** — XS has no exception handling. `db.get` on null PK / `json_decode` on bad input throw `ERROR_FATAL` and kill the script.
- **No backtick template literals** — use double-quoted strings joined with `~`.
- **`data = { ... }`** for `db.add` and `db.edit` (not `fields =`). Field name is `metadata` (a JSON column) on `event_log`.
- **`??` and `|trim` only inside `value = (...)` assignments** — the UI parse-serialize round-trip silently strips them inside `if(...)` comparisons.
- **Array index:** `|get:N` with literal integer (40+ proven usages). Object key: `|get:$str_var`.
- **First row of paginated query:** `($rows|first ?? null)`. Paginated `db.query` returns `{items: [...]}`, not the array directly.
- **Anthropic response path:** `$resp.response.result.content[0].text` — memorize. Partial paths produce silent empty strings.
- **Strip Sonnet 4.5 markdown fences before `json_decode`:** `($raw|replace:"\`\`\`json":""|replace:"\`\`\`":"")|trim` — `|trim` is mandatory; without it `json_decode` throws on residual whitespace.

## Current priority

**`agent_builder` endpoint returns 500 during Claude-response parsing.** Root cause: the fence-strip chain in `agent_builder_POST.xs` lines 152-158 is missing `|trim`, so `json_decode` throws `ERROR_FATAL: Error parsing JSON: Syntax error` on residual whitespace and the `if ($parsed == null)` guard never fires. Fix is a single-line change to match the canonical pattern in `docs/xanoscript-footguns.md:84-86`. The script lives on Xano (not in this repo) — paste the corrected block via the Xano UI.

## Where to look

- **Architecture + running status:** `docs/system-blueprint-v1.md` (canonical source of truth, two-layer format).
- **Recent decisions:** `docs/session-2026-05-*.md`, `docs/handoff-2026-*.md`.
- **XS gotchas:** `docs/xanoscript-footguns.md`.
- **Live XS schemas (sample):** `docs/xano-schemas/2026-05-15/`.
- **Front-end pages:** root `.html` files; Netlify functions in `netlify/functions/`.

# XanoScript + Xano Integration Footguns

Patterns that have failed silently or fatally in production. Reference when writing or reviewing `.xs` files or designing Xano-side AI agents.

Companion to memory `[[reference_xanoscript_gotchas]]` (older parser-level catalog).  Companion to memory `[[reference_xanoscript_serializer_bug]]` (UI parse-serialize round-trip strips `??` / `|trim` inside `if(...)` comparisons).

---

## 🚨 Xano CLI workspace push silently no-ops on body updates (2026-05-30)

**The single most expensive footgun yet — cost 4 hours yesterday.**

`xano workspace push` (CLI v1.0.1, all modes — default partial, `--sync`, `--sync --force`, `--no-transaction`) reports `"Pushed N documents"` after a `200 OK` POST to `/api:meta/workspace/1/multidoc` — **but the `xanoscript` field is silently dropped server-side**. The metadata API's GET on the same endpoint shows the field as empty bytes. The live serving layer keeps cached bytecode from whatever the last UI paste was; CLI pushes literally do nothing to update behavior.

**Symptoms:**
- CLI reports `Pushed N documents to workspace 1 in X.Xs`
- `xano workspace pull -b v1` shows old code in the local file
- Live API behavior unchanged
- `curl /api:meta/.../api/{id}` GET shows `xanoscript: ""`
- Confirmed across 8+ push attempts on `verify_office_password`, `get_office_kanban`, `create_job_from_email`

**The only working create/edit path is Xano UI paste.** CLI source code (`/opt/homebrew/lib/node_modules/@xano/cli/dist/utils/multidoc-push.js`) has no separate publish step — multidoc IS supposed to be the publish, but the server drops the body for reasons unknown.

**Adjacent failure modes confirmed:**
- Default partial mode (`xano workspace push --force`) → either "No changes to push" or "Pushed N" lie
- `--sync --force` on a NEW endpoint → `400 "Missing valid API Group on query: X"` regardless of `api_group` string
- `PUT /api:meta/workspace/1/apigroup/4/api/{id}` with `xanoscript` field → 200 OK, field dropped
- Branch `-b live` → 404. Branch `-b v1` → "Pushed N" lie (v1 IS live, confirmed via `xano branch list`)

**Workaround:** every XS change goes through Xano UI paste. Stage paste-ready files on Desktop, label them by sequence (`scheduler-1-*.txt` etc), have operator paste in REPLACE or CREATE mode.

**Reproducer** (do NOT use for real updates):
```bash
xano workspace push --sync --force -i "**/<endpoint_name>*" --verbose 2>&1
# Then verify the lie:
mkdir -p /tmp/x && cd /tmp/x && xano workspace pull -b v1
grep -c "<your-new-string>" /tmp/x/api/intake/<endpoint>.xs
# Returns 0 even though CLI said "Pushed 1 documents"
```

---

## 🚨 Xano UI strips `db.add <tablename>` when target table doesn't exist at paste time (2026-05-30)

When you paste XS with `db.add office_session { data = {...} }` into the Xano UI **before** the `office_session` table exists in the workspace, the UI's reference-resolver silently rewrites it to `db.add "" { data = {...} }`. The endpoint saves successfully, but at runtime fails with `ERROR_FATAL "Invalid name: mvpw1:0"` (empty table name lookup).

**Symptom:** endpoint returns HTTP 500 `{"code":"ERROR_FATAL","message":"Invalid name: mvpw1:0"}`. Pulling the source shows `db.add ""` where you pasted `db.add office_session`.

**Why this is sneaky:** the UI doesn't warn you. The save succeeds. The error only surfaces at runtime when someone actually calls the endpoint. By then the original paste is gone.

**Fix:** create the table FIRST (via Metadata API or UI), THEN paste the XS that references it. Order matters. The Metadata API table-create path works fine:
```bash
curl -X POST "https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"office_session","auth":false,"tag":[]}'
```
Then add columns via `/schema/type/{type}`. Then paste the XS.

**Repaste-safe:** if you've already pasted into the broken state, create the table, re-pull source, re-paste the same content — the resolver will now find the table and `db.add ""` becomes `db.add office_session` again.

---

## 🚨 Worker null-job-PK throw — scheduling_queue_worker leaves rows stuck at "processing" (2026-05-30)

**The bug:** at the top of `scheduling_queue_worker.xs` foreach (line 39+), the worker does:
```
db.edit scheduling_queue { ... data = {status: "processing"} } as $claimed

conditional {
  if ($row.job_id != null) {
    db.get jobs {
      field_name = "id"
      field_value = $row.job_id
    } as $job_fetched
    var.update $job { value = $job_fetched }
  }
}

// ... later, dispatch branches read $job.parts_status, $job.cluster, etc.
```

The null-guard at `if ($row.job_id != null)` only checks if the **input ID** is null. If `$row.job_id = 9999999` (or any non-existent ID), `db.get` returns null, `$job` is null, then a later branch reads `$job.parts_status` → throws → foreach dies mid-iteration → row stays at `status="processing"` forever (next tick's pending-rows query excludes processing).

**Reproduced 2026-05-30:** liveness probe inserted row with `job_id=9999999, action_type=broadcast`. Worker grabbed it within 65s. Status stuck at `processing`. Manual delete required.

**Proposed fix** (REVIEW BEFORE PASTE — touches 1454-line file, 7 dispatch branches each reading `$job`):

After the existing `$job` population block (~line 62), insert an orphan-detection block:
```
var $is_orphan_dispatch {
  value = ($row.action_type != "sick_day_cascade" && $row.job_id != null && $job == null)
}

conditional {
  if ($is_orphan_dispatch) {
    var.update $result_notes {
      value = "ORPHAN: queue references missing job_id=" ~ ($row.job_id|to_text)
    }
    var.update $final_status {
      value = "failed"
    }
    db.add event_log {
      data = {
        action: "scheduling_queue_orphan_job_skipped"
        metadata: ("{\"queue_id\":" ~ ($row.id|to_text) ~ ",\"job_id\":" ~ ($row.job_id|to_text) ~ ",\"action_type\":\"" ~ $row.action_type ~ "\"}")
      }
    } as $orphan_log
  }
}
```

Then add `&& $is_orphan_dispatch == false` to the entry condition of each of the 7 dispatch branches (`if ($row.action_type == "broadcast" && $is_orphan_dispatch == false)`, etc.) so they skip cleanly on orphan.

The `sick_day_cascade` exclusion is critical — that action_type legitimately uses null job_id (operates on tech_id from metadata).

**Why we haven't shipped the fix yet:** 7 dispatch branches × 1 condition each + 1 insertion = 8 surgical edits across a 1454-line file. Operator should review the proposed change in-person before paste rather than relying on overnight automation to get it right. Catalogued here for next session's first action.

---

## ai.agent.run result accessor — `.result`, not `.response`

**Pattern:**
```xanoscript
ai.agent.run my_agent {
  args = {...}
  allow_tool_execution = false
} as $ai_result

var $output {
  value = $ai_result.result      // ← canonical accessor
}
```

**The gotcha:** `$ai_result.response` looks intuitive (mirrors HTTP response shape) but does not exist on the agent result object. Accessing it raises `ERROR_FATAL: Unable to locate var: ai_result.response`.

**Where the canonical accessor is verified:** `xano-workspace/api/authentication/demo_agent/conversation_POST.xs:87` — Xano's own stock demo agent uses `$Simple_Agent1.result`.

**Why this matters:** the wrong accessor can sit latent in code for weeks if the agent branch isn't reached. Hit live 2026-05-20 in `feedback_reply_webhook_POST.xs` — the bad `.response` accessor had been there since the file was written but was masked behind a separate filter bug that prevented any test traffic from reaching the agent call.

**Full result shape (captured via DIAG log on 2026-05-20):**
```json
{
  "result": "<the text the LLM emitted>",
  "steps": [ { "usage": {...}, "content": [{"text": "...", "type": "text"}], ... } ],
  "usage": { "inputTokens": ..., "outputTokens": ..., "totalTokens": ... },
  "toolCalls": [],
  "totalUsage": { ... },
  "finishReason": "stop",
  "providerMetadata": { "anthropic": { "usage": {...}, ... } },
  "reasoningDetails": []
}
```

---

## Sonnet 4.5 wraps JSON in markdown fences (even when prompted not to)

**Pattern (broken):**
```xanoscript
ai.agent.run feedback_classifier {
  args = {body: $input.Body}
  allow_tool_execution = false
} as $ai_result

var $classification {
  value = $ai_result.result|json_decode    // ← throws "Error parsing JSON: Syntax error"
}
```

**The gotcha:** Even with a system prompt that explicitly says:
> Return JSON only — no explanation, no preamble. Never return anything other than the JSON object.

Sonnet 4.5 (`claude-sonnet-4-5-20250929`) frequently wraps its response in markdown fences:
````
```json
{
  "feedback_type": "positive"
}
```
````

The `\`\`\`json` and `\`\`\`` prefix/suffix breaks `json_decode` even though the JSON itself is correct. Disabling `reasoning` on the agent definition does **not** stop the wrapping — verified live 2026-05-20.

**Canonical fix — strip fences before decode:**
```xanoscript
ai.agent.run my_agent {
  args = {...}
  allow_tool_execution = false
} as $ai_result

var $raw_result {
  value = $ai_result.result ?? ""
}

var $cleaned_result {
  value = ($raw_result|replace:"```json":""|replace:"```":"")|trim
}

var $classification {
  value = $cleaned_result|json_decode
}
```

The `|replace:"\`\`\`json":""` pass handles the `\`\`\`json` opening fence. The follow-up `|replace:"\`\`\`":""` handles the closing fence and any non-language-labeled `\`\`\`` opener. `|trim` cleans residual whitespace/newlines. Order matters: do `\`\`\`json` first so it doesn't get partially-consumed by the `\`\`\`` pass.

**Why the `??` and the assignment-context placement matter:** Per memory `[[reference_xanoscript_serializer_bug]]`, the Xano UI's parse-serialize round-trip strips `??` and `|trim` inside `if(...)` comparisons but preserves them inside `value = (...)` assignments. The pattern above is entirely in assignment context, so it survives the round-trip cleanly. Verified on 2026-05-20 paste cycle.

**Cite:** Verified end-to-end via the verification sweep in `docs/session-2026-05-20-feedback-chain-verification.md`. The diagnostic log capture that proved the wrapping is at `event_log id=40420 action=feedback_classifier_raw`.

---

## DIAG logging pattern — capture upstream value before a throwing expression

When an `ERROR_FATAL` in an expression makes you blind to what's actually upstream (e.g., `json_decode` throws on an unknown shape, or a `|filter:` blows up on an unexpected type), insert an event_log write BEFORE the failing line. The log captures both:
- the literal value with a fallback so you see `<MISSING>` instead of throwing again
- the full upstream object so you discover missing keys vs. unexpected shapes

```xanoscript
// DIAG-<NAME> 2026-05-DD — REMOVE after <thing> verified.
db.add event_log {
  data = {
    action  : "<diagnostic_name>"
    metadata: {
      upstream_full : $upstream_var
      value_attempt : ($upstream_var.field ?? "<MISSING-field>")
      strlen_probe  : (($upstream_var.field ?? "")|strlen)
      input_echo    : $input.RelevantField
    }
  }
} as $diag_log
```

**Why this works:** XanoScript writes the event_log row before evaluating the next statement, so even if the next line throws, the log is durable. Pull with the Metadata API search endpoint filtering on the action name.

**Removal discipline:** The `// DIAG-… REMOVE` comment is the anchor — every diag block needs one with a date so it doesn't survive past its useful window. Per memory `[[feedback_diagnostic_code_authorization]]`, diagnostic additions are allowed even under "no code changes" framing if explicitly diagnostic-scoped and marked for removal.

---

## CRITICAL: Metadata API cannot deploy XanoScript

**The trap that consumed 3 days of `agent_builder` debugging.** The Xano Metadata API accepts an `xanoscript` field on endpoint creation, returns 200 OK, but **silently drops the field**. No error, no warning. The endpoint is created as an empty shell with `input: []`, no stack, and any call to it returns `null` with HTTP 200.

**Confirmed broken (2026-05-24):** all 9 attempted paths to deploy XS via Metadata API:

| # | Method | Path | Result |
|---|---|---|---|
| 1 | POST | `/apigroup/{ag}/api` with `{...xanoscript:"..."}` | 200, xs dropped |
| 2 | PUT | `/apigroup/{ag}/api/{id}` with `{...xanoscript:"..."}` | 200, xs dropped |
| 3 | PUT | `/apigroup/{ag}/api/{id}` with `{xanoscript:"..."}` only | 400 missing `name` |
| 4 | PATCH | `/apigroup/{ag}/api/{id}` with `{xanoscript:"..."}` | 404 |
| 5 | POST | `/apigroup/{ag}/api/{id}/xanoscript` | 404 |
| 6 | POST | `/apigroup/{ag}/api/{id}/draft` | 404 |
| 7 | POST | `/apigroup/{ag}/api/{id}/spec` | 404 |
| 8 | POST | `/apigroup/{ag}/api/{id}/source` | 404 |
| 9 | POST | `/apigroup/{ag}/api/{id}/publish` | 404 |

Other tried-and-404'd: `/script`, `/yaml`, `PUT /script`, `POST /api-import`, `POST /workspace/1/xs/api`, `POST /workspace/1/import`, `POST /workspace/1/release`.

**Read-side confirmation:** `GET /apigroup/{ag}/api/{id}` always returns `xanoscript: null` even for known-working endpoints like `qc_cockpit_load` (id 391). The XS source is **write-only** via Metadata API in the sense that it can't be read back — and apparently can't be written either.

**The ONLY working XS-deploy paths:**

1. **Xano UI paste.** Open Xano dashboard → API tab → endpoint → switch to XanoScript mode → paste → Save → Publish.
2. **`xano workspace push <file>` via the Xano CLI** on the Mac Mini, against a local `xano-workspace/` mirror. Setup in `docs/mac-mini-setup-checklist.md` §3.5.

**The agent_builder backstory:** `xano-workspace/api/intake/agent_builder_POST.xs` POSTs to `/apigroup/4/api` with the Claude-generated XS in the `xanoscript` field. Even when the XS is parseable and Claude emits clean output, the deploy is a no-op. Endpoints get created (`/agent_proposals → Build It` button claims success), but calling them returns null. The 500s from `mark_signal_processed` and similar were a downstream symptom of "XS body never made it to Xano." Per the architecture pivot, **retire `agent_builder` — do not try to fix it.**

**Working rule** (also pinned in CLAUDE.md Working Rule 7): never attempt XS deploy via Metadata API. Use UI paste or CLI push.

---

## Metadata API: add-column endpoint is `/schema/type/{type}`, not the obvious alternatives

**Pattern (working):**
```bash
curl -X POST \
  "https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/{table_id}/schema/type/text" \
  -H "Authorization: Bearer $XANO_METADATA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my_col","description":"...","nullable":false,"default":"","required":true}'
```

Replace `text` with `int`, `timestamp`, `bool`, `decimal`, `json`, `email`, `enum`, etc. — the data type goes in the URL path, the column metadata in the body. 200 returns `{"name":"my_col"}`.

**The gotcha:** Three plausible-looking alternatives all 404:

| Endpoint | Result |
|---|---|
| `POST /table/{id}/schema/text` (type as path segment, no `/type/`) | 404 `ERROR_CODE_NOT_FOUND` |
| `POST /table/{id}/column` (REST-style) | 404 `ERROR_CODE_NOT_FOUND` |
| `PUT /table/{id}/schema` (full-schema replace, body `{schema:[...]}`) | 400 `"First schema entry must be the Primary key."` — would need the full existing schema including auto-managed `id`/`created_at`, so it's effectively a foot-gun |

Only `/schema/type/{type}` works for incremental column adds. Discovered 2026-05-24 while creating `colony_signals` (table id 38).

**Table creation flow:** `POST /api:meta/workspace/{w}/table` with `{name, description, docs, auth, tag}` returns the table with auto-created `id` + `created_at`. Then loop the `/schema/type/{type}` endpoint once per custom column. Two-step is the documented path; there's no known one-shot "create with full schema" endpoint that works.

---

## CLI push: five quoting / expression footguns from the colony-loop deploy (2026-05-24)

Five distinct parser failures hit during a single `xano workspace push` session deploying the 5 colony-loop intake endpoints. All produce parse-time or run-time `ERROR_FATAL` with messages that don't point at the real fix. Memorize the working forms.

### 1. `sort` direction must be a quoted string

**Broken:**
```xanoscript
sort = {colony_signals.created_at: desc}
```
CLI rejects at parse: `Syntax error... 'db.query colony_signals {' - Invalid kind for sort - assign:expr`.

**Working:**
```xanoscript
sort = {colony_signals.created_at: "desc"}
```
The direction is a string literal, not a bare identifier. Same for `"asc"`. Confirmed by grepping ~20 working examples in `api/` — all quoted.

**Multi-key sort unproven:** `{a: "desc", b: "asc"}` was attempted with the same `Invalid kind for sort - assign:expr` error. Until a known-working multi-key example is found, use a single sort key.

### 2. `return = {type: list}` must be `return = {type: "list"}`

**Broken:** `return = {type: list, paging: {...}}` — same `Invalid kind for sort` parse error (the error message is misleading; the actual offender is the unquoted `type` value on the next line).

**Working:** `return = {type: "list", paging: {page: 1, per_page: N}}`. Also `"single"` and `"count"`. Every working example in `api/` quotes the type. The pattern in `[[reference_xanoscript_gotchas]]` "treat all enum-like config values as strings" applies here.

### 3. `|first ?? null` is parsed as a single filter name

**Broken:**
```xanoscript
value = ($rows.items|first ?? null)
```
Run-time `ERROR_FATAL: Unable to locate func entry: first ?? null` — the parser concatenated `first ?? null` into one filter identifier and then failed to look it up.

**Working — wrap the filter result in parens before `??`:**
```xanoscript
value = (($rows.items|first) ?? null)
```
Note this is the assignment-context safe form per `[[reference_xanoscript_serializer_bug]]`. The CLAUDE.md fast-reference line "First row of paginated query: `($rows|first ?? null)`" is **wrong** — keep this entry as the canonical form.

### 4. `now` is a datetime; arithmetic needs `now|to_ms`

**Broken:**
```xanoscript
value = (now - 86400000)
```
Run-time `ERROR_FATAL: Not numeric.` — `now` returns a datetime value, and subtracting an integer from it isn't defined.

**Working — convert to ms first:**
```xanoscript
value = ((now|to_ms) - 86400000)
```
For "now minus N days" comparing against an ms-epoch column like `event_log.created_at` (stored as ms — verified: `1779655182506` came back from `get_pending_colony_signals`). The other valid form is `now|transform_timestamp:"-24 hours"` when comparing against a datetime column.

### 5. CLI "table does not exist" warnings are stale-cache noise

When `xano workspace push` prints:
```
=== Unresolved References ===
  WARNING  query  my_endpoint  db.* → table "colony_signals" does not exist
```
…this is **the CLI's local schema cache being out of date**, not a real schema gap. The push proceeds and the endpoint runs fine against the live table.

**How to confirm the table is actually live:** hit any endpoint that reads/writes it via the public API — a successful response (e.g., `{"success":true,"signal_id":1}`) proves the table exists server-side. Ignore the warning once confirmed.

**Do not** chase these warnings by trying to re-create the table via Metadata API — you'll hit "table already exists" and waste a cycle. If the push itself succeeds (`Pushed N documents`), the deploy is real.

---

## See also

- Memory `[[reference_xanoscript_gotchas]]` — parser-level breakers, silent-drops, env-in-URL pitfall, no while-loop.
- Memory `[[reference_xanoscript_serializer_bug]]` — UI parse-serialize round-trip strips `??` and `|trim` in `if(...)` comparisons but preserves them in `value =` assignments.
- Memory `[[reference_xanoscript_db_query]]` — `$db.<table>.<col>` expressions in `where` clauses; SQL `?` placeholders and `params` arrays do NOT parse.
- `docs/xano-deploy-corruption-explained-2026-05-20.md` — placeholder-on-unresolved-reference behavior in `xano workspace push`.
- `docs/session-2026-05-20-feedback-chain-verification.md` — the 4-bug discovery session where the two top patterns in this file were validated live.

---

## `|replace` on `db.query` result fields silently no-ops — substring scans need the right encoding (2026-05-27)

**Pattern (the BROKEN form that bit us 3 times in one day):**
```xanoscript
db.query event_log {
  where  = $db.event_log.action == "tech_sms_tdr_saved"
  return = {type: "list", paging: {page: 1, per_page: 50}}
} as $rows

foreach ($rows.items) {
  each as $r {
    var $meta_raw { value = ($r.metadata ?? "") }
    var $needle { value = "\"job_id\":" ~ ($jid|to_text) }
    var $strip { value = $meta_raw|replace:$needle:"" }
    conditional {
      if (($meta_raw|strlen) > ($strip|strlen)) {
        // substring found → take action
      }
    }
  }
}
```

**The gotcha:** `db.query` returns object/json-type columns as *objects*, not strings. `|replace` on a raw object is a silent no-op — `$strip` is the same object as `$meta_raw`, so `strlen` is identical and the comparison NEVER trips true. Every job classifies as "no match" → false negative on every loop iteration.

**The fix depends on how the column is stored:**

| Column type | What `db.query` returns | Correct encoding |
|---|---|---|
| `json` column (e.g. `event_log.metadata`) | object | `\|json_encode` first, then `\|replace` |
| `text` column holding JSON (e.g. `colony_signals.payload`) | text string already | use raw, do NOT `\|json_encode` (that wraps in outer quotes and breaks the needle) |

**The CORRECT form for `event_log.metadata`:**
```xanoscript
var $meta_raw { value = ($r.metadata ?? "")|json_encode }
var $strip { value = $meta_raw|replace:$needle:"" }
```

**The CORRECT form for `colony_signals.payload`:**
```xanoscript
var $payload_str { value = ($r.payload ?? "") }  // already a string
var $strip { value = $payload_str|replace:$needle:"" }
```

**Where it bit us on 2026-05-27 (single session, three different endpoints):**
1. `tech_sms_assist_POST.xs` parallel-mode scope guard (event_log.metadata) — caused 100% false negatives → tech_sms_assist returned `not_parallel_mode_job` on every legit job → fallthrough to broken legacy `tech_sms_inbound` → "yo, my brain glitched" fallback SMS to every tech. **Two-hour debug to find.**
2. `count_pending_signals_for_job_GET.xs` (colony_signals.payload) — used wrong direction (added `|json_encode` when it shouldn't have) → endpoint returned `pending_count=0` for known-duplicate jobs → dedup never fired.
3. `tech_sms_assist_POST.xs` TDR-already-saved dedup (event_log.metadata) — same root cause as #1, manifested as duplicate "TDR saved" SMSes to Teddy on every smoke test of an already-completed test job.

**Why this is insidious:** the code reads fine. The query returns rows. The needle is constructed correctly. There's no error, no warning, just a silent false answer. The only way to catch it is to write a debug endpoint that returns the `|json_encode`-d value of the column AND your own substring check result on the same row, then compare.

**Cardinal rule:** any substring scan against a column from `db.query`, write a smoke test that gives a KNOWN positive case. If the smoke returns 0 hits when you can see the substring in the column with your own eyes, you have this bug.

---

## XS input type for arrays is `json?`, NOT `list?` (2026-05-27)

**Broken:**
```xanoscript
input {
  text phone
  list? media_urls?      // ← parser dies: "Syntax error: unexpected 'list?'"
}
```

**Correct:**
```xanoscript
input {
  text phone
  json? media_urls?      // accepts both arrays and objects
}
```

Referenced in: `tech_sms_assist_POST.xs` (MMS media URLs for Claude vision).

## XS has no `else` clause (2026-06-01)

`} else {` inside a `conditional { if (...) { ... } }` block fails with a vague `Syntax error: unexpected '{'`. There's no `else` keyword in XS — structure as **two separate conditionals**.

**Wrong:**
```xanoscript
conditional {
  if ($matched_id > 0) {
    db.edit warranty_submissions { ... }
  } else {
    db.add warranty_submissions { ... }   // ← "unexpected '{'"
  }
}
```

**Correct:**
```xanoscript
conditional {
  if ($matched_id > 0) {
    db.edit warranty_submissions { ... }
  }
}

conditional {
  if ($matched_id == 0) {
    db.add warranty_submissions { ... }
  }
}
```

Caught when building `record_warranty_submission_POST.xs` upsert logic.

## Inline `//` comments after input declarations break parsing (2026-06-01)

XS parser tolerates `//` comments on their own lines, but NOT trailing-after-statement inside an `input { ... }` block. The trailing slashes get eaten as part of the type expression on the NEXT line.

**Wrong:**
```xanoscript
input {
  text? status?              // submitted | failed | paid | denied
  text? submission_method?   // api | playwright | manual
  decimal? paid_amount?
}
```

Dies with `Syntax error: unexpected '?paid_amount?'` — parser was still consuming the `// ...` from the previous line.

**Correct:** move comments to their own lines above each input, or omit them.

## `signal.payload` is the parsed object — `signal.payload_obj` is a phantom (2026-06-01)

`colony-loop/dispatch.js` parses the raw JSON payload string and **replaces** `signal.payload` with the parsed object before calling `mod.run(signal, ctx)`. Some older agents read `signal.payload_obj` — that field doesn't exist; reads silently return `undefined`.

**Symptom:** agent dispatches (event_log shows `signal_dispatched`), no error, but every dedup query says `handled: false`, no SMS landed, no agent log line. The agent went through its skip path with `job_id: 0`.

**Diagnostic:** when an agent looks like it dispatched but did nothing, run it standalone via `node --input-type=module` with a hand-crafted ctx — the throw or skip path becomes obvious.

**Correct read:**
```javascript
export async function run(signal, ctx) {
  const payload = (signal && typeof signal.payload === 'object' && signal.payload) || {};
  const jobId = Number(payload.job_id || 0);
}
```

## `jobs.ahs_claim_number` is a phantom column — actual column is `claim_number` (2026-06-01)

Multiple endpoints reference `$job.ahs_claim_number ?? ""` — the column does not exist. The `??` fallback silently returns `""` forever, so the bug only surfaces when you try to use the column in a `where` clause (which throws `Unsupported parameter reference - ahs_claim_number`).

Affected files (grep `ahs_claim_number`):
- `api/intake/get_office_today_GET.xs` (multiple occurrences)
- Possibly others — sweep on the next refactor

**Correct column:** `claim_number`. Real claims live there (job 18537 has `claim_number = "49135689"`).

Caught when `find_job_by_claim_number_GET.xs` 400'd on the `where` clause.

## Loop module cache requires kickstart for NEW agents — hot-reload only works for EDITS (2026-06-01)

`colony-loop/dispatch.js` imports `AGENT_REGISTRY` from `./agents/registry.js` **once at process start**. New entries added (via `node scripts/build-registry.js`) are NOT picked up by a running loop — the running loop still has the old in-memory map.

Symptom: brand-new agent dispatches as `signal_no_agent_yet` even though the file + registry entry both exist on disk.

**Fix:** `launchctl kickstart -k gui/$(id -u)/com.tnappliance.colony-loop`

For **edits** to existing agents, hot-reload via mtime DOES work — dispatch.js statSyncs the file and re-imports if mtime changed. Kickstart is only required when adding a brand-new agent type.

## Six field-surfaced footguns (2026-06-11)

A day of field-testing surfaced six bugs, several of which had silently shipped broken endpoints that crashed only when first called. Catalogued so the architect + future sessions stop reintroducing them.

### 1. `|trim != ""` (and `|trim == "x"`) must wrap the filter in parens
`precondition (($input.x ?? "")|trim != "")` throws **"Invalid syntax. Please wrap your filter with parentheses."** The parser reads `|trim != ""` as one filter token. This crashed ~13 endpoints (incl. `create_job_from_call`, `voice_search_parts`, `dispatch_voice_call`) that were never exercised until a real call hit them.
- **Wrong:** `(($input.x ?? "")|trim != "")`
- **Right:** `((($input.x ?? "")|trim) != "")`  ← wrap the filtered value, THEN compare
- Or pre-bind: `var $x_clean { value = ($input.x ?? "")|trim }` then `precondition ($x_clean != "")`.

### 2. `error_type = "unauth"` is not a valid error type
Throws **"Input 'unauth' is not one of the allowable values."** when the precondition fires. Valid values seen in working code: `inputerror`, `notfound`, `accessdenied`, `permissiondenied`. Use **`accessdenied`** for auth failures.

### 3. `|right:N` is not a filter — use `|substr:-N:N`
`$phone|right:4` throws (only ever used in the 4 blackout endpoints, all broken). The proven last-N-chars idiom is `$phone|substr:-4:4` (negative start is supported — used live in `customer_mark_parts_arrived`, `record_vapi_voicemail`).

### 4. `rand:N` is not a proven filter
`(rand:1000)` for an id suffix is unproven and was crashing `add_customer_blackout`. A `(now|to_ms)|to_text` timestamp is unique enough for per-row ids; drop the rand.

### 5. `|to_lowercase` — prefer `|to_lower`
`|to_lower` is the dominant proven form (32 files) vs `|to_lowercase` (6). Use `|to_lower`.

### 6. Flooding the single-threaded loop with slow agents SATURATES it
Not XS — colony-loop JS. Activating the full agent fleet (546, incl. ~53 `SCOUT_REQUEST_*` agents) wedged the dispatch loop: heartbeat went stale, backlog climbed, **nothing** processed (core greeting/confirmation/waiver agents starved too). Reverting to the proven-healthy registry (scouts → `no_agent`, instant skip) recovered it immediately.
- Root cause was NOT a hung fetch — the scouts don't fetch external sites, they call `claude.callClaude` (which already has an AbortController timeout). It was **saturation**: dispatch is single-threaded and sequential, so dozens of agents each making a multi-second Claude call back the queue up for many minutes and stall the heartbeat.
- **Hard rule:** batch / Claude-heavy / research agents must be **throttled** (drip a few per tick, schedule off-peak, or run on-demand) — never let dozens fire at once into the same loop that serves customer-facing signals. A saturated loop is worse than dormant agents.
- Still keep `AbortController` timeouts on any agent `fetch()` (defense in depth), but the loop-killer here was volume × latency, not a hang.

### Bonus (not XS): the customer-SMS gate was leaky
`CUSTOMER_FACING_ENABLED` only governs sends that route through `send_sms`. `send_feedback_sms` and `tech_assist_chat` were calling Twilio directly, bypassing the gate (and Telnyx-primary). Rule: **every customer-facing send goes through `send_sms`** so the master gate + test allowlist + carrier preference apply in one place.

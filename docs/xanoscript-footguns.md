# XanoScript + Xano Integration Footguns

Patterns that have failed silently or fatally in production. Reference when writing or reviewing `.xs` files or designing Xano-side AI agents.

Companion to memory `[[reference_xanoscript_gotchas]]` (older parser-level catalog).  Companion to memory `[[reference_xanoscript_serializer_bug]]` (UI parse-serialize round-trip strips `??` / `|trim` inside `if(...)` comparisons).

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

## See also

- Memory `[[reference_xanoscript_gotchas]]` — parser-level breakers, silent-drops, env-in-URL pitfall, no while-loop.
- Memory `[[reference_xanoscript_serializer_bug]]` — UI parse-serialize round-trip strips `??` and `|trim` in `if(...)` comparisons but preserves them in `value =` assignments.
- Memory `[[reference_xanoscript_db_query]]` — `$db.<table>.<col>` expressions in `where` clauses; SQL `?` placeholders and `params` arrays do NOT parse.
- `docs/xano-deploy-corruption-explained-2026-05-20.md` — placeholder-on-unresolved-reference behavior in `xano workspace push`.
- `docs/session-2026-05-20-feedback-chain-verification.md` — the 4-bug discovery session where the two top patterns in this file were validated live.

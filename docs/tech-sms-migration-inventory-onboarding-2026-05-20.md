# tech_sms_inbound — onboarding-mode inventory

**Source:** `xano-workspace/api/scheduling/tech_sms_inbound_POST.xs` (2142 lines)
**Scope:** the shared scaffolding (lines 1–129, 2117–2141) + the onboarding-mode branch only (lines 138–455). Daily mode (lines 457+) is OUT OF SCOPE for the today's migration.

---

## 1. Endpoint signature

```
query tech_sms_inbound verb=POST {
  api_group = "scheduling"
  input {
    text phone filters=trim
    text body filters=trim
    text? sid?
    text? to?
  }
  ...
  response = null            // body returned by `return { value = {...} }` inside stack
  guid = "18gHz_EWoLHGe79tzs5DgPk0TAQ"
}
```

Returns `{ reply: "..." }`. Caller is `netlify/functions/tech-sms-inbound.js`, which then either inlines the reply as TwiML (Twilio path) or POSTs it to `send_sms` (Telnyx path).

---

## 2. All db.* calls in the onboarding code path

Lines listed against the current local file (post-Fix 1/2/3 patches).

### Shared scaffolding (runs every turn, both modes)

| Line | Op | Table | Fields / Where | Notes |
|---|---|---|---|---|
| 31 | `db.query` | `technicians` | `where: phone == $input.phone` · `return: single` | Exact-match phone lookup. |
| 51 | `db.query` | `technicians` | `where: active == true && (phone == $input.phone OR phone == $input_bare)` · `return: single` | Fallback: strips `+1` prefix; matches either form. Only runs if exact match missed. |
| 86 | `db.query` | `agent_conversation` | `where: tech_id == $tech.id && channel == "sms"` · `sort: created_at desc` · `return: single` | Existing-conversation lookup. |
| 104 | `db.add` | `agent_conversation` | `data: {tech_id, channel:"sms", title:"Tech SMS", last_message_at:now, session_id:"tech_{id}_{ms}"}` | Only runs if no existing conv. session_id format: `tech_<id>_<unix_ms>`. |
| 123 | `db.add` | `agent_message` | `data: {conversation_id, role:"user", content:$input.body}` | Persists the user's incoming turn. ALWAYS runs (before Anthropic call). |
| 2119 | `db.add` | `agent_message` | `data: {conversation_id, role:"assistant", content:$reply_to_send}` | Persists the outgoing reply. ALWAYS runs. |
| 2127 | `db.edit` | `agent_conversation` | `field_name="id" field_value=$conversation.id` · `data: {last_message_at: now}` | Bumps conversation timestamp. ALWAYS runs. |

### Onboarding-mode-specific

| Line | Op | Table | Fields / Where | Trigger |
|---|---|---|---|---|
| 143 | `db.query` | `agent_message` | `where: conversation_id == $conversation.id` · `sort: created_at desc` · `return: list page=1 per_page=20` | Always (build Claude history). Reversed in-memory to chronological. |
| 230 | `db.add` | `event_log` | `data: {action:"tech_sms_inbound_claude_error", metadata: {tech_id, conversation_id, status, error_body, user_message_preview, mode:"onboarding"}}` | Fix 2: Anthropic returned non-2xx. |
| 275 | `db.edit` | `technicians` | `field_name="id" field_value=$tech.id` · `data: {preferred_hours_start, preferred_hours_end}` | `__SET_HOURS__` token fired with valid JSON. |
| 309 | `db.edit` | `technicians` | `field_name="id" field_value=$tech.id` · `data: {daily_summary_time}` | `__SET_SUMMARY_TIME__` token fired. |
| 340 | `db.edit` | `technicians` | `field_name="id" field_value=$tech.id` · `data: {personal_context}` | `__SET_PERSONAL_CONTEXT__` token fired. |
| 382 | `db.add` | `tech_preferences` | `data: {tech_id, preference_type, zip_or_area, day_of_week, time_window_start, time_window_end, strength, source(default "explicit"), captured_via_text, active:true}` | `__ADD_PREFERENCE__` token fired. Runs ONCE per paired block in the reply (Fix 3 multi-fire). |
| 419 | `db.edit` | `technicians` | `field_name="id" field_value=$tech.id` · `data: {onboarding_completed_at: now}` | `__ONBOARDING_DONE__` token fired (bare token, no JSON body). |

### Early-return path (no DB writes)

| Line | Op | Description |
|---|---|---|
| 70 | `return` | `{ reply: "this number isn't recognized as a tech. if you meant to text the company line about service, call 866-268-0111." }` — only when phone lookup misses entirely. |

---

## 3. Anthropic API call shape

Lines 165–182:

```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: $env.ANTHROPIC_API_KEY
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
  model:      "claude-sonnet-4-5-20250929"
  max_tokens: 1024
  system:     $env.ANT_TECH_ONBOARDING_PROMPT
  messages:   [{ role, content }, ...]   // last 20 messages, chronological
Timeout: 8s
```

**Env vars referenced:**
- `ANT_TECH_ONBOARDING_PROMPT` — the system prompt (large; defines Ant's voice, the 5 tokens, the 4-question onboarding flow)
- `ANTHROPIC_API_KEY` — already present on Netlify (used by `claude-proxy.js`)

**Model note:** `claude-sonnet-4-5-20250929` is an older model snapshot. Per memory, the most recent Claude family is 4.x with current model IDs `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. We should preserve the existing model ID during migration to keep behavior identical — model swap is a separate decision.

---

## 4. All 5 onboarding tokens (full format spec)

All tokens are PAIRED form: `__TOKEN__{JSON body}__TOKEN__` except `__ONBOARDING_DONE__` which is bare.

### 4.1 `__SET_HOURS__`

| | |
|---|---|
| **Format** | `__SET_HOURS__{"start":"HH:MM","end":"HH:MM"}__SET_HOURS__` |
| **JSON keys** | `start` (text, HH:MM 24h) · `end` (text, HH:MM 24h) |
| **Side effect** | `db.edit technicians data={preferred_hours_start: data.start, preferred_hours_end: data.end}` |
| **Reply cleanup** | regex strip `__SET_HOURS__[\\s\\S]*?__SET_HOURS__` from `clean_reply` |
| **Multi-fire** | NO (single-shot — only first paired block parsed) |

### 4.2 `__SET_SUMMARY_TIME__`

| | |
|---|---|
| **Format** | `__SET_SUMMARY_TIME__{"time":"HH:MM"}__SET_SUMMARY_TIME__` |
| **JSON keys** | `time` (text, HH:MM 24h, intended Central Time per Ant Tech Scheduler design) |
| **Side effect** | `db.edit technicians data={daily_summary_time: data.time}` |
| **Reply cleanup** | regex strip |
| **Multi-fire** | NO |

### 4.3 `__SET_PERSONAL_CONTEXT__`

| | |
|---|---|
| **Format** | `__SET_PERSONAL_CONTEXT__{"text":"..."}__SET_PERSONAL_CONTEXT__` |
| **JSON keys** | `text` (text, free-form personal context) |
| **Side effect** | `db.edit technicians data={personal_context: data.text}` |
| **Reply cleanup** | regex strip |
| **Multi-fire** | NO |

### 4.4 `__ADD_PREFERENCE__`

| | |
|---|---|
| **Format** | `__ADD_PREFERENCE__{...}__ADD_PREFERENCE__` (may appear multiple times in one reply) |
| **JSON keys** | `preference_type` · `zip_or_area?` · `day_of_week?` · `time_window_start?` · `time_window_end?` · `strength` ("hard"/"soft") · `source?` (default "explicit") · `captured_via_text?` |
| **Side effect** | `db.add tech_preferences data={tech_id, preference_type, zip_or_area, day_of_week, time_window_start, time_window_end, strength, source(default explicit), captured_via_text, active:true}` |
| **Reply cleanup** | regex strip (global — removes ALL paired blocks) |
| **Multi-fire** | YES — Fix 3. Iterate every paired block via odd-index toggle. |

### 4.5 `__ONBOARDING_DONE__`

| | |
|---|---|
| **Format** | bare token, no JSON body |
| **JSON keys** | n/a |
| **Side effect** | `db.edit technicians data={onboarding_completed_at: now}` |
| **Reply cleanup** | string replace `__ONBOARDING_DONE__` → `""` (regex not needed) |
| **Multi-fire** | n/a (idempotent — same timestamp behavior either way) |

---

## 5. Fix 1, 2, 3 behavior (locked-in semantics)

### Fix 1 — empty-reply guard (lines 444–450)

After token strip + trim, if `$clean_reply.length == 0` → substitute `"got it."`.

Reason: when Claude responds with only action tokens (no natural-language text), the strip leaves an empty string. Empty string persisted to `agent_message` poisons the next Claude call (Anthropic rejects empty assistant content with 400).

### Fix 2 — defensive Anthropic response access (lines 184–248)

Before reading `.content[0].text`:
1. Check `response.status` is in `[200, 300)`. If yes:
   - Walk `result → content → content[0]` defensively (count check before index)
   - Extract `.text` with `?? ""` fallback at the assignment level (NOT in the if-condition)
2. If response.status outside 2xx:
   - Write `event_log` row with `action="tech_sms_inbound_claude_error"`, metadata including `tech_id`, `conversation_id`, `status`, raw `error_body`, `user_message_preview`, `mode:"onboarding"`
   - Substitute `$reply_text = "hey, signal hiccup on my end. text that again in a sec?"`

Reason: bare `result.content[0].text` accessor crashes ERROR_FATAL when Anthropic returns an error body (which has no `content` array).

### Fix 3 — multi-block ADD_PREFERENCE (lines 365–410)

Instead of `split:"__ADD_PREFERENCE__"|get:1` (single-shot), use a foreach over the split array with a toggling `$pref_is_json` flag. Odd-indexed parts (1, 3, 5, ...) are JSON bodies. Each gets parsed independently and written to `tech_preferences`.

Reason: when Claude emits two paired blocks (saturday + sunday off in one turn), the old single-shot only persisted saturday; sunday was silently stripped by the cleanup regex without dispatch.

---

## 6. Final-pipeline order (canonical)

Per turn, in this exact order:

1. Phone normalize → `db.query technicians` (exact + fallback)
2. Unknown-phone short-circuit → return canned message
3. Find or create `agent_conversation` (tech_id + channel='sms')
4. `db.add agent_message` (user turn)
5. **Mode select** — onboarding if `tech.onboarding_completed_at == null`, else daily
6. **(Onboarding only)** `db.query agent_message` last 20 → chronological
7. **(Onboarding only)** Anthropic call (8s timeout)
8. **(Onboarding only)** Defensive response parse (Fix 2)
9. **(Onboarding only)** Token dispatch in declared order: SET_HOURS → SET_SUMMARY_TIME → SET_PERSONAL_CONTEXT → ADD_PREFERENCE (foreach) → ONBOARDING_DONE
10. **(Onboarding only)** Trim + empty-reply guard (Fix 1)
11. `db.add agent_message` (assistant turn)
12. `db.edit agent_conversation` (bump last_message_at)
13. Return `{ reply: ... }`

---

## 7. Tables touched (full set)

- `technicians` (read + edit)
- `agent_conversation` (read + add + edit)
- `agent_message` (read + add)
- `tech_preferences` (add)
- `event_log` (add — Fix 2 error logging only)

5 tables. All exist in current Xano workspace, all have schemas confirmed in prior recon.

---

## 8. Anthropic message history contract

- Pulled from `agent_message` where `conversation_id == $conversation.id`
- Sort `desc` then `|reverse` in memory → chronological (oldest first)
- Cap at 20 rows
- Each row mapped to `{role: msg.role, content: msg.content}` (no other fields)
- Empty assistant content (the Fix 1 condition) would crash this call with Anthropic 400. Fix 1's `"got it."` guarantees this never happens.

---

## 9. What is NOT in onboarding mode (deferred to daily-mode work tomorrow)

- All 9 daily-mode tokens (CLAIM_BROADCAST, DECLINE_BROADCAST, UPDATE_AVAILABILITY, daily ADD_PREFERENCE handler, RESCHEDULE_JOB, ESCALATE_TO_OWNER, QUERY_MY_NUMBERS, OWNER_REASSIGN_JOB, OWNER_OVERRIDE_AVAILABILITY)
- Context-block builder (cluster_assignment + tech_preferences + broadcast_attempt + jobs + technicians-roster + tech_performance_ledger reads)
- The owner-only branch logic (broadcast control, cross-tech reassignment, availability override)
- Embedded outbound SMS gates (Twilio calls inside the broadcast/reassign/availability flows)
- Sick-day cascade scheduling_queue enqueue

Lines 457–2113 of the source file. NOT part of today's migration.

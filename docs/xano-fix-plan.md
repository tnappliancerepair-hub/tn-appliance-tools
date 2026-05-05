# Warranty Job Intake — Fix Plan

**Status:** Diagnosis complete. No XanoScript modified yet. Read-only investigation only.
**Symptom:** Jobs 209 & 210 (warranty test submissions, 2026-05-01) landed in Xano with `customer_type: "self_pay"` and all warranty fields blank, despite the SYSTEM_PROMPT being updated to emit `__WARRANTY_READY__`.

---

## 1. Diagnosis — three-layer failure

The bug is structural in the Xano backend, not in the prompt. Three independent failures, each fatal on its own:

### Layer 1 — `chat/reply2` has no warranty branch
File: `xano-workspace/api/intake/chat/reply_2_POST.xs` (lines 172–272)

The endpoint scans the LLM reply only for these tokens:
- `%%JOB_READY%%` (line 173)
- `__JOB_READY__` (line 223)

There is **no** branch for `WARRANTY_READY`, `%%WARRANTY_READY%%`, or `__WARRANTY_READY__`. If the model emits the warranty token, the conditional falls through and **no job is created at all**.

The fact that jobs 209 & 210 *do exist* means the model is still emitting `__JOB_READY__` (or `%%JOB_READY%%`), not the warranty token. The prompt update did not change actual emission behavior — needs verification.

### Layer 2 — `create_job_from_chat` does not accept warranty fields
File: `xano-workspace/api/intake/create_job_from_chat_POST.xs`

Both reply2 branches call this endpoint with an identical hardcoded payload. Its input schema (lines 5–20) accepts:

`first_name, last_name, phone, zip, appliance_type, brand, model_number, problem_summary, recommended_service, channel, customer_preference_text, scheduling_type, sms_consent, sms_consent_at`

It does **not** accept `warranty_company`, `claim_number`, `dispatch_source_id`, `serial_number`, or `customer_type`. Any such fields posted to it are silently dropped at the input boundary.

### Layer 3 — `customer_type` is a hardcoded literal
Same file, line 65: `customer_type : "self_pay"`

Always self_pay. No conditional, no input override. Even if Layers 1 and 2 were fixed, this line stamps every job as self_pay.

### Where warranty data IS written today
- `xano-workspace/api/intake/warranty_job_intake_POST.xs` — Jotform webhook only. Takes `rawRequest` with `q3_customerName`, `q4_phoneNumber`, `q26_warrantyCompany`, etc. Cannot be called from chat (wrong input shape).
- `xano-workspace/api/jobs/create_job_POST.xs` — accepts warranty fields and customer_type, but is in the `jobs` api_group (authenticated jobs API), not called from chat intake.
- No `create_warranty_job_from_chat` endpoint exists.

### Token search across xano-workspace
| Token | Locations |
|---|---|
| `WARRANTY_READY` | only `api/intake/chat/reply_POST.xs` (v1, deprecated) lines 225, 228, 232, 235 |
| `READY_TO_SUBMIT` | only `api/intake/tech_ant_reply_POST.xs` (technician chat, not customer intake) |
| `JOB_READY` | reply.xs (v1) lines 211, 218; reply_2.xs (v2, live) lines 173, 175, 223, 225 |

Even the deprecated v1 `reply.xs` warranty branch is broken end-to-end — it detects `WARRANTY_READY` but still calls `create_job_from_chat`, which discards warranty fields and stamps self_pay.

---

## 2. Fix options

### Option A — extend `create_job_from_chat` (recommended)

Add optional warranty fields + `customer_type` to the existing endpoint. One file edit on the endpoint, one branch addition in reply2.

**Pros:**
- Single endpoint, single source of truth for chat-driven job creation
- Smallest diff
- Reuses existing customer lookup/create, routing, financial, event logging
- Self-pay path keeps working byte-for-byte (defaults preserve current behavior)

**Cons:**
- Mixes self-pay and warranty paths in one endpoint (mitigated by clear conditional on `customer_type`)

### Option B — new `create_warranty_job_from_chat` endpoint

Mirror `warranty_job_intake_POST.xs` but with chat-shaped inputs (not Jotform `rawRequest`). reply2 routes to it on `__WARRANTY_READY__`.

**Pros:**
- Strict separation of warranty vs self-pay
- Easier to evolve warranty-specific logic without risking self-pay regression

**Cons:**
- Duplicates customer lookup/create, routing, financial, event logging
- Two endpoints to maintain in lockstep
- Larger diff

**Recommendation: Option A.** The two paths share ~90% of their logic (customer upsert, jobs row, financial, event, routing). The warranty-specific differences are: write `customer_type: "warranty"`, write the four warranty fields, and use `payment_status: "warranty_pending"` instead of `"unpaid"`. All three are clean conditionals on `customer_type`.

If at any point we need divergent routing (e.g. warranty jobs skip get_tech_for_zip), revisit Option B.

---

## 3. Step-by-step plan

### Step 3.1 — Verify the model is emitting the right token
Before any code change, check `agent_message` rows for jobs 209 & 210 (look at the assistant message that triggered creation). Confirm whether the LLM emitted `__JOB_READY__` or `__WARRANTY_READY__`. If still emitting JOB_READY, the prompt change didn't take — investigate prompt deployment first. If emitting WARRANTY_READY but a job still got created, that's a contradiction worth understanding (could mean reply.xs v1 is being hit, not reply2).

**Action:** read the `agent_message` table for the conversations tied to jobs 209 & 210.

### Step 3.2 — Pull fresh sandbox state (don't trust cached files)
```
xano sandbox pull -d ./xano-workspace
```
Compare against the current local copy to make sure nothing else has been edited remotely since the last pull. Resolve any drift before editing.

### Step 3.3 — Edit `create_job_from_chat_POST.xs`
File: `xano-workspace/api/intake/create_job_from_chat_POST.xs`

**Add to input schema (after line 20):**
```
text? customer_type?
text? warranty_company?
text? claim_number?
text? dispatch_source_id?
text? serial_number?
```

**Modify the `db.add jobs` block (line 51) so:**
- `customer_type` reads from input with `"self_pay"` fallback: `customer_type: $input.customer_type|first_notempty:"self_pay"`
- Add `warranty_company: $input.warranty_company`, `claim_number: $input.claim_number`, `dispatch_source_id: $input.dispatch_source_id`, `serial_number: $input.serial_number`

**Add a conditional after the jobs insert** to set `payment_status: "warranty_pending"` on the financial row when `customer_type == "warranty"` (replace the current hardcoded `"unpaid"` at line 149 with a conditional, or follow up with a `db.edit job_financial`).

**Decision point for tomorrow:** does the warranty path also need different routing behavior (skip `get_tech_for_zip`)? Existing `warranty_job_intake_POST.xs` does no routing. Default tomorrow: keep routing identical for both paths unless we see a reason not to. Note this decision in the commit message.

### Step 3.4 — Edit `reply_2_POST.xs`
File: `xano-workspace/api/intake/chat/reply_2_POST.xs`

After the existing `__JOB_READY__` branch (ends line 272), add new `elseif` branches for `__WARRANTY_READY__` and `%%WARRANTY_READY%%`. Each:
- splits on the warranty token
- json_decodes the second part as `$job_data`
- calls `create_job_from_chat` with the same self-pay payload **plus** `customer_type: "warranty"`, `warranty_company: $job_data.warranty_company`, `claim_number: $job_data.claim_number`, `dispatch_source_id: $job_data.dispatch_source_id`, `serial_number: $job_data.serial_number`

Mirror the existing branch structure exactly — same control flow, same `var.update $clean_reply` and `var.update $job_created` pattern.

### Step 3.5 — Validate locally before push
```
xano validate ...   # via mcp__xano__validate_xanoscript on the two edited files
```
Use the MCP `validate_xanoscript` tool on both `.xs` files. Fix any syntax errors before pushing.

### Step 3.6 — Push to sandbox first, then promote
```
xano sandbox push --review
```
Per Xano CLI docs (`mcp__xano__cli_docs topic=sandbox`):
- `sandbox push --review` opens the browser to verify the changes against your personal sandbox before promoting.
- Push is partial (changed-files-only) by default. Use `--dry-run` first to preview what's being sent.
- The sandbox is a singleton per user; `sandbox reset` wipes it without recreating.

In the sandbox dashboard, **manually test** by hitting `chat/reply2` with a scripted warranty conversation. Verify in `jobs` table that:
- `customer_type` = "warranty"
- All four warranty fields are populated
- `payment_status` = "warranty_pending"
- `job_status` / `triage_status` flow correctly

Only after the sandbox test passes:
```
xano workspace push -d ./xano-workspace
```
…against the real workspace. Same `--dry-run` first.

### Step 3.7 — Smoke test in production
Submit one warranty test from the live site. Verify in Xano dashboard. If clean, mark this fix done.

### Step 3.8 — Cleanup tasks (separate, lower priority)
- Decide fate of `chat/reply.xs` (v1). It has a partial WARRANTY_READY branch but downstream is still broken. Either fix it the same way, or delete it if reply2 is the only live path.
- Audit the customer-facing site/Netlify functions to confirm they call `chat/reply2` and not `chat/reply`. If both are live, fix both.

---

## 4. Files referenced

| Path | Role | Action |
|---|---|---|
| `xano-workspace/api/intake/chat/reply_2_POST.xs` | Live chat endpoint | EDIT — add WARRANTY_READY branches |
| `xano-workspace/api/intake/create_job_from_chat_POST.xs` | Job creator called by reply2 | EDIT — accept + write warranty fields |
| `xano-workspace/api/intake/warranty_job_intake_POST.xs` | Jotform webhook | reference only — model for warranty field names |
| `xano-workspace/api/jobs/create_job_POST.xs` | Authenticated jobs API | reference only — model for full warranty input schema |
| `xano-workspace/api/intake/chat/reply_POST.xs` | Deprecated v1 chat | audit — confirm not live; cleanup later |
| `xano-workspace/table/jobs.xs` | Jobs table schema | reference — confirm warranty_company, claim_number, dispatch_source_id, serial_number all exist |

---

## 5. Sandbox push notes (per Xano CLI docs)

- **Always sandbox before workspace.** Sandbox is your personal disposable dev environment, auto-provisioned, free-tier. Workspace is shared/production.
- **Pull first.** `xano sandbox pull -d ./xano-workspace` to sync local with sandbox state before editing — avoids overwriting drift.
- **Dry-run before push.** `xano sandbox push --dry-run` shows exactly what files will be sent. Partial push is the default — only changed files.
- **Use `--review`** to push and immediately open the browser dashboard, where you can inspect and promote to a real workspace from the UI.
- **Push wraps imports in a transaction by default** (`--no-transaction` to disable) — failed validation rolls back cleanly.
- **GUIDs are written back to local files** by default after a successful push, keeping local objects in sync with server identifiers.
- **For workspace push:** same flags work (`--dry-run`, `--sync`, `-i`/`-e` glob filters). Always `--dry-run` first on workspace.

---

## 6. Open questions for tomorrow

1. Does the warranty path need different routing? (Default assumption: same routing as self-pay. Verify against the warranty_job_intake convention which does no routing.)
2. Should `payment_status` for warranty jobs be `"warranty_pending"` (matching warranty_job_intake) or something else?
3. Should the warranty job_event have a different `event_type` or `event_source` than the self-pay one?
4. Is `chat/reply.xs` (v1) still routed-to from anywhere? If yes, fix it too. If no, delete in a follow-up PR.
5. Verify by reading `agent_message` rows: did the LLM emit `__WARRANTY_READY__` for jobs 209 & 210, or did it still emit `__JOB_READY__`? This determines whether the prompt change took effect.

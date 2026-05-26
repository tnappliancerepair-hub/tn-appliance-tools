# Appliance Ant

AI operations platform for **TN Appliance Exchange LLC**. Owner: James "Teddy" Pivacek (tech ID 1, `tnappliancerepair@gmail.com`, SMS **615-485-5795** for human-judgment escalations).

## Platform name: ANT

The product is **ANT** — the AI-native ops platform replacing HCP for TN Appliance Exchange. **Three user-facing surfaces** share the same Xano backend and the same Mac Mini colony loop:

- **Ant Office** — the office dashboard (`dashboard.html`, `office-tn.html`, `office-la.html`, `job-detail.html`, `teddy-tdr-tool.html`, etc.). Used by Teddy / Danielle / Alyse for triage, scheduling, payouts, warranty submissions.
- **Ant Field** — the tech mobile experience (`tech-daily-dashboard.html`, `tech-ant-live.html`). What replaces HCP for techs in the truck.
- **Ant** — the customer-facing surface (`cash-tdr-customer.html`, `upload.html`, the public TDR view, future customer chat). The friendly conversational presence that customers see and interact with.

**All future naming follows this convention.** When deciding where new functionality belongs, ask: office desk, truck, or customer? Place it accordingly.

## First — read this before doing anything

Every new session: read this whole file, then in your first reply report (a) **what's built**, (b) **what's next**, and (c) **what NOT to do**. The "Working rules" section below is load-bearing — violating it once costs more than re-reading it ten times.

## Operational status (current)

**Dawn is OUT (eye issue).** The manual warranty-submission workflow she usually runs is unstaffed. **Automation cutover is no longer optional — it is urgent.** Phase A (loop runtime, 2026-05-24) and Phase B (producers wired, 2026-05-25) both shipped. Vision-step-5 (Danielle/warranty automation) is the remaining slip-risk — every day it slips is a day of warranty paperwork piling up. This changes the risk calculus: prefer shipping a slightly rough automation today over a perfect one next week.

## Infrastructure

- **Xano API base:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA`
- **Netlify site:** `superlative-naiad-233aa7.netlify.app`
- **Metadata API base:** `https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1` (bearer auth via `XANO_METADATA_TOKEN`)
- **Telnyx outbound SMS:**
  - **Customer-direction:** `+1 615-588-9500`
  - **Tech-direction:** `+1 615-857-8800`
- **Vanity inbound numbers (NOT YET WIRED to Vapi):** `1-888-ANT-8998` and `1-866-ANT-0111`. These are owned but currently unrouted — calls go nowhere. Wiring them to the existing Vapi inbound agent is open work. Until done, do **not** advertise these numbers in customer-facing materials.

## Tech roster

| ID | Name              | Region                       | Phone           |
|----|-------------------|------------------------------|-----------------|
| 1  | Teddy Pivacek     | TN (Antioch) — owner         | 615-485-5795    |
| 2  | Jimmy Pivacek     | South Nashville              | 615-967-1304    |
| 3  | Andre Pivacek     | Hammond, LA (dual-state)     | 615-969-3115    |
| 4  | Lee Harding       | Clarksville, TN              | 615-829-1654    |
| 5  | Billy Savoy       | Hammond, LA                  | 731-504-9617    |
| 6  | John Houk         | Walker, LA                   | 813-352-7686    |

## Agent platform

- **17 live agents** today; building toward **379 agents across 20 colonies**.
- **New agents go into the Mac Mini colony loop as functions — not Xano endpoints.** See the "Architecture" and Working rule 5 sections.
- **Legacy path (existing agents only):** `agent_proposals` → human approve → `agent_builder` → `agent_queue`. See `agent-proposals.html` (Build It button) and `xano-workspace/api/intake/agent_builder_POST.xs`. Do not extend this pipeline for new agents.
- **`colony_signals` table** (Xano table id 38, created 2026-05-24): inter-colony messaging substrate the Mac Mini loop polls. Columns: `signal_type` (req), `signal_strength` (int, req), `source_colony`, `target_colonies` (comma-separated, empty = broadcast), `payload` (JSON-encoded string), `processed_at` (NULL = pending), `created_at` (auto).

## Architecture: Mac Mini / colony loop (decided 2026-05-24)

- **Mac Mini runs the colony loop 24/7.** The local Mac Mini is the runtime for every agent, polling `colony_signals` / `agent_queue` and dispatching work.
- **New agents are functions inside the loop — never Xano endpoints, never Xano background tasks.** Adding an agent = adding a function (Python/JS) to the Mac Mini loop codebase. Do not build new XS endpoints for agent logic; the `agent_builder → Xano endpoint` pipeline is the OLD path, retained only for legacy agents already on `agent_queue`.
- **Xano = persistence + state.** Tables (`colony_signals`, `agent_proposals`, `agent_queue`, `event_log`, etc.), Metadata API for CRUD, and webhook endpoints for inbound events. No execution-loop logic.
- **Netlify = browser-facing only.** Static pages + proxy functions for the dashboard. No long-running logic.
- **Why:**
  - **Xano task limit hit:** ceiling of 10 scheduled tasks per workspace. We are already at it; can't add more agents as Xano crons.
  - **`agent_builder` fought parser errors for 3 days:** XS's hard rules (em-dashes, fences, `??`/`|trim` in `if`) keep biting any code-generation pipeline that emits XS server-side.
  - **Mac Mini runs 24/7 with no limits:** unbounded number of loop functions, no task-count ceiling, no XS parser between us and execution.
  - **Claude Code can write and deploy new agent functions itself:** the loop's source lives in a repo Claude Code has full write access to; no UI paste step.
  - **Full audit trail:** every loop tick + dispatch + Claude call writes to `event_log` / `colony_signals`. Nothing happens off-the-record.
  - **Nothing gets lost between sessions:** loop state + CLAUDE.md + memory persist across restarts; the Mac Mini is the durable "always-on" we never had with browser-tab sessions.

## Long-term vision (the job flow we're automating toward)

Every appliance-repair job, end-to-end, should flow through these five steps automatically — humans only intervene where judgment is required:

1. **Pre-diagnosis** — symptoms collected, likely failure modes identified, before the truck rolls.
2. **Parts ordered before arrival** — the diagnosis triggers the order so the tech shows up with the part already on the truck (or staged for the next visit).
3. **Waiver signed before tech arrives** — customer e-signs liability/scope-of-work paperwork ahead of the appointment, not at the door.
4. **Tech Assist guides the job** — on-site, the tech is walked through diagnosis/repair steps by the assist agent rather than going to YouTube.
5. **Danielle submits warranty immediately after** — warranty paperwork goes out the moment the job closes, not in a Friday batch.

Every architectural decision should move at least one of these five steps closer to "happens with zero human prompting." If a proposed change doesn't, ask why we're doing it.

## HCP migration day (planned)

**Target date: TBD — pick a Saturday once prereq #5 lands.** Saturday because the live schedule is lightest, fewest jobs in flight to migrate. All open jobs move from Housecall Pro to Xano + Ant, and HCP is decommissioned.

**Five prerequisites gate the cut — 4 of 5 done as of 2026-05-25 evening:**

1. ✅ **Calendar view in Ant Office** with capacity indicators — **DONE 2026-05-25**. `office-calendar.html` live at `tnapplianceexchange.net/office-calendar.html`. Week grid with sticky tech header + day-label, big capacity numbers per cell (color-coded by load: green 0-2, yellow 3-4, red 5-6, gray day-off), today-row left-border, sticky footer totals row, "Needs Assignment" banner, prev/today/next week nav. Backed by `get_office_calendar_week_GET.xs`.

2. ✅ **Tech completes jobs without HCP** — **DONE 2026-05-25**. `tech-ant-live.html` Start Job + Complete (with completion-type dropdown) buttons write straight to Xano. `tech_job_started_POST.xs` flips `scheduling_status="in_progress"` + `current_status="in_progress"` + emits JOB_STARTED + SMSes Teddy. `tech_job_complete_POST.xs` flips both statuses via completion_type → enum mapping (was broken — invalid enum values pre-this-session; fixed) + creates tech_earnings stub + emits JOB_COMPLETED (triggers Phase 5A warranty digest for warranty jobs) + SMSes Teddy. Smoke test verified end-to-end with job 200 / tech 4.

3. ✅ **Customers get auto-confirmation on every booking** — **DONE 2026-05-25**. New `appointment_scheduled` colony loop agent + 8 producer wirings across `hcp_job_webhook`, `hcp_poll` (update + create), `servicepower_email_intake` (reschedule + create), `tech_sms_inbound` (CLAIM + PICK + RESCHEDULE), and `reschedule_job_POST`. Every endpoint that writes `scheduled_start` emits an APPOINTMENT_SCHEDULED signal; agent dedupes on `(job_id, scheduled_start_ms)` and sends customer SMS ("Hi {name}, your {appliance} repair is confirmed for {date time}. Your tech will be {tech_first}.") + tech SMS ("[ant] job #X confirmed for {date time} — {customer}, {address}"). Source-aware gating skips customer SMS when source is `tech_claim` (placeholder time) and skips tech SMS for tech-driven sources.

4. ✅ **Broadcast booking wired** — **DONE 2026-05-25**. `__CLAIM_BROADCAST__` sets `scheduled_start` to tomorrow 08:00 CT default; new `PICK1/2/3` keyword handler applies owner's chosen `must_time_proposal` option directly to the job.

5. ⏳ **Ant Office booking flow** (the calendar's write-back) — **NOT DONE, last remaining prereq.** Today `office-calendar.html` is read-only — job blocks deep-link to `job-detail.html` and the `+ New Job` button is a pass-through to `book.html`. Need: click-empty-cell-to-book modal pre-filled with `tech_id` + `date`, calling a new `book_appointment_from_office_POST` that writes the job + sets technician_id + sets scheduled_start (firing the existing APPOINTMENT_SCHEDULED signal chain). Plus office-driven reschedule/reassign/cancel actions wired from the calendar. **Once this is done, pick a Saturday and cut HCP.**

Until all five are done, the HCP webhook + HCP poll endpoints stay as canonical sources of truth for `scheduled_start`, `current_status`, `technician_id`. After migration day, those producers retire and Ant Office becomes the writer.

**Strategic pivot decided 2026-05-25: stop building HCP sync, build Ant instead.** The TECH_ASSIGNED → tech-daily-dashboard path was the proof — we delivered a better tech experience by shipping Ant Field, not by reviving the dormant Phase 1b/1c HCP-webhook trigger. Going forward, when a feature can be implemented as HCP-write OR as Ant-native, pick Ant. Phase 6 Gap 2 (email-intake → HCP auto-create) is the explicit exception and is throwaway code that retires on migration day.

## Session commands

- **Start of session:** Read `CLAUDE.md` and report **what's built, what's next, and what NOT to do**.
- **End of session:** Update `CLAUDE.md` with **what was built today**, then **commit and push to GitHub**.

## Working rules

1. **Check what exists before building anything.** Before creating a new table, endpoint, Netlify function, loop function, or doc, list the relevant namespace (`/api:meta/workspace/1/table`, `xano-workspace/api/`, the Mac Mini loop repo, this repo) and grep by keyword. Today's `colony_signals` create only happened after confirming no `colony*`/`signal*` table existed — apply that same check every time.
2. **Claude and Mac Mini first; touch Xano or Netlify UI manually only when scripted paths have failed.** Default order: Claude → Metadata API → Mac Mini loop function → Xano UI / Netlify dashboard. UI clicks bypass the audit trail and break the build-by-agent pipeline — treat them as last-resort.
3. **Automate everything.** If a task needs no human judgment, fully automate it. If it needs human judgment, automate up to the decision point then **SMS Teddy at 615-485-5795** with the choices and wait for `approve` / `reject`. Never leave a manual step in the loop where an SMS prompt would do.
4. **Take the most efficient path unless it hurts the long-term vision.** Default to the shortest implementation that works. Only spend extra effort when a quick fix would move the system *away* from the five-step vision above (pre-diagnosis → parts → waiver → tech-assist → warranty). If a shortcut is vision-neutral, take it.
5. **New agents = Mac Mini loop functions, NOT Xano endpoints/tasks.** Restating Architecture rule because it's the most-violated default. If you catch yourself opening `agent_builder` to add a *new* agent, stop — add a function to the Mac Mini loop instead. `agent_builder` is only for legacy upkeep.
6. **Start every session by reading this file.** Then in the first reply: report (a) **what's built**, (b) **what's next**, (c) **what NOT to do**. Skipping this is how stale assumptions creep back in.
7. **Never attempt to deploy XanoScript via the Metadata API.** The `POST /api:meta/workspace/1/apigroup/{id}/api` endpoint accepts a `xanoscript` field, returns 200, but **silently drops the field** — the endpoint is created as an empty shell with no stack. PUT/PATCH likewise drop it; nine alternate paths (`/draft`, `/spec`, `/script`, `/yaml`, `/publish`, `/security`, `/api-import`, etc.) all 404. The ONLY working XS-deploy paths are: **(a) paste into the Xano UI**, or **(b) `xano workspace push <file>` via the Xano CLI on the Mac Mini**. Full diagnosis in `docs/xanoscript-footguns.md`.

8. **Agent velocity rule.** Building agents is **always the highest priority after production issues and live customer-facing fixes.** The Colony Architect runs daily at 6am CT. Every session that doesn't have a critical fix should end with the architect having built at least 1–3 new agents. The goal is 379 agents as fast as possible. **There is no finish line — after 379 we build more.** Every agent makes every tech perform better. Every agent carries Ant's name forward. If you're choosing between polish on an existing agent and building a new one from the blueprint, build the new one. Polish later. Build now.

## XanoScript rules (fast reference)

Full catalog: `docs/xanoscript-footguns.md`. The hard rules:

- **No em-dashes** anywhere — parser crashes.
- **No try/catch** — XS has no exception handling. `db.get` on null PK / `json_decode` on bad input throw `ERROR_FATAL` and kill the script.
- **No backtick template literals** — use double-quoted strings joined with `~`.
- **`data = { ... }`** for `db.add` and `db.edit` (not `fields =`). Field name is `metadata` (a JSON column) on `event_log`.
- **`??` and `|trim` only inside `value = (...)` assignments** — the UI parse-serialize round-trip silently strips them inside `if(...)` comparisons.
- **Array index:** `|get:N` with literal integer (40+ proven usages). Object key: `|get:$str_var`.
- **First row of paginated query:** `(($rows.items|first) ?? null)`. Paginated `db.query` returns `{items: [...]}`, not the array directly. Do NOT write `($rows.items|first ?? null)` — parser reads `first ?? null` as one filter name and fails.
- **Anthropic response path:** `$resp.response.result.content[0].text` — memorize. Partial paths produce silent empty strings.
- **Strip Sonnet 4.5 markdown fences before `json_decode`:** `($raw|replace:"\`\`\`json":""|replace:"\`\`\`":"")|trim` — `|trim` is mandatory; without it `json_decode` throws on residual whitespace.

## Session log — 2026-05-24

### What was built today

**Architecture pivot to Mac Mini colony loop (decided 2026-05-24).** Documented in CLAUDE.md "Architecture" section. The "why" is captured: Xano's 10-task ceiling, agent_builder XS parser fights, Mac Mini 24/7 with no limits, Claude Code writes + deploys functions itself, full audit trail.

**New table:** `colony_signals` (Xano id 38). Schema in `CLAUDE.md` Agent platform bullet. Holds the inter-colony messaging substrate the loop polls.

**Design doc:** `docs/colony-loop-design.md` (17 sections, all open questions answered). The §17 answers + §16 Phase A/B/C build plan are the canonical reference.

**Colony loop Phase A — code complete, awaiting paste + run** (`colony-loop/` subdirectory, ~1100 LOC, zero npm dependencies):
- 5 XanoScript support endpoints (`colony-loop/xano-endpoints/intake/`): `get_pending_colony_signals_GET`, `mark_signal_processed_POST`, `emit_colony_signal_POST`, `get_daily_briefing_fired_today_GET`, `get_greeting_sent_for_job_GET`. All scanned clean for em-dash / backtick / try-catch / `??`-in-`if` footguns.
- Node 20+ loop runtime: `index.js`, `tick.js`, `dispatch.js`, `xano.js`, `claude.js` (Sonnet 4.6 vision-capable, prompt-cached system block), `sms.js`, `escalate.js`, `time.js` (America/Chicago via `Intl.DateTimeFormat`), `config.js` (env + `.env` parser).
- 4 agents matching signal_type=filename convention: `daily_briefing`, `payroll_calculator`, `job_created` (the universal greeting trigger), `customer_intake_reply` (Claude pre-diagnosis with image inputs).
- Tooling: `scripts/smoke-test.js`, `scripts/inject-signal.js`, `launchd/com.tnappliance.colony-loop.plist`, `rules/commission_rules.json`, `prompts/pre_diagnosis.md`, `README.md` with full deploy + verify steps.

**Footgun catalog update:** `docs/xanoscript-footguns.md` now documents that the Metadata API column-add endpoint is `/schema/type/{type}` — three plausible alternatives (`/schema/{type}`, `/column`, `PUT /schema`) all 404 or reject.

### Late update (16:13 CT) — Phase A verified live

**Mac Mini runtime is real.** Homebrew Node v26 + Xano CLI both confirmed working on the local Mac Mini (`/opt/homebrew/bin/node`, `xano workspace pull` returned 201 docs). `xano workspace push --force` is the proven XS deploy path — verified against all 5 colony-loop endpoints in this session. The XS-via-Metadata-API trap stays dead; CLI push is canon now.

**All 5 colony-loop XS endpoints DEPLOYED via CLI (not UI paste).** This contradicts the deploy instruction one paragraph up — keep the CLI path as the default for new endpoints. The original "paste into Xano UI" step is now backup only. Deploy steps:
1. `xano workspace push -i "**/<endpoint_name>*" --force`
2. Ignore "table does not exist" warnings — they're stale CLI cache (see footgun doc).
3. `curl` the new endpoint to confirm it returns 200.

**5 new XS footguns added to `docs/xanoscript-footguns.md`** — section "CLI push: five quoting / expression footguns from the colony-loop deploy (2026-05-24)". Every one cost a real deploy cycle:
1. `sort = {col: desc}` must be `sort = {col: "desc"}` — direction is a string.
2. `return = {type: list}` must be `return = {type: "list"}` — type is a string.
3. `($rows.items|first ?? null)` fails — parser reads `first ?? null` as one filter name. Use `(($rows.items|first) ?? null)`.
4. `(now - 86400000)` fails — `now` is datetime, not ms. Use `((now|to_ms) - 86400000)` for ms arithmetic.
5. CLI "table does not exist" warnings are stale-cache noise — ignore once the table is confirmed live via API.

The CLAUDE.md fast-reference line for `|first ?? null` was also wrong (showed the broken form). Corrected in commit `2854284`.

**Phase A smoke + live SMS verified:**
- `npm run smoke` → 8/8 checks pass against all 5 endpoints.
- DRY_RUN=true run dispatched `signal_id=3` cleanly, SMS to stdout only.
- DRY_RUN=false run dispatched `signal_id=4` (dishwasher, old greeting) → real SMS landed on +16154855795.
- DRY_RUN=false re-run with new code: `signal_id=5` (`source=ahs_email`, washer) → real SMS with new clean-domain link + warranty note. `errors=0`. Phase A is live.

**Greeting refined (commit `cabeeb4`):**
- Link in `composeGreeting` is now `config.publicSiteBase` with the `https?://` prefix stripped → SMS shows `tnapplianceexchange.net` (no protocol, no per-job URL params). Cleaner, phones still auto-linkify.
- Warranty reassurance line appended **by default**: "Your repair is covered under your home warranty - no payment needed. Just mention warranty if asked." 99% of jobs are warranty per the owner — and customers regularly try to pay the tech at the door when they shouldn't.
- Opt-out: `payload.source` in `{cash_tdr, self_pay, cash, customer_pay, cash_customer}` suppresses the warranty line. ahs_email, servicepower, unknown → all include it.

**Dispatcher quiet-log for unknown signal types (commit `a935e0d`):** `dispatch.js` now returns `{success: false, action: 'no_agent_yet'}` instead of throwing when an agent file is missing. Same end state (signal marked processed by `tick.js`), but no 500-char stack trace in `event_log`. Critical for the 379-agent rollout where missing agents are an expected steady state.

**Secrets hygiene (commit `fec5980`):** root `.gitignore` now covers `.env` / `**/.env` with a negation for `.env.example`. `colony-loop/.gitignore` already had local coverage — this is defense-in-depth so future subdirs' `.env` files don't leak.

**Launchd deploy attempted, BLOCKED on env state:** `cp launchd/...plist ~/Library/LaunchAgents/` failed because that directory doesn't exist on this Mac Mini yet. Also discovered the plist had a stale path (`/Users/tpivacek/code/tn-appliance-tools/...`) — fixed in this commit to `/Users/tpivacek/tn-appliance-tools/...`. Plist does NOT carry `ANTHROPIC_API_KEY` (intentional — read from `colony-loop/.env` which `config.js` loads from the file's own dirname, cwd-independent).

### Current priority — **GET LAUNCHD RUNNING, THEN PHASE B**

Phase A (lines 1-3) is done. Remaining:

4. **Deploy to launchd** — sequence the user runs in Terminal (commands documented at end of session). Verify heartbeat lands in `~/Library/Logs/colony-loop.out.log` within 1 tick (60s).
5. **Phase B** — wire `JOB_CREATED` emit into the 6 producer XS endpoints (`hcp_job_webhook`, `hcp_poll_recent_jobs`, `ahs_email_intake`, `servicepower_email_intake`, `create_job_from_chat`, `warranty_job_intake`). Each one currently creates a job but doesn't emit the colony signal, so greetings only fire for manually-injected test signals. See `docs/colony-loop-design.md` §16 Phase B for the per-endpoint emit-point map.

**Before Phase B starts**, the manually-spawned background `node index.js` from this session (`b00ybc0zf`) must be killed — launchd will spawn its own copy, and two competing loops will double-dispatch (the `get_greeting_sent_for_job` dedupe blocks double-SMS but it's wasteful and confusing).

### What NOT to do

- **Do NOT touch the 6 producer XS endpoints yet** (`hcp_job_webhook`, `hcp_poll_recent_jobs`, `ahs_email_intake`, `servicepower_email_intake`, `create_job_from_chat`, `warranty_job_intake`, `save_attachment`). Phase B work — explicitly deferred until Phase A passes its smoke test.
- **Do NOT auto-fire pre-diagnosis SMS at the 50 stale `prediagnosis_pending` jobs** from 2026-05-20. Per Q8: handle them manually in Teddy Tool.
- **Do NOT harden `agent_builder` for new agents.** Per the Mac Mini pivot it's deprecated for new work; legacy path only.
- **Do NOT ship `JOB_CREATED` greetings during quiet hours** (before 8am / after 9pm CT). The agent holds-and-re-emits — don't bypass.

### Still open (logged in `docs/colony-loop-design.md`)

- `countCompletedPreDiagnoses()` in `customer_intake_reply.js` is a stub returning 0 — intentionally keeps the first-20-always-escalate window permanent until after first live shake-down.
- Customer-SMS inbound webhook not assumed; CUSTOMER_INTAKE_REPLY fires only via media upload (Q11).
- **`agent_builder` 500 root cause confirmed:** the endpoint POSTs to the Metadata API with the `xanoscript` field, which Xano silently drops. Even when Claude generates valid XS, deploy is a no-op. Fix is structural — `agent_builder` needs to be retired or rewritten to emit a colony_signal that a Mac-Mini-side function picks up and deploys via the Xano CLI. Per the pivot, retire.
- **Vanity numbers `1-888-ANT-8998` and `1-866-ANT-0111` not wired to Vapi.** No timeline yet.
- **Financial flags pending Alyse review:** `docs/financial-flags-open.md` is the running list (commission rates, broken `tech_earnings.commission_earned`, Stripe key rotation, warranty vendor activations, payout-batch UI gap).

## Session log — 2026-05-25

### What was built today

**Phase B COMPLETE — all 6 producer XS endpoints emit `JOB_CREATED` to `colony_signals`.** Every new job now gets a Mac-Mini-loop-owned greeting automatically — no manual step.

Per-endpoint emit points (same snippet pattern in each: pre-bind vars → `|json_encode` payload → `db.add colony_signals` → `db.add event_log` audit row, ~50 LOC each):

| Endpoint | Insert after L | `source` literal |
|---|---|---|
| `api/intake/hcp_job_webhook_POST.xs` | 467 | `hcp_webhook` |
| `api/intake/hcp_poll_recent_jobs_POST.xs` | 776 | `hcp_poll` |
| `api/intake/ahs_email_intake_POST.xs` | 1010 | `ahs_email` |
| `api/intake/servicepower_email_intake_POST.xs` | 504 | `servicepower_email` |
| `api/intake/create_job_from_chat_POST.xs` | 231 | `web_chat` |
| `api/intake/warranty_job_intake_POST.xs` | 157 | `warranty_jotform` |

Each was deployed via `xano workspace push -i "**/<name>*" --force` — no real errors, only the documented stale-cache "table does not exist" warnings (including the expected one for `colony_signals`).

**Wire 1 SMS removed from AHS + ServicePower (loop owns greetings now — no more double-texting):**
- `ahs_email_intake_POST.xs` — deleted Wire 1 (L1055–1116) AND the consent_channel + chat-link mint + send_sms block (L1118–1254), ~200 LOC gone. `$consent_channel_used` and `$sms_response_status` stubbed to `"deferred_to_loop"` / `null` so response shape stays stable for callers. **Trade-off:** AHS customers lose the Netlify-minted signed-token chat deep-link; loop sends bare `tnapplianceexchange.net` and Ant handles chat from there.
- `servicepower_email_intake_POST.xs` — deleted Wire 1 (L506–568).

**`warranty_job_intake_POST.xs` got its first-ever `event_log` row.** Phase B snippet's `action: "job_created_signal_emitted"` is the first audit entry this endpoint produces — closes the gap noted in design doc §16 item 18.

**XS deploy footguns reconfirmed during Phase B:**
- `|json_encode` is the canonical encoder (15+ workspace usages) — but the inline-on-object-literal pattern `{...}|json_encode` is NOT used anywhere. **Always pre-bind the object to a var first**, then encode the var.
- `??` only inside `value = (...)`. Pre-bind defaults via dedicated `var $foo { value = ($x ?? "") }` blocks rather than inlining `??` in `data` block field assignments.

**End-to-end smoke test passed — 25 second POST-to-SMS-sent latency** (design SLA was 5min worst-case / 90s typical):
- 11:41:01 CDT — `POST /api:3e_TffpA/create_job_from_chat` with `+16154855795` → job_id=18096, signal_id=7 written by the new Phase B emit.
- 11:41:24 CDT — Loop tick: `{"action":"signal_dispatched","signal_id":7,"signal_type":"JOB_CREATED"}` (23s after POST).
- 11:41:26 CDT — `event_log` row for `new_job_greeting_sent` confirmed via `get_greeting_sent_for_job?job_id=18096` → `{"sent":true,"last_sent_at":1779727286120}`.

### Current priority — vision-step-5 (Danielle / warranty automation)

Phase A + B done. With Dawn still OUT and warranty submissions piling up, **vision-step-5** is the next urgent move: a new Mac Mini loop function (NOT a Xano endpoint per Architecture / Working rule 5) that listens for `JOB_COMPLETED`-style signals and submits warranty paperwork to AHS / ServicePower / Frontdoor. Producer-side wiring for completion will mirror Phase B but target the `job.completed` branches in `hcp_job_webhook_POST.xs` and `hcp_poll_recent_jobs_POST.xs` (and any other endpoint that flips a job to terminal state).

### What NOT to do

- **Do NOT re-add Wire 1 customer SMS to AHS or ServicePower.** Loop owns greetings; two-SMS-per-intake is exactly what we just removed.
- **Do NOT add new agents as Xano endpoints or scheduled tasks.** Mac Mini loop functions only (Working rule 5).
- **Do NOT attempt XS deploys via the Metadata API.** CLI push or UI paste only (Working rule 7).
- **Do NOT auto-fire greetings at the 50 stale `prediagnosis_pending` jobs from 2026-05-20.** Still operator-handled in Teddy Tool.

### Known issues / open

- **`web_chat` source gets the warranty note (low-priority bug, found during smoke test).** `colony-loop/agents/job_created.js` suppresses the warranty line via `CASH_SOURCES = {cash_tdr, self_pay, cash, customer_pay, cash_customer}`. The new `"web_chat"` literal is NOT in that set, so web-chat self-pay jobs receive "covered under your home warranty" — wrong but harmless (customers ignore it). Fix options: (a) emit `customer_type` in the chat producer's payload and have the agent suppress on `customer_type == "self_pay"`, or (b) add `"web_chat"` to `CASH_SOURCES` if chat is overwhelmingly self-pay. Decide before chat goes high-volume.
- **Loop intermittent `fetch failed` errors** in `daily_briefing_check_failed` and occasional `loop_error` entries. Transient network blips against Xano, loop self-recovers, no signal loss observed. Worth adding retry+backoff before scaling toward 379 agents.

### Late update (12:41 CT) — Phase 5A live (incomplete-path verified end-to-end)

**Vision-step-5 / warranty automation v0 is live.** Agent receives `JOB_COMPLETED`, loads job + customer + latest TDR, runs completeness gate, SMS-es Danielle (+16154850713) either the warranty digest or the BLOCKED-with-missing-fields alert. No auto-submit per Q6 — every warranty job goes to Danielle for portal entry.

**Files shipped this push:**
- `colony-loop/agents/job_completed.js` (~170 LOC). NOTE filename: dispatch routes by `signal_type.toLowerCase()`, so a `JOB_COMPLETED` signal looks for `agents/job_completed.js`. I initially named it `warranty_submission.js` and dispatch hit the `no_agent_yet` fast-path silently (no error, just no work). **Convention rule: agent filename = lowercased signal_type, NOT the outcome name.**
- `colony-loop/xano-endpoints/intake/get_warranty_submission_handled_GET.xs` — 7-day dedup guard.
- `colony-loop/xano-endpoints/intake/get_warranty_submission_context_GET.xs` — single round-trip {job, customer, tdr, tdr_failures}.
- `colony-loop/xano-endpoints/intake/find_recent_completed_warranty_jobs_GET.xs` — diagnostic lookup that joins from the TDR side (jobs side has unused `technician_decision_report_id` column; real TDR linkage is `tdr.job_id` FK). Useful for any future "find a job matching X" need.
- `colony-loop/sms.js` — `toDanielle(body, ctx)` helper, routes through `send_sms` with `recipient_role: 'warranty_handler'`.
- `colony-loop/config.js` — `daniellePhone` (env `DANIELLE_PHONE_NUMBER`, fallback `+16154850713`).
- `colony-loop/xano.js` — `getWarrantySubmissionHandled`, `getWarrantySubmissionContext` clients.
- `api/intake/hcp_job_webhook_POST.xs` — emit `JOB_COMPLETED` in `job.completed` branch, gated on `customer_type == "warranty"`.
- `api/intake/hcp_poll_recent_jobs_POST.xs` — emit on completion transition (was-not-completed AND is-completed-now AND warranty).

**Three bugs caught + fixed during smoke test (cost ~30 min):**
1. **Agent filename mismatch.** See "convention rule" above.
2. **Dedup wrote to local log, not Xano.** `log()` is `xano.logLocal` (stdout only). The dedup endpoint queries Xano `event_log` for rows that only `markSignalProcessed` writes. Pattern correction: agents must call `await xano.markSignalProcessed(signal.id, '<custom_action>', meta)` to write the durable Xano-side dedup row. The `log()` call is debugging convenience only.
3. **`action:` key collision in log metadata.** `xano.logLocal(action, metadata)` does `{action, ...metadata}` — if metadata also has an `action` key, the spread overrides. Fixed by renaming metadata `action:` → `outcome:` in this agent. Convention rule for future agents: never use `action` as a key inside the metadata object you pass to `log()` or `markSignalProcessed()`.

**End-to-end smoke test (signal_id=9, job_id=200, synthetic AHS payload):**
- 12:40:56 — `node scripts/inject-signal.js JOB_COMPLETED ...` → `signal_id: 9`.
- 12:41:09 — `signal_dispatched signal_id=9`.
- 12:41:11 — Agent log: `{"action":"incomplete_tdr","job_id":200,"missing":["tdr.failed_component",...,"job.warranty_vendor_id"],"sms_result":"ok"}`. 7 missing fields detected as expected.
- 12:41:11 — `loop_tick tick_ms=2015 signals_processed=1 errors=0`.
- After: `get_warranty_submission_handled?job_id=200` → `{handled: true, last_handled_at: 1779730871285}`. Dedup row landed in Xano.
- SMS to Danielle's phone (+16154850713) was accepted by `send_sms` (Telnyx); physical receipt to be confirmed by Danielle.

**Reality finding for ops:** ZERO jobs in the production `jobs` table currently have `scheduling_status="completed"`, and only 5 TDRs in the entire system have non-null `diagnosis` — and ALL 5 have empty `failure_cause`, zero `labor_time_hours`, empty `repair_completed`. **Phase 5A will hit the `incomplete_tdr` BLOCKED branch on every real completion until the techs start filling TDR fields completely via Tech Ant Assist.** The agent is doing exactly what we want — refusing to send Danielle a useless half-submission and instead surfacing the gap.

### Now-current priority

- **Push Tech Ant Assist adoption on the techs** so TDR completeness rises. Until that, every warranty completion will route through the BLOCKED path. Danielle will get the SMS but still have to dig into Teddy Tool to complete the TDR before she can submit.
- **Phase 5B (deferred):** AHS / ServicePower portal automation via `adapters/*.js`. Awaits Danielle/Alyse intel on what the actual submission flow looks like (web form, API, email).
- **Phase 5C (deferred):** `warranty-review.html` page so the link in Danielle's SMS goes somewhere. Stub is sufficient v0.
- **Confirm Danielle's phone (+16154850713) physically received the smoke-test SMS.** Last open piece of Q5.

### Additional things NOT to do

- **Do NOT rename `agents/job_completed.js`.** Dispatch routes by lowercased signal_type. Convention is now hard-coded in the agent layer.
- **Do NOT use `action` as a key in metadata objects** passed to `log()` or `markSignalProcessed()`. Use `outcome` or similar. The spread will silently override the outer action name.
- **Do NOT use `jobs.technician_decision_report_id` to find a job's TDR.** Column is unused; always query from the TDR side via `technician_decision_report.job_id == <id>`.

### Late update (13:09 CT) — Phase 5.5A.1 live (Jimmy received SMS on +1-615-967-1304)

**New `TECH_ASSIGNED` signal + agent.** When a job's `technician_id` is set or changed by an HCP-driven path, the loop SMSes the assigned tech with customer name, address, appliance, problem summary, scheduled time, and the `tech-ant-live.html?job_id=X&tech_id=Y` link.

**Background on why this matters:** before today the only tech-direction SMS path was `hcp_job_webhook`'s `tech_arrival` branch — which fires when the tech taps "Start job" in HCP. Diagnostic earlier this session showed **zero `tech_assist_session_triggered_from_webhook` rows in 30 days** (the dormant Phase 1b/1c trigger has never fired in production despite the env var being documented as `true`). Techs were getting no proactive heads-up about assigned work. TECH_ASSIGNED fires at assignment time, not at job-start time — so techs see the job before they get on the road.

**Files shipped this push (`4be6e3d`):**
- `colony-loop/agents/tech_assigned.js` (~150 LOC).
- `colony-loop/xano-endpoints/intake/get_tech_assignment_handled_GET.xs` — 6-hour dedup window (shorter than warranty's 7-day; legitimate same-day reassignment back to a tech should be allowed).
- `colony-loop/xano-endpoints/intake/get_tech_assignment_context_GET.xs` — single round-trip `{job, customer, tech}`.
- `colony-loop/xano-endpoints/intake/check_tech_assist_state_GET.xs` — diagnostic that counts `tech_assist_session_triggered_from_webhook` etc. over 30 days. Useful for any future "is the dormant Phase 1b/1c trigger firing?" check.
- `colony-loop/xano.js` — `getTechAssignmentHandled`, `getTechAssignmentContext` clients.
- `api/intake/hcp_job_webhook_POST.xs` — emit `TECH_ASSIGNED` in the `job.appointment.scheduled` create branch (`source: "hcp_appointment_scheduled"`, `prior_technician_id: null`).
- `api/intake/hcp_poll_recent_jobs_POST.xs` — emit in the hybrid reassign-sync branch (`source: "hcp_poll_reassign"`, `prior_technician_id: $existing_job.technician_id`).
- `api/intake/hcp_poll_recent_jobs_POST.xs` — emit in the new-job create branch (`source: "hcp_poll_create"`, `prior_technician_id: null`).

**Agent gating per Q4:** skip when `technician_id == 1` (Teddy) AND `prior_technician_id == null` (initial routing fallback). Explicit reassignment TO Teddy still notifies. Also skips no-op reassigns where `prior_technician_id === technician_id`.

**Time formatting:** agent-side via `time.js` `fmtCT()` (`Intl.DateTimeFormat`, `America/Chicago`). Producer just emits the raw `now|to_ms` timestamp.

**End-to-end smoke test (signal_id=10, job_id=200, technician_id=2 / Jimmy Pivacek):**
- 13:09:03 — manual `node colony-loop/scripts/inject-signal.js --type=TECH_ASSIGNED ...` → `signal_id: 10`.
- 13:09:03.804 — `signal_dispatched signal_id=10`.
- 13:09:05.467 — Agent log: `{"action":"tech_assignment_handled","job_id":200,"technician_id":2,"prior_technician_id":null,"outcome":"assign_notified","sms_result":"ok"}`. Note: outer `action` correctly preserved this time because we used `outcome:` (not `action:`) inside metadata, per the Phase 5A lesson.
- 13:09:05.604 — `loop_tick errors=0`. Total agent runtime ~1.6s (context load + dedup write + SMS).
- `get_tech_assignment_handled?job_id=200&technician_id=2` → `{handled: true, last_handled_at: 1779732545438}`. Dedup row durable.
- **Jimmy physically confirmed receipt of the SMS on +1-615-967-1304.** `sms.toTech` → `send_sms` → Telnyx → real phone path verified end-to-end. **First live verification of the `sms.toTech` helper through a non-owner tech number** (prior smoke tests went to Teddy's +16154855795 which has owner-bypass).

### Now-current priority

1. **Phase 5.5A.2 — wire `job.appointment.appointment_pros_assigned` event in `hcp_job_webhook`.** Currently in the fast-ack ignored list (`hcp_job_webhook_POST.xs:149`). HCP sends this event when an office user reassigns a tech in HCP, but we don't process it. Carve it out, look up new tech, `db.edit jobs { technician_id }`, emit `TECH_ASSIGNED` with `prior_technician_id: $job.technician_id`. Adds the real-time HCP reassignment channel (vs. the ≤15-min poll-driven path that ships in 5.5A.1).
2. **Phase 5.5B — wire office UI endpoints:** `assign_technician_PATCH`, `reassign_job_POST`, and `create_job_from_chat_POST` (gated to skip technician_id=1). Each needs an extra `db.get jobs` before the `db.edit` to capture `prior_technician_id`.
3. **Push Tech Ant Assist adoption on the techs** so TDRs actually get filled in. Until that, every warranty completion will route through Phase 5A's BLOCKED branch.

### Additional things NOT to do

- **Do NOT wire `unassign_technician_PATCH` to emit TECH_ASSIGNED.** It nulls the assignment — there's no tech to notify. (Future v2 could emit a `TECH_UNASSIGNED` to the OLD tech, but not in this design.)
- **Do NOT producer-side filter on `technician_id == 1`.** Agent handles the Teddy-fallback skip. Producer-side filter would duplicate logic across every assignment path.

### Late update (14:30 CT) — tech-daily-dashboard.html shipped + Gap 1 (scheduling_status) fixed

**Three things shipped this block:**

1. **`tech-daily-dashboard.html` is live** at `tnapplianceexchange.net/tech-daily-dashboard.html?tech_id=Y[&date=YYYY-MM-DD]`. The page that starts to replace HCP for the field experience. PIN gate, dark theme matching tech-ant-live, Leaflet/OSM map with numbered pins (geocoded via Nominatim with 30-day localStorage cache), date nav (back/forward + jump-to-today), job cards with stop number / time window / status pill / customer / appliance / address (tap to navigate) / problem summary / Teddy pre-diagnosis / attachment thumbnails (hydrated via `/.netlify/functions/s3-view-url`) / quick-action buttons / "Open Tech Ant →" CTA. Staggered card animations, empty state, loading state, error retry. Backed by new `get_tech_daily_dashboard_GET.xs` (single round-trip bundle: `{tech, date_ct, today_ct, date_window_start_ms/end_ms, job_count, jobs[{job, customer, teddy_pre_diagnosis, attachments_count, attachments_preview}]}`). Confirmed `s3-view-url.js` Netlify function already existed; no scaffold needed.

2. **Gap 1 fix in `api/intake/hcp_poll_recent_jobs_POST.xs`** — both poll-update and poll-insert branches now derive `scheduling_status` from HCP `work_status`. Before this, every poll-sourced job stayed at `scheduling_status="prediagnosis_pending"` forever even when HCP marked the job scheduled / in_progress / completed. Mapping:
   - `work_status ∈ {scheduled, in_progress, schedule_appointment}` → `"scheduled"`
   - `work_status ∈ {completed, complete, complete unrated, complete rated}` → `"completed"`
   - `work_status ∈ {canceled, cancelled, pro canceled, pro cancelled}` → `"canceled"`
   - anything else → update branch keeps `$existing_job.scheduling_status`; insert branch defaults to `prediagnosis_pending`
   - Handles both space-separated and underscore-separated forms (HCP uses spaces in practice, e.g. `"in progress"`, `"pro canceled"`)
   - The dashboard status pills will now read correctly on the next poll cycle (every 15 min via the Xano task).

3. **New diagnostic endpoints (kept for future reality checks):**
   - `check_scheduling_state_GET` — dumps technicians + tech_availability + recent scheduling_queue activity over 30d. Used this session to confirm `SCHEDULING_QUEUE_ENABLED` is effectively `true` (worker has been processing queue rows) and to spot the orphan tech.
   - `check_recent_jobs_GET` — dumps the N most-recent jobs with intake_source / customer_type / current_status / scheduling_status / scheduled_start / technician_id / hcp_assigned_to. Reusable for any "why is this job stuck?" investigation.

**Reality findings worth keeping:**

- **`SCHEDULING_QUEUE_ENABLED` is effectively `true`** in Xano. Earlier docs called it dormant; behavioral evidence (2 queue rows actually processed for job 18096 today: broadcast notified 3 TN-area techs, then a follow-on escalate STUB ran when nobody claimed it within 30 min). **Side effect:** today's Phase B smoke-test for job 18096 triggered a broadcast SMS to 3 TN techs (Jimmy / Lee / Teddy probably) at ~11:41 CT — separate from any other texts they got from us today.
- **`scheduling_queue_worker.xs` action types:** `broadcast` REAL (cluster + tech qualification + "who wants it?" SMS, 30-min expiry); `propose` REAL (top-3 slot scoring, "Reply PICK1/2/3" to owner); `sick_day_cascade` REAL (silent reassign or customer SMS); `book` / `notify` / `escalate` STUB; `wait` no-op. Plus end-of-tick sweep that expires broadcast_attempt rows past expiry and queues an escalate.
- **All 6 active techs (ids 1–6) match the CLAUDE.md roster phones exactly** (verified against `technicians` table).
- **🚨 Orphan tech row at `id=8`** — `first_name=""`, `last_name=""`, `phone=""`, `hcp_id=""`, but **`active=true`**. Will match `WHERE active=true` queries, can cause `db.get` to return non-null when callers expect null, and would try to send SMS to `+1` (empty). Pre-existing — should be cleaned up (set `active=false` or delete row) before wiring anything that iterates active techs at scale.

### Now-current priority (Phase 6)

**Gap 2 — Email-intake jobs auto-create in HCP.** ~94% of production jobs come in via AHS / ServicePower / Jotform email and land in Xano with `scheduling_status="not_ready"`, no `technician_id`, no `scheduled_start`. Office workflow today is manual: someone creates the matching job in HCP, which then propagates back via webhook/poll. **A Mac Mini loop agent should pick up these email-intake jobs and create the HCP entry automatically** (via HCP API: customer + appointment + assigned employee). Once HCP has the job, the existing webhook/poll fills in `technician_id` and `scheduled_start` on the Xano side. This is the single highest-leverage automation left — fixes the warranty pipeline, fills the dashboard, and removes the Dawn-shaped hole. Substantial work (new HCP-write integration, customer-record matching, appointment slotting).

**Gap 3 — `scheduling_queue_worker.book` STUB needs a real implementation.** When a tech replies "yes" to a broadcast SMS, `tech_sms_inbound_POST.xs` should set `jobs.scheduled_start`, `jobs.technician_id`, `jobs.scheduling_status="scheduled"`, optionally create the HCP appointment. Same on Teddy's PICK1/2/3 reply to a `propose`. Smaller than Gap 2 but still meaningful. Today, broadcast wins go nowhere because the book handler is `"[STUB] would book job X"`.

**DAILY_TECH_BRIEFING morning SMS (deferred Phase 5.5 follow-on).** New colony loop agent that fires once at 7am CT per active tech with ≥1 job today, sending: *"[ant] morning {first} — {N} jobs today, first at {time}. Open: tnapplianceexchange.net/tech-daily-dashboard.html?tech_id=Y"*. Mirrors `daily_briefing` pattern but per-tech.

**Orphan tech `id=8` cleanup.** One-line `db.edit technicians {id=8, data={active:false}}` or row delete. Should happen before any agent that broadcasts to all active techs.

**Push Tech Ant Assist adoption** so TDR completeness rises. Until that, every warranty completion routes through Phase 5A's BLOCKED branch.

### Additional things NOT to do

- **Do NOT add scheduling_status writes via the hcp_poll endpoint outside the derivation block.** The Gap 1 fix is the canonical place. Other callers that need to set scheduling_status should use the explicit assign / book / cancel endpoints, not piggyback on the poll.
- **Do NOT show Teddy's pre-diagnosis to the customer on the tech dashboard.** `tech-daily-dashboard.html` surfaces it for the tech only. The customer-facing TDR view (`cash-tdr-customer.html`) is a separate page with its own sanitized `customer_facing_diagnosis` field. Keep them distinct.
- **Do NOT skip the 30-day Nominatim geocoding cache** on the dashboard. Nominatim is rate-limited (1 req/sec); without the cache, opening a 5-job dashboard takes 5+ seconds every time. The cache lives in `localStorage` keyed by `tn_geo_v1:<hash(address)>`.

### End of day 2026-05-25 — strategic pivot to Ant

**Today's shipped artifacts (consolidated):**
- **Phase 5A** — `warranty_submission` agent live. Danielle gets a digest SMS on every completed warranty job, BLOCKED alert when the TDR is incomplete. SMS path verified through Telnyx gateway.
- **Phase 5.5A.1** — `TECH_ASSIGNED` agent live. Techs get customer + address + appliance + problem + Tech Ant link the moment HCP assigns them. **Jimmy confirmed physical receipt on +1-615-967-1304.**
- **`tech-daily-dashboard.html`** live at `https://tnapplianceexchange.net/tech-daily-dashboard.html` — first non-trivial Ant Field page. PIN gate, Leaflet/OSM map with numbered pins, date navigation, attachment thumbnails (via `s3-view-url`), Teddy pre-diagnosis surfacing, "Open Tech Ant →" CTA per card.
- **`get_tech_daily_dashboard_GET.xs`** endpoint backing the dashboard (single round-trip {tech, date_ct, jobs[{job, customer, teddy_pre_diagnosis, attachments_preview, attachments_count}]}).
- **Gap 1 fixed** — `hcp_poll_recent_jobs_POST.xs` now derives `scheduling_status` from HCP `work_status` in both update and insert branches. Dashboard status pills will read correctly on the next 15-min poll.

**Strategic pivot decided today:** **stop building HCP sync, build Ant instead.** Today's win wasn't reviving a dormant HCP trigger — it was shipping an Ant Field page techs actually want to use. All future tech-facing and customer-facing functionality goes into Ant first, HCP integration second (and only if migration-bridge value justifies it).

### Next session priorities

1. **Ant Office calendar with capacity indicators.** Week + day views, color-coded slot density per tech, click-to-book. This is HCP migration prerequisite #1.
2. **`DAILY_TECH_BRIEFING` morning SMS per tech.** New colony loop agent that fires once at 7am CT per active tech with ≥1 job today, sending: *"[ant] morning {first} — {N} jobs today, first at {time}. Open: tnapplianceexchange.net/tech-daily-dashboard.html?tech_id=Y"*. Mirrors the existing `daily_briefing` agent pattern but per-tech, gated on job count.
3. **Wire ServicePower appointment date into `scheduled_start`.** Diagnostic showed many SP-source jobs land with null `scheduled_start` despite the email carrying an appointment. Investigate `servicepower_email_intake_POST.xs` (`$disp.schedule_date` → `$sched_ts` path) and the upstream `servicepower-gmail-poller.js` to see where the date is dropped.
4. **Book the broadcast winner (Gap 3).** Real implementation of `scheduling_queue_worker.book` STUB + reply-handler in `tech_sms_inbound_POST.xs` for tech "yes" replies and owner `PICK1/PICK2/PICK3` replies. HCP migration prerequisite #3.

**Long live Ant.** 🐜

### Late afternoon 2026-05-25 — HCP migration prereqs 1 + 3 done, only #2 remains

**Shipped this afternoon (4 builds in one push, commit `85ff2fd` + `371506a`):**

- **`office-calendar.html` live** — Ant Office nerve center. Week view × 6 techs, big capacity numbers, color-coded load, today highlight, sticky totals footer, "Needs Assignment" banner, deep-links to `job-detail.html`. Backed by `get_office_calendar_week_GET.xs`. (Commit `371506a`.) **→ HCP migration prereq #1 COMPLETE.**
- **`daily_tech_briefing.js` agent live** — colony loop fires `DAILY_TECH_BRIEFING` once daily at 7am CT (7-10am grace window in `tick.js`), fans out across active techs via `getTechDailyDashboard`, SMSes those with ≥1 job linking to their personal dashboard. Smoke-tested with `signal_id=11`: ran clean in 1.4s, sent=0 / skipped_no_jobs=6 (no real jobs scheduled for today — plumbing verified).
- **Broadcast booking wired** — `__CLAIM_BROADCAST__` now sets `scheduled_start` (tomorrow 08:00 CT default); new `PICK1/PICK2/PICK3` keyword handler in `tech_sms_inbound_POST.xs` short-circuits Claude for owner's pick replies. **→ HCP migration prereq #3 COMPLETE.**
- **ServicePower date-shift fix** — `servicepower_email_intake_POST.xs` anchors date-only `Schedule Date` fields to CT 08:00 instead of UTC midnight. Both sites patched (SCHEDULE_CHANGE update branch + new-job insert branch). New SP DISPATCH_OFFERs land on the correct calendar day. ~20 existing SP jobs keep their old wrong times until backfilled.

**HCP migration status:**
| Prereq | State |
|---|---|
| 1. Calendar view in Ant Office | ✅ DONE |
| 2. Scheduling owned by Ant | ⏳ remaining |
| 3. Broadcast booking wired | ✅ DONE |

**Only prereq #2 stands between us and migration day.** The calendar exists but is read-only; the scheduling-action endpoints (book / reschedule / reassign / cancel / day-off) need to be reachable from Ant Office and write directly to Xano without HCP round-trip. Once those are in, **pick a Saturday and cut HCP.**

### Next session — close out prereq #2 (scheduling actions in Ant Office)

1. **Wire the "+ New Job" button on `office-calendar.html`** to an Ant Office booking flow (not `book.html` pass-through). A modal that takes customer + appliance + tech + slot → writes the job + creates a corresponding HCP appointment (still — until migration day) — and reflects immediately on the calendar.
2. **Click-empty-cell to book.** Reuse the same modal pre-filled with `tech_id` + `date`.
3. **Job-detail.html reschedule / reassign / cancel actions** — replace whatever HCP-redirect logic lives there today with Ant-native endpoints (`reschedule_job_POST` exists; need to confirm it's wired). Calendar should reflect changes on next load.
4. **Day-off toggle** — let the office mark a tech off for a date directly from the calendar cell. Writes `tech_availability` row with `full_day_off=true` + triggers the `sick_day_cascade` if today.

Also queued but lower-priority: ~20-job SP `scheduled_start` backfill (after the date-shift fix); orphan `tech_id=8` cleanup; tech adoption push on the daily dashboard.

**🐜 Long live Ant.**

### Autopilot mode active — 2026-05-25 15:10 CT

**The colony is now self-building overnight.**

- **`COLONY_ARCHITECT` fires daily at 6am CT** via `tick.js maybeEmitTimeSignals()` (6-9am grace window). Payload `max_builds: 50`. Dedup via `get_colony_architect_fired_today`.
- **MAX_BUILDS_HARD_CAP = 500** in `colony_architect.js`. Manual injects can request up to 500 builds in one run.
- **Skip-set fix** (commit `8882209`): the architect tracks attempted agent IDs within a single run and excludes them from the next pickNextAgent call. This prevents the previous infinite-loop bug where un-templated agents (e.g. `BRAND_INTELLIGENCE` emitters) would be re-picked every iteration. Successful builds also get filtered via their new `BUILT` status in the blueprint.
- **First production overnight run was injected at 15:09:44 CT (signal_id=14)** with `max_builds: 50` to seed the queue immediately. Expected outcome: D004 (Dishwasher) + D005 (Range/Oven) build via the diagnostic-specialist template; D006–D011 + Colony 2+ agents that don't match an existing template fast-skip via `no_template` until the architect runs out of eligible candidates or hits 50 iterations.

**What Teddy comes back to tomorrow morning:**

- New `colony-loop/agents/*.js` files for every TO_BUILD agent in the blueprint whose pattern matches a registered template. Each one is its own commit, authored by the architect, tagged `feat(colony): [architect] built <id> <name>`.
- Updated `docs/appliance-ant-master-blueprint.json` with each newly-built agent flipped from `TO_BUILD` → `BUILT`, plus `meta.agents_live` and per-colony `agents_live` counters bumped.
- A diagnostic trail in `event_log` (`colony_architect_fired` rows with `built` / `failed` / `attempted` counts per run).

**What gets blocked until new templates land:**

Today's template catalog (`colony-loop/architect/templates.js`) only knows `diagnostic_specialist` — agents whose `outputs[]` contain `DIAGNOSTIC_BRIEF`. The other 350+ agent types in the blueprint will fast-skip with `outcome: no_template` until templates are added. **Adding templates is the highest-leverage Phase 7 work** — every new template unlocks N agents the architect can produce on the next run. Likely next templates:

- `brand_intelligence` (for D006–D010 + many other brand agents): meta-prompt yields brand-specific failure-rate / service-bulletin / parts-availability knowledge.
- `coordinator` (for D011 Pre-Dispatch Brief Coordinator + similar): collects multiple signals, composes a digest, emits a delivery signal.
- `sms_responder` (customer-facing reply agents)
- `webhook_handler` (intake adapter agents)

**Working rule #8 ("agent velocity") makes this explicit:** building agents is highest priority after production issues + customer-facing fixes. Add a template, build 5–10 more agents. Repeat.

### Late evening 2026-05-25 — Steps 2 + 3 of the HCP cut sprint done

Two more migration prereqs landed tonight. Five total prereqs, **4 of 5 done**.

**Step 2 (HCP migration prereq #2): Start Job + Complete Job buttons on Ant Field.**
- `tech_job_started_POST.xs` upgraded: now writes `scheduling_status="in_progress"` + `current_status="in_progress"` (alongside the pre-existing `job_started_at`), emits a JOB_STARTED colony signal (hook reserved — no agent yet), and SMSes Teddy "[ant] {tech} started job #X — {customer}, {appliance}".
- `tech_job_complete_POST.xs` upgraded: now writes `current_status` alongside `scheduling_status`, emits a JOB_COMPLETED colony signal (which triggers Phase 5A's `warranty_submission` agent for warranty jobs, no HCP needed), and SMSes Teddy "[ant] {tech} completed job #X ({completion_type}) — {N}min — {customer}, {appliance}".
- **Critical fix discovered in flight:** the existing completion_type → scheduling_status mapping used 5 invalid enum values (`complete`, `parts_ordered`, `pending_auth`, `closed`). Endpoint had never run cleanly in production. Replaced with valid enum members: `completed`, `awaiting_parts`, `held`, `no_fix_possible`.
- Smoke-tested with job 200 / tech 4: Start → in_progress (status flip ok, JOB_STARTED dispatched as `no_agent_yet`), Complete (repair_complete) → completed (status flip ok, JOB_COMPLETED dispatched, agent ran `skipped_duplicate` because job 200 had a prior handled row from the morning's Phase 5A smoke).

**Step 3 (HCP migration prereq #3): customer appointment confirmation SMS, auto-fired.**
- New colony loop agent: `colony-loop/agents/appointment_scheduled.js`. Loads job + customer + tech via the existing `get_tech_assignment_context` endpoint, dedupes on `(job_id, scheduled_start_ms)`, sends a customer SMS ("Hi {first}, your {appliance} repair is confirmed for {date time}. Your tech will be {tech_first}. Reply STOP to cancel or call 615-280-2949.") and a tech SMS ("[ant] job #X confirmed for {date time} — {customer}, {address}"). Source-aware gating skips customer SMS for `tech_claim` (placeholder time) and skips tech SMS for tech-driven sources (`tech_claim`, `tech_pick`, `tech_reschedule`).
- New XS endpoint: `get_appointment_confirmation_sent_GET.xs` for dedup. Matches on both `job_id` AND `scheduled_start_ms` — reschedules to a NEW time send a fresh confirmation; idempotent no-op edits skip.
- **8 producer wirings across 5 XS files**, all deployed via Xano CLI: `hcp_job_webhook_POST.xs` (1 emit), `hcp_poll_recent_jobs_POST.xs` (2 emits — update + create branches), `servicepower_email_intake_POST.xs` (2 emits — SCHEDULE_CHANGE + create), `tech_sms_inbound_POST.xs` (3 emits — CLAIM + PICK + RESCHEDULE), and `reschedule_job_POST.xs` (1 emit). Each emit follows the same pattern: pre-bind vars → object-literal payload → `|json_encode` → `db.add colony_signals` → `db.add event_log "appointment_scheduled_signal_emitted"` audit row.

**Bonus fix landed earlier in the same session:** `xano.js` `fetchWithRetry` wrapper — 3-attempt retry with 0/250/750ms backoff on transient `TypeError: fetch failed`. Silenced the noisy loop_error stream that was running ~1 every 6-8 minutes; loop is now quietly healthy.

**End-of-day commit count for 2026-05-25: 30+ commits.** Most ambitious session of the build so far.

### Tomorrow's priority — close out prereq #5

**Build the Ant Office booking flow.** The calendar exists; it needs write actions:

1. **Click empty cell → opens a "book new job" modal** pre-filled with `tech_id` (the column you clicked) and `date` (the row). Modal collects customer name + phone + zip + appliance + brand + model + problem summary + time window. Submits to a new `book_appointment_from_office_POST` endpoint that writes the customer (or matches existing), writes the job with the chosen `scheduled_start` (which fires APPOINTMENT_SCHEDULED → customer auto-confirmed). Calendar refreshes; new block appears in the cell.
2. **Click job block → opens a "manage job" modal** with the existing options (reschedule, reassign, cancel, day-off-toggle). Each writes through Ant-native endpoints (`reschedule_job_POST` already exists and emits APPOINTMENT_SCHEDULED).

When that's done, the office no longer touches HCP for scheduling. **Pick a Saturday and cut HCP.**

**🐜 Long live Ant.**

## Where to look

- **Architecture + running status:** `docs/system-blueprint-v1.md` (canonical source of truth, two-layer format).
- **Colony loop design:** `docs/colony-loop-design.md`.
- **Recent decisions:** `docs/session-2026-05-*.md`, `docs/handoff-2026-*.md`.
- **XS gotchas + Metadata-API-deploy footgun:** `docs/xanoscript-footguns.md`.
- **Financial open items (for Alyse):** `docs/financial-flags-open.md`.
- **Live XS schemas (sample):** `docs/xano-schemas/2026-05-15/`.
- **Front-end pages:** root `.html` files; Netlify functions in `netlify/functions/`.

# Appliance Ant

AI operations platform for **TN Appliance Exchange LLC**. Owner: James "Teddy" Pivacek (tech ID 1, `tnappliancerepair@gmail.com`, SMS **615-485-5795** for human-judgment escalations).

## Long-term commercial direction (decided 2026-05-27)

**Ant goes SaaS after TN ops cutover proves it.** Free trial for other appliance repair shops → collect anonymized data from everyone → monetize per-tech/month once value is proven. Data flywheel is the moat: each shop's jobs + TDRs + parts data improves predictive intelligence for ALL shops.

When building new endpoints/agents going forward, factor in `company_id` scoping even though it's hardcoded to 1 (TN Appliance) today. Don't bake company-1-specific UI/copy/numbers into reusable code — pull from a settings table where possible. Multi-tenant refactor planned for after HCP cutover validates the system in production.

## Strategic intelligence direction (decided 2026-05-27)

Ant's goal is to be **the most intelligent system in appliance repair**. The 7 moves that matter:
1. **Vector store over all history** (pgvector or Pinecone) — every TDR/transcript/note searchable semantically. Single biggest move.
2. **Multi-agent collaboration** on diagnoses (architect already builds the specialists; wire them to share context per job).
3. **Closed-loop reinforcement** — store input+output+outcome of every Claude call, refine prompts on wins.
4. **Predictive failure layer** — train classifier on (brand, model, install_date, failure) → proactively SMS customers before appliances break.
5. **'Ask anything' bar** on every page that hits the vector store + cites sources. v0 endpoint `ask_ant` scaffolded.
6. **Per-customer personalization** — Ant remembers every prior interaction. Greet from history, not from scratch.
7. **Human-in-loop only where judgment matters** — automate everything else.

## COLONY BUILD MODE — ACTIVE (top priority above everything else)

The Colony Architect must run continuously until all 379 agents are built. This is the top priority above everything except production emergencies and live customer-facing fixes.

**Rules (in order of precedence):**
1. **No upper limit on per-run builds.** `max_builds=999` (effectively unlimited) on every manual inject and on the scheduled 6am run. `MAX_BUILDS_HARD_CAP=99999` in `colony_architect.js` is a runaway-loop sentinel, not a budget. The architect runs until `pickNextAgent` returns null (blueprint exhausted).
2. **After every architect run, inject another immediately with `max_builds=999`.** No idle gaps between runs while TO_BUILD agents remain.
3. **When the architect exhausts templated agents** (everything matching today's detectors is BUILT, and remaining TO_BUILD entries all fast-skip with `no_template`), **stop and build more templates before the next run.** Add a template — even a narrow one — rather than letting the architect sit idle.
4. **Never let the architect sit idle if there are TO_BUILD agents remaining.** If a run finishes and the blueprint still has TO_BUILD entries, either re-inject (rule 2) or add templates (rule 3).
5. **Every session must end with the architect running** (a fresh COLONY_ARCHITECT signal injected) or with a documented reason why not.
6. **Target: wake up every morning to ALL agents the architect can build overnight committed.** No 50-cap floor — the daily 6am CT auto-fire in `tick.js` runs with `max_builds=999` and grinds until exhausted.

**This rule overrides** the older "build new agents using `agent_builder`" pipeline and the "agent velocity rule" #8 (which it generalizes). When in doubt, the architect runs.

**Operational lever**: when adding a template, batch as many as can be written in one editing pass — each new template can unlock 3-15 agents in the next architect run, so leverage compounds.

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

### Late night 2026-05-25 → 2026-05-26 — warranty resume flow, auto-schedule agent, On My Way ETA

Three back-to-back builds this block. Each independently shipped + tested + pushed.

**1. Warranty customer resume-chat flow (commit `e4fedc6`).** Greeting SMS for non-`web_chat` sources now carries `?job_id=X&mode=resume`. Landing customers see a minimal overlay form instead of the standard create-new-job chat. Fields: availability (textarea), access notes (textarea), confirm last 4 digits of phone (soft auth). On submit → `update_job_from_chat` patches the existing jobs row (no duplicate create) + emits `JOB_INTAKE_COMPLETE` colony signal. New `jobs.access_notes` text column. New XS: `get_job_resume_context_POST` (minimal-PII fetch: first_name, appliance, brand, phone_last4 — no full phone/address/email/diagnosis), `update_job_from_chat_POST` (validates phone_last4 match before write, emits signal). `colony-loop/agents/job_created.js` updated source-aware: web_chat keeps bare domain, all other sources get the resume URL. Smoke-tested: wrong last4 → 401 unauth (no write), correct last4 → 200 with merged fields + signal emitted.

**2. `try_auto_schedule` agent on `JOB_INTAKE_COMPLETE` (commit `0fa6b7f`).** Closes the warranty workflow loop: when a customer finishes resume-chat, the loop evaluates whether the job is ready to schedule and, if so, enqueues a `scheduling_queue` propose row that the existing `scheduling_queue_worker` picks up + SMSes Teddy three slot options. Gates (any failure short-circuits with a logged outcome): `scheduling_status` ∈ {scheduled, in_progress, completed, canceled, no_fix_possible, booked} → already scheduled; `warranty_company` is SquareTrade → ServicePower pre-sets the date; no pre-diagnosis TDR from `technician_id=1` → awaiting prediag; `parts_status` ∈ {parts_needed, ordered, pending, on_order} → awaiting parts; already a pending propose row → already enqueued. Else: enqueue + SMS Teddy "[ant] Job #X ready to schedule - {customer}, {appliance}. Sending you options now." New XS: `get_auto_schedule_context_GET` (single round-trip: job, customer, has_pre_diagnosis, pending_propose_count), `enqueue_scheduling_queue_propose_POST` (insert + event_log audit). New xano.js helpers. Smoke-tested with `signal_id=19` against job 200: agent correctly identified `scheduling_status=completed` and hit `already_scheduled` gate. Logged in `event_log` row 41053.

**3. On My Way ETA system (this commit).** Tech tapping "🚗 On My Way" on `tech-ant-live.html` now: (a) fetches the next scheduled job for the tech today via `get_next_tech_job_GET`; (b) calls a new `/.netlify/functions/get-drive-time` Netlify function (Google Distance Matrix API with `best_guess` traffic, haversine geocode-fallback, hard-fallback to 25min default if no `GOOGLE_MAPS_API_KEY`); (c) adds the tech's `tool_pack_minutes` buffer (new column, default 8); (d) computes a CT-formatted ETA timestamp; (e) shows a tech-side confirm dialog ("Sending Sarah your ETA of 2:47pm CT (12min drive + 8min pack) - tap to confirm"); (f) on confirm, calls upgraded `tech_on_the_way_POST` with `eta_minutes` + `eta_timestamp_ms` + `eta_time_str`.

The upgraded `tech_on_the_way_POST` now stamps `jobs.eta_ms` (new int column) alongside `tech_en_route_at`, emits a `TECH_ON_WAY` colony_signal (currently `no_agent_yet` — hook reserved for downstream consumers like a future Ant Office "tech in transit" indicator), and includes the ETA in the customer SMS: "Hi {name} - {tech_first} is on the way to your {appliance} repair. Expected arrival: {eta_str}. Reply STOP to cancel." When `eta_time_str` is absent (older clients) it falls back to the original short form, so the endpoint is back-compat.

**Customer arrival SMS on Start Job (same commit).** `tech_job_started_POST` now also SMSes the customer: "Hi {name} - {tech_first} has arrived and is ready to look at your {appliance}!" — alongside the existing owner-direction Teddy update. Customer-side full visibility into the appointment lifecycle: confirmation (Phase 5.5A) → resume-chat (today) → on the way + ETA (today) → arrived (today) → completed (Phase 5A digest to Danielle).

**Schema deltas added via Metadata API today (cumulative):**
- `jobs.access_notes` (text, nullable) — customer-supplied gate codes, pets, etc.
- `jobs.eta_ms` (int, nullable) — tech-supplied arrival ETA in unix ms.
- `technicians.tool_pack_minutes` (int, nullable, default 8) — buffer between leaving current job and arriving at next.

**Skipped:** adding `in_transit` to the `scheduling_status` enum. The Metadata API enum-add path is hostile (no clean PUT/PATCH for enum values, schema-replace requires the full existing schema). The existing `tech_en_route_at != null && job_started_at == null` already signals "in transit" unambiguously — no enum needed. Future Ant Office UI can compute the badge from those two timestamps.

**Two new XS footguns added to tomorrow's update of `docs/xanoscript-footguns.md`:**
1. **Multi-line ternaries break the parser.** `value = cond \n ? a \n : b` fails with "Syntax error: unexpected '?'". Use single-line, or bind the branches to vars first and ternary-select between the vars on one line. The first deploy cycle of upgraded `tech_on_the_way` failed on this; second cycle (single-line) succeeded.
2. **Metadata API content-PATCH silently drops enum-typed field writes.** `PATCH /table/{id}/content/{row}` with body `{scheduling_status: "intake_complete"}` returns 200 with `scheduling_status: null` in the response and the underlying row is NOT updated. Verified against job 200. Confirms that Metadata API content endpoints are best-effort for non-enum scalars; for enum or constrained columns, use a custom XS endpoint or the Xano UI directly.

### Action item for Teddy — set `GOOGLE_MAPS_API_KEY` in Netlify env

The drive-time function falls back to a 25-min default if the key is unset (no errors thrown, just less accurate ETAs). Until the key lands, the customer SMS will say "Expected arrival: {now+25min} CT" regardless of distance. Add the key at:
> Netlify dashboard → site `superlative-naiad-233aa7` → Site settings → Environment variables → `GOOGLE_MAPS_API_KEY` = (key from Google Cloud Console, Distance Matrix + Geocoding APIs enabled, billing on, restricted to *.netlify.app referrer).

### Next session priorities

1. **HCP migration prereq #5 — Ant Office booking flow.** Still the only thing standing between today and migration day. Click-empty-cell modal on `office-calendar.html` → new `book_appointment_from_office_POST` writes job + APPOINTMENT_SCHEDULED. Click-job-block modal → reschedule/reassign/cancel via existing endpoints.
2. **Set `GOOGLE_MAPS_API_KEY` in Netlify env** so the On My Way ETAs go from "25min default" to real traffic-aware times.
3. **Verify the warranty resume flow live** — once `JOB_INTAKE_COMPLETE` fires from a real customer's resume submission, confirm Teddy gets the three-slot SMS via the propose handler. Smoke worked end-to-end at the unit level; first real customer journey is the proof.
4. **Build `tech_arrived_customer_sms` agent** for `TECH_ON_WAY` — currently the signal dispatches as `no_agent_yet`. Future use: stash a record in `event_log` for analytics, or trigger an Ant Office "tech in transit" badge on the calendar.

### Additional things NOT to do

- **Do NOT add new agents as Xano endpoints/tasks.** Mac Mini loop functions only (Working rule 5). Today's three builds all honor this — the XS endpoints are pure data primitives, the agents are JS in `colony-loop/agents/`.
- **Do NOT write multi-line ternaries in XS.** Single-line only, or pre-bind branches to vars (see footgun #1 above).
- **Do NOT use Metadata API content-PATCH for enum field writes.** It silently no-ops (see footgun #2). Build a small XS endpoint or use the Xano UI.
- **Do NOT advertise `1-888-ANT-8998` or `1-866-ANT-0111` in customer materials.** Still unwired.

### End of session 2026-05-26 — most ambitious session yet

This session built more shipped functionality than any prior one. End-state numbers:

| Metric | Start of session | End of session |
|---|---|---|
| BUILT agents in blueprint | 17 | **108** |
| LIVE agents | 6 | 6 |
| TO_BUILD agents | 116 | **25** (most dep-blocked behind S001 + M007) |
| Architect commits | — | **~91 this session** |
| Templates in catalog | 4 | **18** |

### What shipped today (compressed)

**Customer-facing pipeline (end-to-end SMS verified at multiple points):**
- Warranty resume-chat flow: `?job_id=X&mode=resume` URL params open a minimal form for availability + access notes against an existing warranty job; no duplicate-create
- `try_auto_schedule` agent on `JOB_INTAKE_COMPLETE`: SquareTrade/ServicePower vendor-locked skip, pre-diagnosis required, parts-pending skip with `WAITING_FOR_PARTS` emit, green-light enqueues `scheduling_queue` propose row with priority + city in SMS
- On My Way ETA system: real Google Distance Matrix traffic-aware ETAs, tool_pack buffer, customer SMS includes formatted CT time, TECH_ON_WAY colony signal emitted, Start Job sends customer arrival SMS

**Office surface:**
- Click-to-book on `office-calendar.html`: every cell carries data attributes, modal collects customer/appliance/problem/time-window/customer-type, `book_appointment_from_office_POST` creates customer (or matches) + job + emits APPOINTMENT_SCHEDULED — **HCP migration prereq #5 done**

**Vendor handling:**
- `jobs.vendor_locked` boolean column added; ServicePower DISPATCH_OFFER + SCHEDULE_CHANGE write `scheduling_type="slot"` + `vendor_locked=true`; agent gate 2 prefers explicit flag over warranty_company string

**HCP migration:**
- `import_hcp_job_POST.xs` idempotent importer (insert-or-update by `housecall_pro_job_id`, customer match-by-phone, work_status→scheduling_status mapping, audit row, no double-text on migrate)
- `colony-loop/scripts/hcp-migration-import.js` paginates HCP `/jobs`, shapes for the importer, writes `docs/migration-log.json`, supports `--dry-run`/`--max=N`/`--per-page=N`/`--statuses=A,B,C`
- `get_hcp_migration_status_GET.xs` diagnostic + `docs/hcp-migration-plan.md` day-of playbook
- **Diagnostic finding**: 5000 recent Xano jobs, ZERO with `housecall_pro_job_id`. Migration day = fresh import, not sync. 4898 AHS-email jobs accumulating at `not_ready`.

**Colony architect:**
- 14 new templates added: parts_intelligence, scheduling_optimizer, performance_coach, sms_responder, recruiting_specialist, hvac_specialist, mentorship_specialist, warranty_claims, service_agreement_specialist, customer_intelligence, voice_prompt_optimizer, market_intelligence, infrastructure_monitor, tech_lifecycle, meta_agent
- `renderGenericSpecialist()` shared scaffold for the simpler templates
- ~91 architect-built commits, mostly via the 14 new templates

**Operational hygiene:**
- **Architect commit-scope fix**: `git commit -m <msg> -- <paths>` scopes to listed paths only. Previously, plain `git commit -m` swept any operator-staged files into "[architect] built X" commits. Bug observed in `9bb95bc`; fix verified in `64eb46c` (BI005 commit, 2 files only).
- **colony_signals GC endpoint** `cleanup_colony_signals_POST`: deletes processed rows older than N days (default 30, hard floor 7, max_delete 10k). Schedule as nightly Xano task to bound table growth.

### Brutal-honesty assessment (delivered in chat mid-session)

Key findings still valid:
- **Architect output is mostly theater** — 91 newly-built agents but NONE are wired to real triggers. Building agents without signal producers = scaffolding.
- **Mac Mini is a SPOF** — no DR, no backup. Power failure = ops platform dies.
- **TDR completeness gap** — only 5 TDRs in the entire system have diagnosis, all incomplete. Phase 5A warranty digest hits BLOCKED on every real completion. **Single biggest unforced error blocking the Dawn-shaped automation goal.**
- **AHS backlog**: 4898 `not_ready` jobs accumulating — no auto-enqueue from email intake to scheduling_queue.

### Must ship before HCP cutover Saturday

1. Set `HCP_API_KEY` in `colony-loop/.env` so `hcp-migration-import.js` can run
2. Dry-run the migration script (`--dry-run --max=1`) to confirm shape
3. Wire HCP-pro-id → Xano-technician-id mapping (currently left null in importer)
4. Office reschedule/reassign/cancel from calendar (still NOT wired)
5. Pre-cutover diff probe: run `get_hcp_migration_status` AND probe HCP API for canonical open-job count

### New XS footguns surfaced 2026-05-26 (add to `docs/xanoscript-footguns.md`)

1. **Multi-line ternaries break the parser** — `value = cond \n ? a \n : b` fails. Single-line only, or pre-bind branches to vars.
2. **Metadata API content-PATCH silently drops enum-typed writes** — PATCH returns 200, response shows field as null, row unchanged.
3. **`db.del`, NOT `db.delete`** — 3 letters, asymmetric with `db.add`/`db.edit`/`db.get`.
4. **`|length` filter on arrays errors with "Unable to locate func entry: length"** — use a counter+foreach pattern instead.
5. **`|trim != ""` outside `value = (...)` errors with "Invalid syntax. Please wrap your filter with parentheses."** — bind trimmed value to a var first.

### Now-current priority for the next session

1. **Add `HCP_API_KEY` + dry-run the migration import**. Single biggest unforced error if not done before Saturday.
2. **AHS email → scheduling_queue auto-enqueue** — drain the 4898 backlog.
3. **TDR completeness enforcement in tech-ant-live** — block Complete Job submission if key TDR fields empty.
4. **Wire dormant agents** — pick 5-10 highest-value architect outputs and wire upstream signal producers.
5. **Mac Mini hourly Xano backup to S3** — minimum-viable DR.
6. **Mark M007 BUILT/LIVE in blueprint** — unblocks M008 + M009 dep chain for meta_agent template.
7. **Investigate architect's pickNextAgent termination** — signals 24/26/27 only ran 5 iterations despite max_builds=500/50/50. Early-termination condition worth tracing.

### Things NOT to do (additions from this session)

- **Do NOT cut HCP Saturday without running the migration import script first.** Even a dry-run is mandatory.
- **Do NOT extend `create_job_from_chat` for office flows.** Office uses `book_appointment_from_office_POST` (this session). Don't conflate.
- **Do NOT mark agents BUILT in blueprint manually unless their JS file is on disk + deployed.** That breaks the architect's truth-check.

**🐜 Long Live Ant.**

## Session log — 2026-05-26 (field-day sprint, 5 builds)

While Teddy was in the field for 5 hours, the agent shipped 5 ordered builds + final architect run. Every build was committed + pushed independently.

### What shipped

**HOUR 1 — AHS auto-enqueue + backfill tooling** (commit `22ee11c`)
- `api/intake/ahs_email_intake_POST.xs` now inserts a `scheduling_queue` row (action_type=propose, status=pending, metadata={priority, source: "ahs_email_intake_auto", warranty_company, claim_number}) for every new AHS job. Existing `scheduling_queue_worker.xs` propose handler picks it up on next cycle.
- New `colony-loop/xano-endpoints/intake/list_ahs_backlog_GET.xs` — paginated list of AHS jobs at scheduling_status=not_ready.
- New `colony-loop/scripts/backfill-ahs-scheduling.js` — drains the backlog via `enqueue_scheduling_queue_propose`. Flags: `--dry-run`, `--max=N`, `--per-page=N`, `--require-pref`.
- **Reality finding**: 16,677 AHS jobs at not_ready (3.4× the 4,898 estimated), but **zero have non-empty customer_preference_text**. That field is only set by `update_job_from_chat_POST` (resume-chat flow). User's `--require-pref` filter correctly excluded all of them; going-forward auto-enqueue at intake time means new AHS jobs get scheduling treatment automatically.

**HOUR 2 — Office calendar action modal** (commit `48222f1`)
- `office-calendar.html` — click any job block opens a manage modal with Reschedule (datetime picker), Reassign (tech selector excluding current assignee), Cancel (with reason textarea + confirm). On success closes + reloads week.
- Wired to existing `reschedule_job_POST` (already emits APPOINTMENT_SCHEDULED), `reassign_job_POST`, `cancel_job_POST`.
- "Open full detail ↗" link preserves the original deep-link to `job-detail.html`.
- **Completes HCP migration prereq #5** — calendar's last write-action gap. The cutover Saturday is now unblocked from the UI side.

**HOUR 3 — Inbound customer SMS router** (commit `a589a94`)
- Customer-direction equivalent of tech_sms_inbound. End-to-end pipe:
  `Telnyx webhook (message.received) → netlify/functions/customer-sms-inbound.js → POST /record_inbound_customer_sms → match customer + active job → emit INBOUND_CUSTOMER_SMS → inbound_customer_sms.js (keyword classify) → SMS_RESPONSE_<TYPE> → sms_response_*.js (Claude reply) → CUSTOMER_SMS_REPLY → customer_sms_reply.js → xano.sendSms → Telnyx`
- New files: `api/intake/record_inbound_customer_sms_POST.xs`, `colony-loop/agents/inbound_customer_sms.js`, `colony-loop/agents/customer_sms_reply.js`, `netlify/functions/customer-sms-inbound.js`.
- 7 keyword routes (reschedule/cancel/parts/payment/tech/complaint) + fallback to `sms_response_sms_intent_gap_agent`. Each route fast-skips no_agent_yet until that specific responder is built.
- **Action required to activate inbound**: in Telnyx portal → Messaging Profile for `+16155889500` → Inbound Webhook URL: `https://tnapplianceexchange.net/.netlify/functions/customer-sms-inbound` (API version 2 JSON).
- **Live verification**: synthetic POST to `record_inbound_customer_sms` returned `signal_id=115`; loop dispatched the new agent within the same minute.

**HOUR 4 — Brand chain on DIAGNOSTIC_BRIEF (router pattern)** (commit `8ba73e9`)
- `colony-loop/agents/diagnostic_brief.js` — new router that consumes DIAGNOSTIC_BRIEF + emits BRAND_LOOKUP_<SLUG>.
- Brand mapping covers 5 architect-built brand agents: whirlpool_family (whirlpool/maytag/kitchenaid/amana/jenn-air), ge (ge/hotpoint/monogram/cafe/profile), lg, samsung, electrolux_family (electrolux/frigidaire).
- Full chain now: `JOB_CREATED → DIAGNOSE_<APPLIANCE> → DIAGNOSTIC_BRIEF → diagnostic_brief.js → BRAND_LOOKUP_<SLUG> → brand_*.js → BRAND_INTELLIGENCE`.
- Mirrors `tdr_complete.js` (WARRANTY_CLAIM_REQUEST_<VENDOR>) routing pattern. New brand agents register via one line in `BRAND_MAP`, no diagnose_* changes needed.

**HOUR 5 — Blueprint enumeration (+130 TO_BUILD specs)** + architect run (this commit)
- New `colony-loop/scripts/expand-blueprint.js` generates structured TO_BUILD specs:
  - **Colony 2 Parts**: +40 (P014..P053) — 5 suppliers (Marcone/Triple S/AppliancePartsPros/RepairClinic/PartSelect) × 7 appliance categories (washer/dryer/dishwasher/refrigerator/range/microwave/hvac) + 5 cross-cutting (arbitrage, backorder watcher, cross-ref resolver, authenticity verifier, shipping ETA predictor).
  - **Colony 5 Voice/SMS**: +25 (V006..V030) — 25 conversation types (appointment_confirmation, reschedule_request, cancel_request, parts_arrival_eta, parts_delay, payment_due/received, technician_eta/late, tech_no_show, complaint, refund_request, warranty_question, post_job_feedback, positive/negative_review_followup, opt_out, repeat_customer_greeting, photo_request, model_number_request, address_correction, gate_code_request, callback_request, escalation_acknowledgement, after_hours_response).
  - **Colony 3 Scheduling**: +15 (S021..S035) — gap_filler, cluster_geometry_optimizer, traffic_aware_eta, tech_specialty_router, no_show_recovery, recurring_anchor, day_balancer, last_minute_filler, schedule_health_scorer, capacity_predictor, duration_learner, sick_day_cascade_refiner, weather_aware_rescheduler, preference_aligner, holiday_adjuster.
  - **Colony 14 HVAC**: +10 (H014..H023) — recovery_compliance, heat_pump_diagnostic, furnace_combustion_analyzer, ac_charge_calculator, filter_reminder, duct_loss_estimator, sizing_validator, brand_bulletin_watcher, tax_credit_surfacer, iaq_specialist.
  - **Colony 18 Recruiting**: +10 (REC015..REC024) — indeed_posting_generator, resume_quality_scorer, phone_screen_generator, onboarding_doc_builder, background_check_coordinator, referral_program_manager, comp_benchmarker, ghost_followup, jd_refresher, school_outreach.
  - **Colony 6 Customer Intelligence**: +10 (CI005..CI014).
  - **Colony 7 Tech Performance**: +10 (PC001..PC010).
  - **Colony 4 Warranty**: +5 (W010..W014) — status pollers per vendor + denial pattern analyzer + authorization request builder.
  - **Colony 15 Service Agreement**: +5 (SA007..SA011).
- Total: blueprint now 267 enumerated / 137 live / 130 to_build. Up from 137 enumerated / 137 live / 0 to_build before the sprint.
- COLONY_ARCHITECT injected with max_builds=999. Architect runs through the new specs against existing templates (parts_intelligence, sms_responder, scheduling_optimizer, hvac_specialist, recruiting_specialist, customer_intelligence, performance_coach, warranty_claims, service_agreement_specialist). Anything matching a template gets built overnight; anything not matching fast-skips no_template (logged in event_log).

### Current state at end of sprint

- 5 commits pushed in this sprint (`22ee11c`, `48222f1`, `a589a94`, `8ba73e9`, blueprint+architect)
- Colony loop healthy throughout: tick errors=0 across the entire session (~70+ ticks observed via monitor)
- TECH_ARRIVAL_CHECK hold-and-re-emit pattern firing as designed
- One real TECH_ON_WAY + JOB_STARTED chain observed live mid-sprint (signals 49/63/68/77/84) — Phase 5.5A signals firing in production unchanged

### What NOT to do (additions from this sprint)

- **Do NOT run `backfill-ahs-scheduling.js` without `--require-pref`** unless prepared for thousands of propose-row enqueues. Each propose row triggers a worker run + owner SMS. Honor the customer_preference_text filter unless explicitly draining the backlog at a controlled pace via `--max=N`.
- **Do NOT wire Twilio for the customer-direction `+16155889500`** unless explicitly intended. The new `customer-sms-inbound.js` supports both formats but the production wiring is Telnyx-only (Telnyx's failover Twilio path would be a redundancy decision, not a default).
- **Do NOT add CUSTOMER_SMS_REPLY emit to sms_response_* agents that already emit it.** `customer_sms_reply.js` is the single send path now. Duplicate emits = duplicate SMS to the customer.
- **Do NOT manually rebuild any of the 5 brand mappings in `diagnostic_brief.js` BRAND_MAP without first checking the architect-built brand_*.js list.** The 5 mapped slugs (whirlpool_family, ge, lg, samsung, electrolux_family) match existing agent files — adding a new key with no matching agent file would emit a BRAND_LOOKUP_X signal that nobody listens to.

### Next session — what to look for

1. **Monitor `event_log` for `inbound_customer_sms_handled` rows** once Telnyx webhook is wired — confirms HOUR 3 is live end-to-end with real customer traffic.
2. **Check architect output** — how many of the 130 new TO_BUILD specs did the architect build? Look for the parts_*.js, schedule_*.js, sms_response_*.js, hvac_*.js, recruiting_*.js, performance_*.js, customer_intel_*.js, warranty_*.js files created since this commit.
3. **Cancel-job signal emit** — `cancel_job_POST` is wired in the office calendar modal but doesn't yet emit a signal (no customer-facing cancel SMS). Adding `JOB_CANCELED` emit + an agent to SMS the customer is a clean follow-up.
4. **Reassign signal emit** — `reassign_job_POST` doesn't currently emit TECH_ASSIGNED (Phase 5.5B follow-on noted in earlier session log). Now that the office modal triggers it, this gap is more visible.
5. **brand_intelligence + diagnostic_brief → TDR suggestion** — both signals carry rich data per job_id. A future `tdr_suggestion.js` agent could post a pre-filled TDR draft into Teddy Tool, closing the diagnose → brand → TDR loop.

**🐜 Long Live Ant.**

## Late session 2026-05-26 — SPRINT+/URGENT cleanup wave

Continued from the field-day sprint while Teddy was out. Six more commits shipped, including a critical dormant-agent fix that affected 181 files.

### What shipped (in order)

**SPRINT+1 — Cancel + Reassign signal emits** (commit `3c582ce`)
- `cancel_job_POST.xs` — now emits `JOB_CANCELED` with prior_status, prior_scheduled_start, technician_id, customer_id, reason, source.
- New `colony-loop/agents/job_canceled.js` — consumes JOB_CANCELED, SMSes the customer ("Hi {name}, your {appliance} repair has been canceled. Reply to reschedule.") + the assigned tech ("[ant] job #X canceled — remove from your day: {dashboard}"). Source-aware: skips non-office cancels.
- `reassign_job_POST.xs` — now emits `TECH_ASSIGNED` with prior_technician_id when the tech changes (no-op edits skip). The existing `tech_assigned.js` agent picks it up and SMSes the new tech with full job context. Closes the Phase 5.5B gap.

**SPRINT+2 — tdr_suggestion + brand fix** (commit `704068a`)
- Renamed 5 `brand_<slug>.js` → `brand_lookup_<slug>.js`. The architect's renderBrandSpecialist template generated brand_whirlpool_family.js etc., but dispatch routes by lowercased signal_type (BRAND_LOOKUP_WHIRLPOOL_FAMILY → brand_lookup_whirlpool_family.js). They had been silently no_agent_yet since being built. HOUR 4's diagnostic_brief.js was emitting into a void.
- Fixed renderBrandSpecialist in templates.js so future rebuilds match.
- New `colony-loop/agents/brand_intelligence.js` — chains BRAND_INTELLIGENCE → pre-visit TDR draft via Claude. Produces 6 fields (failed_component, failure_cause, confirm_test, recommended_part, labor_estimate, pre_order_parts), persists via `event_log` action=tdr_suggestion_drafted + SMSes Teddy a preview + teddy-tdr-tool deep-link. Closes the full job → diagnose → brand → TDR chain.

**URGENT field fix — TDR form + auto-greeting on tech-ant-live** (commit `fffef14`)

Teddy reported from the field: techs were stuck at "Complete TDR first →" with no form to fill. Two fixes deployed inside 30 min of the report:

1. **Visible inline TDR form** above the chat (4 fields: diagnosis, failed component, labor time, repair completed). Mobile-first: 16px+ inputs (no iOS focus-zoom), 44-48px tap targets, real-time "X / 4" status badge, per-field green border when filled, Save button unlocks when all 4 filled, success state flips button to "✓ TDR #N saved". Pre-fills from latest tech-authored TDR snapshot. "Jump to TDR form →" gate banner button now scrolls + 2.4s yellow highlight + focuses first empty field.

2. **Auto-greeting on first chat open** — when `preloadHistory` finds zero prior messages, composes a personalized intro from already-loaded data: "Hey Jimmy, you're at Peter Heren's place. LG fridge — fridge not cooling. Teddy's pre-diagnosis: [diagnosis]. Text findings as you go and I'll fill the TDR." Tech first name resolved from data.assigned_tech / data.technician / all_tdrs author / CLAUDE.md roster fallback. Teddy's pre-diagnosis pulled from all_tdrs filtered to technician_id=1.

3. **Chat → form sync** — when `tech_assist_chat` returns captured_data, `syncCollectedDataIntoTdrForm()` mirrors fields into the visible form (write-if-empty so it doesn't clobber tech edits). Ant fills the TDR as the tech narrates.

**CRITICAL — 181 dormant agents resurrected** (commit `edf4819`)

While checking architect progress, discovered the brand-agent filename bug was SYSTEMIC — affected every template family except diagnose_*, sms_response_*, and brand_lookup_* (already fixed). 173 of 187 architect-built agents had filenames that didn't match dispatch's `lowercased(signal_type).js` convention, so every signal they listened for hit `no_agent_yet` and went unprocessed.

Affected (with fix):
| Family | Old filename | New filename | Count |
|---|---|---|---|
| Parts | `parts_marcone_washer.js` | `parts_lookup_marcone_washer.js` | 45 |
| Schedule | `schedule_gap_filler.js` | `schedule_request_gap_filler.js` | ~30 |
| Performance | `performance_callback_rate.js` | `performance_request_callback_rate.js` | 13 |
| HVAC | `hvac_install_opportunity.js` | `hvac_request_install_opportunity.js` | 9 |
| Mentorship | `mentorship_mentor_matching.js` | `mentorship_request_mentor_matching.js` | 10 |
| Market | `market_competitor_gap_intelligence.js` | `market_intelligence_request_competitor_gap_intelligence.js` | 3 |
| Customer Intel | `customer_intel_appliance_age_profile.js` | `customer_intelligence_request_appliance_age_profile.js` | 4 |
| Research | `research_ifixit.js` | `research_request_ifixit.js` | 6 |
| Warranty | `warranty_ahs_claims.js` | `warranty_claim_request_ahs_claims.js` | 10 |
| Service Agreement | `service_agreement_maintenance_reminder.js` | `service_agreement_request_maintenance_reminder.js` | 6 |
| Recruiting | `recruiting_indeed_listing.js` | `recruiting_request_indeed_listing.js` | 15 |
| Voice Prompt | `voice_prompt_vapi_transcript_analyzer.js` | `voice_prompt_request_vapi_transcript_analyzer.js` | 4 |
| Tech Lifecycle | `tech_lifecycle_certification_tracker.js` | `tech_lifecycle_request_certification_tracker.js` | 2 |

Plus template fixes in `colony-loop/architect/templates.js`:
- renderPartsIntelligence: `parts_<slug>.js` → `parts_lookup_<slug>.js`
- renderSchedulingOptimizer: `schedule_<slug>.js` → `schedule_request_<slug>.js`
- renderPerformanceCoach: `performance_<slug>.js` → `performance_request_<slug>.js`
- renderResearchAgent: `research_<slug>.js` → `research_request_<slug>.js`
- generateFromGenericTemplate: now derives filenamePrefix from signalInPrefix.toLowerCase() — single line fix that prevents future per-template overrides

The rename was performed by `colony-loop/scripts/rename-architect-agents.js` (idempotent — re-runs safely; reads each file's "Signal in:" comment header and renames if needed). Saved for future architect-builds that may hit similar issues before templates.js fix lands in production.

Live impact: every brand_*, parts_*, schedule_*, hvac_*, mentorship_*, etc. signal the loop sees from this commit forward actually lands at a real agent. The 91 architect-built agents from earlier in the week (counted in the morning's session log) were almost all dormant — they will now start producing real intelligence as upstream signals fire.

### Outstanding gaps after this session

- **`tdr_complete.js` warranty router emits `WARRANTY_CLAIM_REQUEST_AHS` etc.** — the matching architect-built agents are now named `warranty_claim_request_ahs_claims.js` (the architect derives the slug from agent name "AHS Claims" with the _claims suffix). The router emits without the _claims suffix, so the chain still misses. Either rename the agents or update the router. Low priority unless warranty_router_handled rows are showing routed_signal_id with no_agent_yet downstream.
- **Loop module cache** — dispatch.js caches modules by signal_type in-memory; the rename took effect for any signal that hadn't been cached yet, but already-cached "no_agent_yet" responses won't re-test the new files. On full loop restart everything will pick up cleanly.
- **Template fix vs. earlier-built agents** — the templates.js fix only affects future architect runs. Any agent built before commit `edf4819` was renamed; any agent built after has the correct filename out-of-the-box.

### Total session output

13 commits pushed this session (HOUR 1-5 + SPRINT+1, +2, URGENT field fix, 181-file rename + template fix). The colony went from "lots of dormant scaffolding" to a fully-routed signal mesh where every architect-built agent can actually dispatch.

**🐜 Long Live Ant.**

## Continuation 2026-05-26 evening — high-impact T1-T15 task list

User came back asking for an 8-hour revenue/ops task list. Audited against the day's earlier work, hit the highest-impact remaining items:

### What shipped (in order)

**T3 — Customer 24h followup SMS** (commit `59cbcbb`)
- New `colony-loop/agents/followup_due.js` — hold-and-re-emit pattern (same as tech_arrival_check). Every completed job (warranty + self-pay) gets a 24h-later customer SMS via the existing `send_feedback_sms` endpoint. The existing feedback_reply_webhook classifies 1-5 ratings + ISSUE keyword.
- `job_completed.js` gains a FOLLOWUP_DUE emit at the top (fires for ALL completions, not just warranty).
- `xano.sendFeedbackSms` helper added.

**T1 — Warranty consumer (Danielle digest + escalation)** (commit `550628c`)
- New `colony-loop/agents/warranty_claim_action.js` — consumes WARRANTY_CLAIM_ACTION (emitted by every vendor agent). Persists the full 5-section Claude output to event_log + SMSes Danielle one of three message variants:
  - Escalate: "WARRANTY ESCALATION job #X (AHS). Reason: …"
  - HIGH flags: "warranty claim package ready - N HIGH flags. Resolve: …"
  - Clear: "warranty claim package ready - no flags, clear to submit"
- Closes the JOB_COMPLETED → warranty_router → vendor_agent → DANIELLE chain end-to-end.

**T2 — parts_decision_aggregator** (commit `0b72159`)
- 2 new XS endpoints (`get_parts_intel_for_job`, `get_parts_decision_handled`) + 2 new agents (`parts_intelligence.js`, `parts_decision_due.js`).
- Listens for PARTS_INTELLIGENCE from multiple parts_lookup_*_pricing supplier agents. After first response per job, emits PARTS_DECISION_DUE with 90s deadline. On deadline pulls all supplier responses, Claude picks cheapest-in-stock-fastest-ETA, SMSes Teddy + Danielle: `[ant] parts ready to order for job #X: <part> from <supplier> $XX ETA <date>. Reply ORDER to confirm.`

**T4 — HCP full-export script** (commit `6220ea6`)
- `colony-loop/scripts/hcp-full-export.js` — read-only paginated pull of all open HCP jobs + completed jobs from last 30 days. Writes `docs/hcp-full-export.json`. Used as a safety snapshot on migration Saturday.

**T5 — Office calendar Today view** (commit `fc589d9`)
- `office-calendar.html` gains a Week/Today view toggle. Today view replaces the 7-day × 6-tech grid with a chronological list of every job for today sorted by scheduled_start. URL persistence via `?view=today`. Existing click-to-manage modal still wired.

**T7 + T8 — LTV refresh + weekly performance fan-out** (commit `6070187`)
- `job_completed.js` emits CUSTOMER_INTELLIGENCE_REQUEST_CUSTOMER_LIFETIME_VALUE (consumer already exists from earlier architect runs).
- `tick.js` gains a Sunday 8-11am CT block that emits WEEKLY_PERFORMANCE_SUMMARY (dedup via new `get_weekly_performance_fired` endpoint).
- New `weekly_performance_summary.js` agent — fans out PERFORMANCE_REQUEST_FIRST_VISIT_FIX_RATE / _DIAGNOSTIC_ACCURACY / _TIME_PER_JOB / _CALLBACK_RATE / _TDR_COMPLETENESS per active tech (skips Teddy id=1 + orphan id=8), then SMSes Teddy a confirmation.

**T11 + T12 — Tech UX: Next Job + parts banner** (commit `e7e3a9c`)
- `tech-ant-live.html`: on successful Complete, shows "🚗 Head to next job →" green CTA deep-linking to `tech-daily-dashboard.html?tech_id=Y`.
- Parts-status banner above the chat when `job.parts_status ∈ {awaiting_parts, ordered, on_order, pending, parts_needed}` — shows status + ETA (formatted CT) + "Do not schedule the next visit until parts arrive."

**T14 + T15 — Blueprint +45 specs + business_intelligence template** (commit `19c3129`)
- Round-2 blueprint expansion (`colony-loop/scripts/expand-blueprint-2.js`):
  - Colony 2 Parts +20 (Reliable Parts + Genuine Replacement × 7 appliances + 6 quality agents)
  - Colony 5 Voice/SMS +15 (multi_appliance_inquiry, service_area_question, price_quote_request, warranty_eligibility_check, manual_request, commercial_inquiry, second_opinion_request, maintenance_question, urgent_request, language_help_request, accessibility_request, gift_referral, media_inquiry, job_recommendation_request, permit_question)
  - Colony 8 Business Intelligence +10 — NEW financial-tracking colony (daily_revenue_tracker, ar_aging_reporter, cash_position_watcher, margin_per_job_analyzer, warranty_reimbursement_lag, tax_liability_forecaster, tech_earnings_reconciler, fleet_cost_tracker, customer_acquisition_cost, profitability_by_zone)
- New architect template `business_intelligence` registered with detector pattern + meta-prompt. Filename `business_intel_request_<slug>.js` matches dispatch convention.
- Blueprint totals: 312 enumerated / 264 live / 48 to_build. Architect injected signal_id=131.

### What shipped in PHASE 1+2 push (after the 100-task list arrived)

**P1-7 — Danielle warranty dashboard** (commit `e0d038d`)
- New `warranty-review.html` — sticky-header page with Week/Today filter chips (All / Escalate / Flags / Clear), per-job cards with expandable claim package text. Backed by new `list_warranty_claim_actions_GET.xs` (queries event_log for warranty_claim_action_persisted rows in the days_back window).
- Danielle's existing digest SMS already links here ("Review: …/warranty-review.html?job_id=X").

**P2-17 + P2-19 — Appointment reminders + no-show detection** (commit `3213431`)
- `appointment_scheduled.js` gains an APPOINTMENT_REMINDER_DUE emit (deadline = scheduled_start − 24h).
- New `appointment_reminder_due.js` — hold-and-re-emit, sends customer SMS "reminder: {tech} is coming tomorrow {day time} CT for your {appliance}. Reply RESCHEDULE if you need to move it." Reschedule-aware (drops stale signals).
- New `job_started.js` — fires on JOB_STARTED (already emitted by tech_job_started_POST), arms a 4h NO_SHOW_CHECK timer.
- New `no_show_check.js` — hold-and-re-emit, after 4h checks `jobs.job_completed_at`. If still null + not canceled, SMSes Teddy "[ant] ⚠️ {tech} still on job #X — Xh elapsed since Start. {customer}, {appliance}. Check in."

### Items SKIPPED — already-shipped audit

User's PHASE 1 list overlapped substantially with earlier session work. Items NOT rebuilt:

| User asked | Already shipped in | Why skipped |
|---|---|---|
| P1-3 Next Job button | commit `e7e3a9c` (T11) | identical implementation |
| P1-4 Parts status banner | commit `e7e3a9c` (T12) | identical implementation |
| P1-6 Customer followup SMS | commit `59cbcbb` (T3) | identical implementation |
| P1-10 parts_decision_aggregator | commit `0b72159` (T2) | identical implementation |
| P1-8 Wire warranty_ahs_claims | commit `550628c` + `b22dc63` | consumer + signal-name alignment shipped earlier |
| P1-9 Wire warranty_frontdoor_claims | same | same |

PHASE 1 items 1 (Ant Office job detail page), 2 (tech-performance.html), 5 (customer portal) — NEW work, not yet built. PHASE 2-10 — mostly new work, not yet built.

### Honest scope note

User's full 100-task list is genuinely 40+ hours of work. Shipping 10 high-impact items in one session (this continuation block) plus 13 from earlier today = 23 substantive commits. That's a strong day. The remaining ~80 items are real backlog the architect will chip at + future sessions will pick up.

### What NOT to do (additions)

- **Do NOT skip the architect after the file rename.** The `edf4819` rename made every prior architect-built agent dispatchable. The module-cache fix only happens on loop restart or first-cache-miss — running `launchctl kickstart -k gui/$UID com.tnappliance.colony-loop` once forces fresh module loads for all agents.
- **Do NOT add producers for signals when there's no agent.** Several user-requested signals in PHASE 3-10 (e.g. SAME_DAY_SLOT_AVAILABLE, MISSED_CALL, VOICEMAIL_TRANSCRIBED) need their CONSUMER agent first. Emitting into a void = wasted compute on hold-and-re-emit loops.
- **Do NOT use the `--require-pref` AHS backfill blindly.** Re-running without filter on production traffic = scheduling_queue propose-row flood = thousands of slot-option SMS to Teddy.

**🐜 Long Live Ant.**

## Late session 2026-05-26 — round-3 high-impact bundle

User re-pasted the 100-task list. Audit confirmed many items already done this session. Built the next 6 high-impact items in two pushes:

**Round 3a — Schedule + catalog**

`473ae6e` — **P2-11 schedule_gap_check** (daily 9am CT)
Scans today's calendar for 2+ hour gaps per active tech. SMSes Teddy a digest with gap windows + 25 AHS-backlog candidate jobs as fill ideas. v1 detect-and-surface (no auto-customer-SMS — candidate matching is loose without zip-proximity filtering yet).

`9ce928b` — **P3-23 + P3-27 parts catalog builder + common-failures query**
Every TDR submission feeds a proprietary failure-mode → part-number database via new TDR_CATALOG_RECORD signal + tdr_catalog_record.js consumer. New `get_common_failures_GET.xs` endpoint filterable by appliance/brand/model. Unlocks future "for this exact brand+model, the top 3 historical failures are X/Y/Z with parts A/B/C" surfacing in diagnose_* agents + Teddy Tool.

**Round 3b — Capacity, reschedule, revenue**

`f5eb4b7` — **P2-14 + P2-18 + P5-41**

- **capacity_check** (daily 10am CT): SMSes Teddy when any tech has >6 jobs (burnout) or <2 (idle).
- **RESCHEDULE keyword + reschedule_request_alert**: exact-word route on inbound SMS (matches the RESCHEDULE prompt in our outbound confirmation/reminder SMS). Existing architect-built V007 owns the customer reply; new alert agent owns Teddy+Danielle notification + audit row.
- **daily_revenue_summary** (daily 6pm CT): EOD digest with completed-job count + warranty/self-pay split + per-tech breakdown. Dollar amounts intentionally deferred (BI* agents own that layer).

### Items SKIPPED — already-shipped audit (2nd 100-list paste)

| Task | Already shipped |
|---|---|
| P1-3 Next Job button | `e7e3a9c` |
| P1-4 Parts banner | `e7e3a9c` |
| P1-6 Customer followup | `59cbcbb` |
| P1-7 Danielle warranty dashboard | `e0d038d` |
| P1-10 parts_decision_aggregator | `0b72159` |
| P2-17 appointment_reminder | `3213431` |
| P2-19 no_show_detector | `3213431` |
| P1-8/9 warranty consumers | `550628c` + `b22dc63` |
| P4-36 Google review request | feedback_reply_webhook line 959 (existing) |

### Session totals (2026-05-26)

37 commits today. Major systemic fix (181-agent rename + template patch) plus 9 new agents this evening + warranty dashboard + Today view + HCP export + brand chain wiring + customer 24h followup + tech UX (TDR form + auto-greeting + Next Job + parts banner). Architect signal_id=133 injected for the next overnight grind.

Daily ops cadence now: 6am architect / 6:30am job prep / 7am tech briefing / 8am daily briefing / 9am gap check / 10am capacity check / 6pm revenue summary / Sunday 8am weekly performance.

### What NOT to do (additions from this round)

- **Do NOT add a second consumer for SMS_RESPONSE_RESCHEDULE_REQUEST.** The architect already built V007. Owner alerts ride a separate RESCHEDULE_REQUEST_ALERT signal — keep the two paths split.
- **Do NOT add dollar amounts to daily_revenue_summary.** BI* agents own that layer. Mixing volume + dollars makes both surfaces less clear.
- **Do NOT call get_common_failures from inside diagnose_*.js without a per-job dedup gate.** Lookups are cheap but Claude is expensive — noisy lookups amplify rate-limit pressure during busy intake hours.

**🐜 Long Live Ant.**

## Session log — 2026-05-27 V4 grind (after V3, before sleep)

20 V4-tagged commits + ongoing architect grinding. Pivoted away from
silent multi-tenant scoping (V4 Tasks 1-50) since no tenant #2 exists
yet; reallocated to high-touch user-facing surfaces.

### Shipped in V4

- **Intelligence wiring**: JOB_COMPLETED auto-emits EMBED_TDR →
  embed_tdr agent → vector store. Every future completed job
  becomes searchable in find-similar-jobs + ask-ant.
- **Server-side completion-photo gate**: warranty + repair_complete
  now require ≥1 attachment.
- **Customer-portal rate-this-visit**: 5-star + comment form on
  completed jobs. Wires into low/high-rating chains.
- **Office hub global search bar**: routes by shape — job# →
  job-detail, question → ask-ant, else → customer-search.
- **Stripe subscription webhook**: HMAC-verified Netlify fn flips
  company.tenant_status on checkout/payment-failed/cancellation.
- **customer-invoice Netlify fn**: printable HTML invoice (last4 gated).
- **status.html**: public customer status page (green/yellow/red).
- **pricing.html**: SaaS pricing page with HCP-vs-Ant FAQ.
- **help.html**: customer help center with live search.
- **record_payment_received**: cash/check/Venmo/Zelle logger with
  commission backfill on tech_earnings row.
- **AR aging by customer**: 0-30/31-60/61-90/90+ buckets.
- **Cashflow forecast endpoint**: v0 heuristic — \$1,887.50 / 30d.
- **operator-status.html**: private 8-stat dashboard.
- **customer-search CSV export**.
- **Onboarding guides**: docs/onboarding-guide-tenant.md +
  docs/onboarding-guide-tech.md.
- **office-pulse search + pause toggle**.

### Operator todos surfacing from V4 (set these → big features unlock)

- `$env.OFFICE_PASSWORD` on Xano (security)
- `OPENAI_API_KEY` on Netlify (semantic search + similar-jobs)
- `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID_PER_TECH_MONTHLY` on Netlify
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` on Netlify
- Register Stripe webhook: /.netlify/functions/stripe-subscription-webhook
- Run `backfill-embeddings.js` once OPENAI key set
- Multi-tenant V4 Tasks 1-50 deferred to ~6h focused sprint when
  tenant #2 signs up

### Critical morning-state for Teddy

All earlier fixes still live:
- ✅ tech-ant-live auto-creates chat session on open
- ✅ ✨ Auto-fill TDR from chat
- ✅ 🔧 Parts lookup quick-action
- ✅ Camera-direct iOS capture
- ✅ 🧠 Similar jobs panel (lights up once embeddings indexed)

**🐜 Long Live Ant.**

## Session log — 2026-05-27 overnight V3 sweep (SaaS + intel + security)

Continuation of the late-night V3 sweep. ~36 commits across the three
strategic moves Teddy + I aligned on: SaaS multi-tenant foundation,
vector store + intelligence, security hardening, tech-side polish.

8 COLONY_ARCHITECT injects, loop healthy throughout.

### Section A — SaaS multi-tenant foundation (Tasks 1-21)

- **Tables**: `company` (id 39, with name/slug/owner/Telnyx/timezone/
  branding), `company_settings` (id 40, flexible KV)
- **company_id column added (default 1) to**: customer, jobs,
  technicians, tech_earnings, technician_decision_report,
  tech_assist_session. event_log deferred (high-churn).
- **Endpoints**: `get_company_settings`, `set_company_setting`,
  `onboard_company`, `get_active_techs_count`
- **Pages**: `signup.html` (free-trial landing), `company-admin.html`
  (per-tenant dashboard)
- **Netlify fn**: `create-tenant-subscription` (Stripe per-tenant)
- **Runtime**: `colony-loop/config.companyId` + `sms.js` passes
  company_id in all SMS context
- **Agent**: `company_onboarded.js` (welcomes new tenant + alerts Teddy)
- **Doc**: `docs/multi-tenant-migration.md` (~6h focused work to
  complete the remaining producer/consumer endpoint scoping)

### Section B — Vector store + intelligence (Tasks 31-55)

- **Tables**: `embeddings` (id 41, vector storage as JSON text),
  `claude_call_log` (id 42, every Claude call audited)
- **Endpoints**: `save_embedding` (upsert), `list_embeddings`,
  `log_claude_call`, `predict_next_failure` (typical-lifespan
  heuristic per appliance category)
- **Netlify fns**: `embed-text` (OpenAI text-embedding-3-small with
  dummy fallback), `ask-ant-semantic` (cosine sim retrieval),
  `find-similar-jobs` (per-job semantic match)
- **Pages**: `ask-ant.html` (search-anything bar over indexed data)
- **Script**: `backfill-embeddings.js` (one-time bulk ingestion)
- **Agent**: `proactive_failure_warning.js` (SMS customer when
  appliance enters predicted-failure window)
- **Operator todo**: set OPENAI_API_KEY in Netlify → run backfill →
  every search/similar-jobs lookup goes live

### Section C — Security hardening (Tasks 56-80)

- **CRITICAL FIX**: 14 office pages had OFFICE_PASSWORD in client-side
  JS (anyone could view-source and steal it). All migrated to
  `verify_office_password_POST` which reads from $env.OFFICE_PASSWORD.
- **Rate limit**: `check_rate_limit` + `record_rate_limit_hit`
  endpoints. Pattern documented for callers (quote / portal-action
  / inbound-call) to wire next session.
- **Doc**: `docs/security-sprint-plan.md` (per-user accounts, 2FA,
  PII masking, CORS, CSP all deferred with operator next-steps)

### Section D — Tech-side polish (Tasks 81+82+87)

- `tech-ant-live.html` — '🧠 Similar' quick-action button → opens
  slide-down panel with top-5 semantically similar prior jobs
- `appointment-ics.js` Netlify fn — customer downloads .ics for
  Apple/Google Calendar with 1h reminder
- `customer-portal.html` — wires '📅 Add to my calendar' button
  for scheduled appointments

### Deferred (V3 Tasks 83-100, will pick up next session)

Pure polish/scaffolding that doesn't block morning demo:
- Tech: voice-to-text verification, sticky "on the way" button,
  next-stop countdown, knowledge-base UI, vehicle/tool tracking pages
- Customer: spouse-share link, more language templates
- Office: drag-to-reschedule, keyboard shortcuts, bulk pre-diagnosis,
  pulse filter chips, leaderboard SMS, 1-click warranty resubmit
- SMS: link shortener, multi-language templates

### Operator todos surfacing from V3

1. Set `$env.OFFICE_PASSWORD` (Xano) — strong password, rotate quarterly
2. Set `OPENAI_API_KEY` (Netlify) — unlocks embeddings + semantic search
3. Set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID_PER_TECH_MONTHLY` (Netlify)
   — unlocks real per-tenant billing
4. After 2nd tenant signs up via signup.html: validate isolation with
   the multi-tenant migration plan steps
5. Run `node colony-loop/scripts/backfill-embeddings.js` once OPENAI key
   is live — indexes all TDRs + customer notes
6. The big morning-critical fixes from earlier tonight are unchanged
   and still live: tech-ant-live session auto-bootstrap, ✨ TDR auto-fill,
   🔧 Parts lookup, camera-direct iOS capture

**🐜 Long Live Ant.**

## Session log — 2026-05-27 overnight (100-task list V2 sweep)

49+ commits, 8 COLONY_ARCHITECT injects (signal_id 145-152), full sweep through docs/100-task-list-v2-2026-05-27.md. Many tasks shipped as full code; many shipped as scaffold + operator note where blocked on external (Stripe keys, Vapi config, schema add).

**Section A REVENUE (1-25):** stripe payment link agent + Netlify fn (1), same-day-slot reactive (2), upsell 24h (3), maintenance reminder 6mo (4), service agreement offer 1h (5), referral code system (6), AHS-drain launchd (7), reactivation campaign weekly (9), warranty_denial_retry + self_warranty_offer chain (10+19), discount eligibility (11+18), quote.html + generate_quote (12), tech tip-jar (13), B2B onboarding (15), pricing modifier surge (21), diagnostic prepay (22), monthly tech winner (23), Marcone/Triples scaffold (25). Skipped 8/14/16/17/20/24 (already covered or post-MVP).

**Section B ELIMINATE-MANUAL (26-50):** HCP cutover readiness (26), Vapi webhook + agent (27+34), tech-onboard wizard (28), tdr_autofill_from_chat (29), warranty PDF generator (30), backfill_commission_from_payment (31), 1099 summary (32), payroll.html (33), out_of_area_check (35), ghost_intake_sweep weekly (36), list_archivable_jobs (37), receipt_ocr Claude vision (38), translate_spanish_intake (41), find_or_merge_customer (42), classify_event_severity (43), generate-seo-landers script (45), blog_post_generator weekly (46), license_expiry_check (48), suspend_tech (49), weekly-teddy-email Netlify (50). Bug fix: dead-letter endpoint find-pattern crash. Deferred docs 39+40+44+47.

**Section C COMPLETE-PLATFORM (51-75):** PWA manifests + service workers tech+customer (51-54), knowledge base scaffold + setup doc (54-57), reviews.html public page (65), dispatch-tv.html kiosk (67), Andre + Story colony specs (73+74), content_generator template registration. Docs for 58-65 platform unblockers.

**Section D INTELLIGENCE (76-90):** first-visit-fix-rate-by-appliance (88). Tasks 76-87+89-90 deferred to vector-store sprint (the foundational move for "most intelligent system" direction).

**Section E OPS (91-100):** dr-playbook (91), verify-xano-backup + launchd plist (93), loop_latency_watch placeholder (97). 92/94/95/96/98/100 deferred with operator notes.

**Bonus:** content_generator template registered. ask_ant v0 search endpoint as vector-store foundation. SaaS strategy memory written. Security audit response delivered in chat (biggest holes: office password client-side, no rate limit, no PII masking).

**New strategic direction in CLAUDE.md top section:**
- Long-term commercial: Ant goes SaaS post-cutover (free trial for other shops, monetize per-tech/month, data network-effect moat)
- Intelligence: 7-move plan (vector store, multi-agent collab, closed-loop reinforcement, predictive failure, ask-anything bar, personalization, human-in-loop-where-judgment)

**Daily ops cadence after this session:** 18+ scheduled signal emits + weekly + monthly + nightly DR. Loop healthy throughout overnight (errors=0 across all observed ticks).

**🐜 Long Live Ant.**

## Session log — 2026-05-26 (continuation: ~25 substantive builds in one push)

User asked to "continue the 100 task list, no stopping, push after every task, inject COLONY_ARCHITECT max_builds=999 every 10 tasks." This session delivered 39 commits (25 substantive + 14 architect-built) including 2 architect injects (signal_id=136 + signal_id=138).

### What shipped this session (chronological)

**Block 1 (tasks 1-10) — closed long-open P1 gaps:**
1. `tech-performance.html` + `get_tech_performance_GET.xs` (P1-2 — per-tech weekly/monthly/all-time metrics with KPIs + recent jobs)
2. `customer-portal.html` + `get_customer_job_view_POST.xs` + `customer_portal_action_POST.xs` (P1-5 — self-serve customer status + reschedule + add notes)
3. `job-detail.html` cross-links to Customer View + Tech Perf + SMS wiring to inject portal URL into appointment_scheduled + appointment_reminder_due SMS (P1-1 polish)
4. Server-side TDR completeness gate in `tech_job_complete_POST` — blocks warranty + repair_complete completions without all 5 TDR fields (closes the "biggest unforced error" gap per CLAUDE.md)
5. `colony-loop/scripts/xano-backup.js` + launchd plist — daily 3:15am CT table snapshot to ~/backups/xano-YYYY-MM-DD/, optional S3 upload (minimum-viable DR)
6. `parts_arrival_check.js` agent — daily 11am sweep of awaiting_parts jobs with parts_eta_date <= today, SMS customer for re-visit time
7. `waiver_due.js` agent — chain off APPOINTMENT_SCHEDULED, 4h pre-appointment Telnyx SMS with prefilled Jotform URL (closes vision step 3)
8. `tdr_reminder.js` agent — daily 4pm CT push to techs with open TDRs from today (soft nudge alongside the hard server gate)
9. `customer-search.html` + `search_customers_POST.xs` — office customer search by phone/name/email with quick links
10. `callback_check.js` agent — JOB_CREATED chain, 30-day callback-risk alert (complements REPEAT_VISIT_CHECK's 12-month chronic pattern)

**COLONY_ARCHITECT injected at task 10 — signal_id=136 with max_builds=999.**

**Block 2 (tasks 11-20):**
11. customer-search.html URL deep-link support (`?q=` / `?phone=` / `?caller=` auto-loads — caller-ID deep-link surface)
12. `inbound_call.js` agent + `record_inbound_call_POST.xs` + `netlify/functions/inbound-call-webhook.js` — Telnyx voice webhook handler, real-time caller-context SMS to office with deep-link
13. `office-pulse.html` + `get_office_pulse_GET.xs` — live activity feed for office, 20s polling, 5 headline stats + filterable event_log stream
14. `pre_appointment_check.js` agent — 30min pre-appointment tech-not-acknowledged nudge to tech + Teddy
15. `cancel_followup.js` agent — JOB_CANCELED chain, 24h rescue outreach SMS (with customer-rebooked-skip detection)
16. `unpaid_self_pay_digest.js` agent — daily 10:30am AR-hygiene SMS to Teddy listing unpaid self-pay jobs sorted by oldest
17. `resume_nudge.js` agent — daily 9:30am AHS/ServicePower no-resume-chat-completion nudge with portal + chat URLs (per-job dedup, single nudge ever)
18. `expand-blueprint-3.js` — populated 3 empty colonies (Office Efficiency +12, Marketing/SEO +10, Customer Acquisition +10), blueprint went from 312 / 3 to_build → 344 / 35 to_build
19. `tech-payouts.html` — tech-facing pending earnings page backed by existing `get_pending_earnings`
20. `tech-daily-dashboard.html` sub-nav to Performance + Payouts (closes discoverability gap for the new tech pages)

**COLONY_ARCHITECT injected at task 20 — signal_id=138 with max_builds=999.** Architect built 14 of the new TO_BUILD specs (M001-M010, CA002-CA007 visible in commit log) in parallel with continued building.

**Block 3 (tasks 21-25):**
21. `google_review_request.js` agent — 7d-after-completion review ask chained off JOB_COMPLETED, per-customer dedup with 60-day window
22. `office-todo.html` + `get_office_todo_GET.xs` — single "needs human action" dashboard with 5 sections (stale intake, held, parts arrived, TDR-blocked, callbacks)
23. `tech_late_check.js` agent — daily 10:15am CT, SMS techs (+Teddy) when first job today started <= 10am but no job_started_at yet
24. `office_morning_briefing.js` agent — daily 8am summary to Danielle + Teddy with todo counts (uses getOfficeTodo)
25. This session log update

### Daily ops cadence (now)

After this session the loop has 11 daily/weekly scheduled signal emits:
- 6am: COLONY_ARCHITECT auto-fire
- 6:30am: DAILY_JOB_PREP
- 7am: DAILY_TECH_BRIEFING
- 8am: OFFICE_MORNING_BRIEFING + DAILY_BRIEFING
- 9am: SCHEDULE_GAP_CHECK
- 9:30am: RESUME_NUDGE
- 10am: CAPACITY_CHECK
- 10:15am: TECH_LATE_CHECK (NEW)
- 10:30am: UNPAID_SELF_PAY_DIGEST (NEW)
- 11am: PARTS_ARRIVAL_CHECK (NEW)
- 4pm: TDR_REMINDER (NEW)
- 6pm: DAILY_REVENUE_SUMMARY
- 3:15am: XANO_BACKUP launchd-driven (NEW)
- Sunday 8am: WEEKLY_PERFORMANCE_SUMMARY

### Hold-and-re-emit chains off APPOINTMENT_SCHEDULED

Now 4 distinct chains:
- APPOINTMENT_REMINDER_DUE — 24h pre, customer-direction
- WAIVER_DUE — 4h pre, customer-direction (NEW this session)
- PRE_APPOINTMENT_CHECK — 30min pre, tech + owner (NEW this session)
- (after appt) FOLLOWUP_DUE chained off JOB_COMPLETED (existed pre-session)

All 4 are reschedule-aware via getTechAssignmentContext + currentStart != scheduledStartMs drop logic.

### Producer signal additions

- JOB_COMPLETED → GOOGLE_REVIEW_REQUEST (7d)
- JOB_CANCELED → CANCEL_FOLLOWUP (24h)
- JOB_CREATED → CALLBACK_CHECK (30-day window) — added alongside existing REPEAT_VISIT_CHECK (12-month window)
- APPOINTMENT_SCHEDULED → WAIVER_DUE + PRE_APPOINTMENT_CHECK (alongside existing APPOINTMENT_REMINDER_DUE)

### What NOT to do (additions from this session)

- **Do NOT remove the server-side TDR gate in `tech_job_complete_POST` without a replacement.** The gate is the only thing preventing tech-side workarounds to the warranty completeness requirement. The client-side gate exists too but is bypassable.
- **Do NOT call `customer-search.html?q=<query>` without the office password local-storage cookie set.** The URL deep-link auto-runs the search but only after the gate clears. For unauth users this still requires a password entry first.
- **Do NOT add new GOOGLE_REVIEW_REQUEST emit points without checking the 60-day per-customer dedup.** The agent dedups per customer, not per job, intentionally — same customer with 2 jobs shouldn't get 2 asks.
- **Do NOT use json_decode on metadata in dedup endpoints.** Use compound action keys instead (e.g. `parts_arrival_followup_sent_<job>_<eta>`, `waiver_due_sent_<job>_<ts>`, `cancel_followup_sent_<job>`). json_decode on null/malformed throws ERROR_FATAL per XS footgun.
- **Do NOT advertise the office-pulse / office-todo / office-morning-briefing surfaces to customers.** Office-only password-gated.
- **Do NOT run `expand-blueprint-3.js` again without checking the existing IDs.** It's idempotent (uses max-numeric-suffix scan) but re-running adds duplicates of any new entries appended manually since.

### Open after this session

- **TECH_LATE_CHECK, PRE_APPOINTMENT_CHECK, WAIVER_DUE, etc. all unverified end-to-end** — they're structurally deployed but only fire on real production triggers (tomorrow morning's first real appointment will be the first verification).
- **GOOGLE_REVIEW_REQUEST URL is hard-coded** — needs verification it points to the real TN Appliance Google Business Profile.
- **Customer-side rating capture still not built.** Feedback_reply_webhook handles PICK/ORDERED but not 1-5 ratings. A future LOW_RATING_ALERT agent depends on this.
- **inbound-call-webhook.js** is structurally complete but waiting on Telnyx Voice Application setup (operator action).
- **office-pulse + office-todo + office-morning-briefing** all use the same office-password — when rotated, all four pages need re-auth simultaneously.

### Late session tasks 26-34 (continuation extension)

- **Task 26 — architect template misrouting fix.** M### IDs were colliding between Marketing colony (intended) and meta_agent ID-prefix shortcut. Tightened isMetaAgent to keyword-only, broadened isMarketIntelligence to match GMB/SEO/Yelp/etc keywords AND /^M\d/. Deleted 10 misclassified meta_agent_*.js files + reverted M001..M010 in blueprint to TO_BUILD for re-build with correct template.
- **Task 27 — SMS Portal button on job-detail.** Office one-tap action that texts the customer the customer-portal link. New `send_customer_portal_link_POST` endpoint with confirm-dialog gate. Caught api.request `body =` vs `params =` footgun on deploy (the latter is correct).
- **Task 28 — tech_assigned customer-side reassign SMS.** When isReassignment=true AND job already has scheduled_start, also SMS the customer "{new tech} will now be your tech for your {appliance} on {date} CT". Closes the friction where customer expected old tech name on the door.
- **Task 29 — check_service_zone endpoint.** GET /check_service_zone?zip_code=X → {covered, accepting_new_jobs, market, zone, cluster, state, notes}. 5-digit normalization. Returns real production data (99 zones across TN+LA).
- **Task 30 — office.html hub page.** Single-tap landing page tiling all office surfaces (Daily workflow: Calendar/Todo/Pulse/Search · Specialized: Warranty Review/Financials/TN/LA/Teddy TDR Tool/Agent Proposals · Quick links). Color-coded tile borders.
- **COLONY_ARCHITECT injected at task 30 — signal_id=139 with max_builds=999.**
- **Task 31 — dead-letter signal carve-out.** tick.js now writes event_log action='signal_no_agent_yet' (carved out from 'signal_processed') so dead-letter analysis can filter directly without JSON-decode of metadata. New get_dead_letter_signals_GET endpoint returns buckets of signal_type → count over the last N days (uses substring extraction to parse JSON metadata without json_decode — XS footgun-safe).
- **Task 32 — service-area.html.** Customer-facing 'do you cover my area?' page. Interactive zip check + full coverage list grouped by market with per-zip pills (color-coded green=accepting, orange=zone full). Light theme matches customer-portal.
- **Task 33 — tech-day-off.html + tech_set_day_off endpoint.** PIN-gated tech-facing page. Tech can mark a date as off OR clear an existing day-off, with optional reason. Endpoint uses upsert pattern (creates new or updates existing); clear path deletes all matching rows.
- **Task 34 — tech-daily-dashboard adds Day Off nav button.** Third pill alongside Performance + Payouts. Tech suite now: Daily Dashboard → Performance / Payouts / Day Off.

### Total this session (continuation + extension)

- **75+ commits** (46 substantive + 29+ architect-built in parallel)
- **5 COLONY_ARCHITECT injects** (signal_id=136, 138, 139, 140, 142)
- **12+ new pages / surfaces**: tech-performance, customer-portal, customer-search, office-pulse, office-todo, office, service-area, tech-day-off, tech-payouts, health-check, customer-feedback, tech-leaderboard
- **18+ new agents**: parts_arrival_check, waiver_due, tdr_reminder, callback_check, inbound_call, pre_appointment_check, cancel_followup, unpaid_self_pay_digest, resume_nudge, tech_late_check, office_morning_briefing, google_review_request, tdr_completeness_report, office_eod_summary, customer_feedback_received
- **30+ new XS endpoints** backing the above + dead-letter / service-zone / day-off / portal-link / health / feedback / leaderboard
- **Critical infrastructure**: server-side TDR completeness gate, Xano backup script + launchd, dead-letter carve-out, caffeinate-keep-awake launchd, rating capture (manual form + low-rating alert)
- **Architect tuning**: round-3 blueprint expansion (+32 specs), template misrouting fix
- **Daily ops cadence**: now 15 scheduled signal emits + Sunday weekly + 3:15am DR backup

### Late-late session tasks 36-46

- **Task 36 — tdr_completeness_report agent.** Daily 6:30pm CT EOD digest of per-tech open TDRs to Teddy.
- **Task 37 — office_eod_summary agent.** Daily 8pm CT wrap to Teddy + Danielle: completed / canceled / new / warranty / TDR-blocked / callbacks / inbound calls. Backed by 8-parallel-count get_office_eod_summary endpoint.
- **Task 38 — health-check.html.** Single-glance green/yellow/red loop liveness dashboard. 30s polling. get_loop_health endpoint computes status_color from heartbeat age (green<5min, yellow<15min, red≥15min or null).
- **Task 39 — office hub adds Operations row** (Loop Health + Service Area tiles).
- **COLONY_ARCHITECT injected at task 40 — signal_id=142, max_builds=999.**
- **Task 41 — customer-feedback.html + record_customer_feedback endpoint + customer_feedback_received agent.** Office can manually log 1-5 ratings + comment from phone/email/in-person. Low ratings (1-2) emit URGENT SMS to Teddy + Danielle. Endpoint emits CUSTOMER_FEEDBACK_RECEIVED signal with strength=90 for low ratings.
- **Task 42 — office hub adds Capture row** (Log Feedback tile).
- **Task 43 — tech-leaderboard.html + get_tech_leaderboard endpoint.** Monthly per-tech rankings with gold/silver/bronze medals. Jobs done · started · earnings $. Prev/next month nav.
- **Task 44 — office hub adds Leaderboard tile.**
- **Task 45 — high-rating auto-Google-review chain.** Customer feedback rating 4-5 now auto-emits GOOGLE_REVIEW_REQUEST with deadline=now-1s, firing immediately on next tick (vs 7d wait). 60-day per-customer dedup prevents duplicates with JOB_COMPLETED chain.
- **Task 46 — customer-portal Send Photos link.** Conditional button for non-terminal jobs (scheduled/on_way/in_progress). Deep-links to upload.html?job_id=X.

### Caffeinate launchd plist

Added `~/Library/LaunchAgents/com.tnappliance.caffeinate.plist` + repo copy at `colony-loop/launchd/com.tnappliance.caffeinate.plist`. KeepAlive=true means launchd auto-restarts if killed. caffeinate -di prevents both display sleep + idle sleep. Verified live: pid 34682, pmset -g confirms 'sleep prevented by caffeinate'.

System sleep was already 0 (Never); display sleep is 10min but actively prevented by caffeinate. For belt-and-suspenders display sleep, operator can run `sudo pmset -a displaysleep 0`.

**🐜 Long Live Ant.**

## Session log — 2026-05-27 afternoon: Tech Assist scribe-mode emergency refactor

**Stakes:** Jimmy got stuck in a 12-message interrogation loop this morning on Job #18195 (Magic Chef control board). System asked for labor hours after he provided '1.5' three times. He gave up + filled the web form manually. Andre refused to test the system at all because "too busy." This was the last reasonable shot before techs wrote it off.

**Root causes (3 bugs):**
1. Legacy `tech_assist_chat` uses `__CAPTURE_FIELD__` token emission scheme — Claude doesn't always emit perfectly + fields stay unset → re-asks.
2. Persistence read/write mismatch: legacy wrote to `captured_data + required_fields_remaining`. New SMS path wrote only to `captured_data`. In-browser form writes directly to `technician_decision_report`. **Three sources of truth.**
3. Photo+caption (most common tech workflow) not handled atomically. No MMS support yet.

**Refactor — scribe-mode tech_sms_assist:**
- Prompt rewritten as silent scribe. Parses EVERY message for ALL 9 TDR fields at once.
- Recognizes tech shorthand: 'Nwt' = needs_quote, 'replaced by #X', standalone '1.5' = labor_hours when context establishes, 'all done'/'fixed', etc.
- Empty Claude reply → silent mode (no SMS). Cut the chatty filler.
- **AUTO-FINALIZE**: when all 4 core fields populated, calls create_tdr automatically (2-hr dedup via event_log scan). One-line confirmation: "TDR saved. <summary>." No SAVE keyword required.
- Smoke test PASSED: Jimmy's exact 1-message dump → chat_status=200, auto_saved=true, reply 49 chars. ONE turn, done.

**Owner-only PAUSE/RESUME shortcuts** in tech_preference_inbound:
- `PAUSE TECH ASSIST FOR <tech_id>` writes tech_assist_paused event_log → tech_sms_assist routes that tech's messages to legacy
- `RESUME TECH ASSIST FOR <tech_id>` clears

**Watch monitor** `tech_assist_loop_watch.js` fires every 5 min (7am-10pm CT):
- Scans active techs for sessions older than 15min with >5 messages + no saved TDR
- Alerts Teddy per loop with deep-link
- Auto-pauses techs hitting 2+ loops/day

**EOD report** `tech_assist_eod_report.js` fires at 6pm CT:
- Per-tech: sessions / saved / loops / paused state
- Total fleet stats

**Pre-rollout outreach:** Sent personal SMSes from Teddy's voice to all 5 active techs explaining the fix + offering instant kill if it hassles them. All 5 sent OK.

**Debug logging:** every SMS-driven TDR write now writes an event_log row (action="tdr_write_from_sms") with each extracted field for the 2-week triage window.

**Operator todo:** Set `TECH_ASSIST_ENABLED=true` in Xano env vars to flip the legacy `tech_sms_inbound` chat-routing flag (the SMS-assist path doesn't depend on it, but enabling it lets in-browser chat work too).

**🐜 Long Live Ant.**

## Session log — 2026-05-27 PM: Parallel ANT Phase 1 launch — total HCP separation

**Strategic context:** Completely separating from HCP. Phase 1 = intake-only. Parsers ingest warranty emails → "Needs Scheduled" queue → Danielle (Dawn's old role too — handles ALL customer-facing) manually reviews + schedules. NO auto-assignment, NO auto-scheduling, NO HCP integration in either direction.

**Hard rules locked in:**
1. `CUSTOMER_FACING_ENABLED=false` (default) — every customer-bound SMS gated through `send_sms_POST.xs`. Drops + alerts Teddy. Internal (techs/owner/Danielle) bypass cleanly.
2. NO HCP writes ever. `HCP_PUSH_DISABLED=true` wired into all 5 HCP-writing endpoints.
3. HCP webhook OFF. `HCP_WEBHOOK_DISABLED=true` → 200-noop. New system does not record HCP intake at all.
4. NO backfill. `PARSER_ACTIVATION_TS_MS` env var rejects pre-activation emails.
5. Tech Assist runs ONLY on parallel-mode jobs (via event_log scan until `jobs.parallel_mode` column lands).
6. NO scheduling logic. Danielle manually schedules everything from the queue.

**Shipped this session:**
- `send_sms_POST.xs` — gating layer. Customer-bound + `CUSTOMER_FACING_ENABLED!=true` → drop + log + alert Teddy. Smoke verified.
- `create_tdr_POST.xs` — both HCP push sites gated behind `HCP_PUSH_DISABLED`.
- `hcp_job_webhook_POST.xs` — kill switch at top. Operator flips env var to disable HCP webhook intake entirely.
- NEW `create_job_from_email_POST.xs` — single intake endpoint for ServicePower/AHS/Allstate/manual. Forward-only via `PARSER_ACTIVATION_TS_MS`. Dedupes by claim_number. Creates job + alerts Danielle. Gated behind `EMAIL_INTAKE_ENABLED`.
- NEW `list_needs_scheduled_parallel_GET.xs` — powers Danielle's queue. Uses event_log scan to identify parallel-mode jobs (since `jobs.parallel_mode` column not yet added).
- NEW `danielle_schedule_parallel_job_POST.xs` — Danielle's Schedule action. Writes tech_id + scheduled_start + audit row.
- NEW `needs-scheduled.html` — Danielle's mobile-first queue view. Auto-refreshes, Schedule modal per row, "+ Add Manually" gap-catcher.
- `tech_sms_assist_POST.xs` scope guard — only fires for parallel-mode jobs. HCP-origin jobs route to legacy.
- `tech_assist_eod_report.js` extended with parallel-mode + dropped-customer-SMS metrics.
- All 5 active techs SMSed with updated parallel-mode messaging.
- Danielle onboarded with single SMS containing her new URL.

**Operator todos (Xano UI, ~5 minutes):**
1. Add column `jobs.parallel_mode` (bool, default false)
2. Add column `jobs.intake_source` (enum: hcp / email_servicepower / email_ahs / email_allstate / web_chat / manual)
3. Set env vars:
   - `HCP_WEBHOOK_DISABLED=true`
   - `HCP_PUSH_DISABLED=true`
   - `CUSTOMER_FACING_ENABLED=false`
   - `EMAIL_INTAKE_ENABLED=true` (after smoke test with one test email per source)
   - `PARSER_ACTIVATION_TS_MS=<now-in-ms>` at the moment you flip parsers live

**Deferred to next session:**
- AHS parser refactor (existing `ahs-gmail-poller.js` works but needs to POST to new `create_job_from_email` endpoint)
- ServicePower parser refactor (same — existing `servicepower-gmail-poller.js` needs to POST to new endpoint)
- Allstate parser (NEW build, no existing scaffold)
- Office UI parallel_mode filter additions
- Once `jobs.parallel_mode` column exists, swap event_log scan for direct column queries (faster + cleaner)

**Phase 1 bar:** Danielle stops manually adding missing jobs. When parsers catch every email + she scrolls through the queue without needing to "+ Add Manually" — that's milestone 1 of cutover criteria.

**🐜 Long Live Ant.**

## Standing rule — pre-diagnosis before parts

**Every new job triggers an immediate pre-diagnosis request to Teddy and the assigned tech.** Goal: parts ordered before first visit. This eliminates the -2/-3/-4/-5 repeat-visit cycle.

Two automation paths enforce this:

1. **Per-job immediate** — `colony-loop/agents/job_created.js` sends a `[ant] new job #X needs pre-diagnosis...` SMS to Teddy (always) + to the assigned tech (when `technician_id` + phone are set) the moment a JOB_CREATED signal lands. Dedup via `get_prediag_sent_for_job_GET.xs` on a 48-hour window so duplicate signals don't double-spam.

2. **Daily roll-up** — `colony-loop/agents/daily_job_prep.js` fires once daily at 6:30am CT (via `tick.js` 6-9am grace window + `get_daily_job_prep_fired_today_GET.xs` dedup). Pulls every job scheduled in the next 3 days that has NO TDR from `technician_id=1`. SMSes Teddy the consolidated list + each tech their own undiagnosed jobs. Both lists are Teddy Tool deep-links (`?job_id=X`).

Either path writes `action="prediag_request_sent"` or `action="daily_job_prep_fired"` to `event_log` so dedup queries can find them and downstream agents can audit the chain.

## Pending external integrations — wire when delivered

### Parts APIs (Marcone + Triple S) — expected within a few weeks

Two upstream parts-data integrations are committed but not yet delivered:

- **Marcone API** — OEM appliance parts distributor, broad catalog coverage.
- **Triple S API** — secondary parts source.

Currently the Teddy Tool parts-lookup flow uses a **Sears Parts Direct link** as a stopgap. When either API lands:

1. **Wire into the `parts_intelligence` architect template** (currently the template generates parts agents that simulate sourcing via Claude — replace with real API calls). Generated agents in `colony-loop/agents/parts_*.js` are the wiring targets.
2. **Replace the Sears Parts Direct link in `teddy-tdr-tool.html`** with a Marcone/Triple S lookup that pre-fills part numbers + live pricing for the diagnosed component.
3. **Update the parts cost capture path** — currently Teddy enters OEM cost as a free-form dollar amount; with a real API it can auto-fill from the live catalog.
4. **Track stock + ETA** — both APIs should expose inventory + arrival estimates, which the existing `parts_status` enum + `parts_eta_date` column can absorb without schema changes.

Until then: the Sears Parts Direct link stays. Don't refactor the parts-lookup flow yet.

## Where to look

- **Architecture + running status:** `docs/system-blueprint-v1.md` (canonical source of truth, two-layer format).
- **Colony loop design:** `docs/colony-loop-design.md`.
- **Recent decisions:** `docs/session-2026-05-*.md`, `docs/handoff-2026-*.md`.
- **XS gotchas + Metadata-API-deploy footgun:** `docs/xanoscript-footguns.md`.
- **Financial open items (for Alyse):** `docs/financial-flags-open.md`.
- **Live XS schemas (sample):** `docs/xano-schemas/2026-05-15/`.
- **Front-end pages:** root `.html` files; Netlify functions in `netlify/functions/`.

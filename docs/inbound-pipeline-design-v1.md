# Inbound Pipeline — Design v1

**Status:** Strategic umbrella for all warranty-job ingestion paths. Component-level designs live in their own docs; this doc covers what spans them.
**Last updated:** 2026-05-05
**Owner:** Teddy / James Pivacek

> This is a strategic doc, not a tactical implementation doc. Each ingestion channel has its own design doc with build phases, schema specifics, and parser logic. Read those for the how. Read this for the why and the what-spans-channels.

---

## 1. Mission

Every warranty job that exists in our world — current and future — lives in Xano as the system of record, regardless of how it arrived. Email, HCP dashboard entry, ServicePower dispatches, customer-Ant chat: all roads lead to a single canonical `jobs` row, deduped, normalized, and queryable from one place.

---

## 2. Why this exists

### Today
~40+ warranty jobs/day flow through `tnappliancerepair@gmail.com` → Danielle clicks the dispatch link → MeisterTask + Housecall Pro populate via the warranty companies' portal automation. Xano sees nothing about these jobs unless and until HCP later fires a webhook. Office tools (parts ordering, AR tracking, portal claim submission) operate against MeisterTask + HCP independently. Xano's `jobs` table reflects only customer-Ant chat intake — a small fraction of real volume.

### Tomorrow's vision
Xano is the unambiguous source of truth for every warranty job. MeisterTask and HCP feed it (or get phased out). Every downstream tool — AR tracker, parts ordering, claim submission, scheduling, Tech Assist — reads from Xano. Danielle's MeisterTask board remains operational only as long as she finds it useful; once Xano-backed tools replicate everything she does there, she's free to let it go.

### The constraint
We must not break the currently working system during transition. Danielle's daily workflow keeps running. HCP keeps dispatching techs. Warranty submissions keep flowing. Xano grows alongside the existing pipeline — never replaces it abruptly, never forces a hard cutover.

### The "all-in but disciplined" principle
Strategic commitment to Xano is total. Tactical migration is patient. Nothing in the working system gets pulled out until its Xano replacement is provably better. Every new ingestion path is additive, gated, observable, and reversible. Every cross-channel concern (dedup, normalization, idempotency) has a single canonical answer that all four channels share.

---

## 3. The four ingestion channels

| Channel | Status | Detailed design | Priority | Why |
|---|---|---|---|---|
| **HCP webhook** | LIVE (2026-05-05) | [docs/hcp-webhook-setup.md](./hcp-webhook-setup.md) | 1 | Already configured. Captures the 95%+ of warranty work that flows through HCP today. Lowest-effort foundation. |
| **Gmail polling** | Scoped, deferred build | [docs/gmail-integration-design-v1.md](./gmail-integration-design-v1.md) | 2 | Captures emails BEFORE they enter HCP. Redundant safety net for the HCP path; primary path for any dispatch that doesn't hit HCP at all. 6-8 sessions to build. |
| **ServicePower SOAP API** | Parked | docs/servicepower-api/ (5 reference PDFs in repo when shipped) | 3 | When ServicePower volume justifies a SOAP integration build. Complex, slower, gates on real demand. |
| **MeisterTask one-time export** | Deferred | (not yet documented) | 4 | Bulk import of historical AR state. Only happens AFTER Warranty AR Tracker exists in Xano to receive the data. Not a live ongoing integration. |

The four channels are sequenced by a combination of *implementation cost*, *coverage*, and *strategic readiness*. See section 7 for the rationale on order.

---

## 4. Architecture overview

```
INBOUND SOURCES
   ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐
   │ Warranty co     │  │ HCP dashboard    │  │ ServicePower     │  │ Customer Ant    │
   │ email dispatches│  │ (manual + portal │  │ SOAP dispatches  │  │ web/SMS chat    │
   │ → Danielle's    │  │  automation push)│  │                  │  │                 │
   │   Gmail inbox   │  │                  │  │                  │  │                 │
   └────────┬────────┘  └─────────┬────────┘  └────────┬─────────┘  └────────┬────────┘
            │                     │                     │                     │
            │                     │ (events fire)       │                     │
            ▼                     ▼                     ▼                     ▼
   ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐
   │ gmail_polling   │  │ hcp_job_webhook  │  │ servicepower_    │  │ create_job_from │
   │ _task (cron     │  │ (live POST       │  │ dispatch_handler │  │ _chat (existing │
   │ every 2-3 min)  │  │ endpoint)        │  │ (future)         │  │ Xano endpoint)  │
   └────────┬────────┘  └─────────┬────────┘  └────────┬─────────┘  └────────┬────────┘
            │                     │                     │                     │
            └─────────────────────┴─────────────────────┴─────────────────────┘
                                            │
                                            ▼
                          ┌─────────────────────────────────┐
                          │   IDEMPOTENCY / DEDUP LAYER     │
                          │   - 3-tier match lookup         │
                          │   - source-id tracking          │
                          │   - human-edit preservation     │
                          │   - warranty_company normalize  │
                          └────────────────┬────────────────┘
                                           │
                                           ▼
                          ┌─────────────────────────────────┐
                          │   CANONICAL jobs TABLE (Xano)   │
                          │   + customer, agent_*,          │
                          │   tech_assist_session, etc.     │
                          └────────────────┬────────────────┘
                                           │
                                           ▼
DOWNSTREAM CONSUMERS
   ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐
   │ Tech Assist v1  │  │ Warranty AR      │  │ TDR Portal       │  │ Dashboards /    │
   │ (live in-field  │  │ Tracker          │  │ Automation       │  │ reporting       │
   │ copilot)        │  │ (future)         │  │ (future)         │  │ (future)        │
   └─────────────────┘  └──────────────────┘  └──────────────────┘  └─────────────────┘
```

Every channel writes through the same dedup layer. The canonical `jobs` table is the single integration point for downstream consumers — they don't care which channel originated a job, only that the data is consistent.

---

## 5. Idempotency / dedup architecture

This is the most important cross-channel concern. Every ingestion path uses the same three-tier match strategy:

| Tier | Match key | Source-of-truth status |
|---|---|---|
| **Tier 1** | `housecall_pro_job_id` | If both events have an HCP job id and they match → same job. HCP id is globally unique within HCP and never reused. |
| **Tier 2** | `warranty_company` (canonical) + `claim_number` | The warranty company's own claim number is their source of truth for the dispatch. Combined with the canonicalized warranty co name, this is unique per real-world job. |
| **Tier 3** | `customer.phone` (E.164 normalized) + `appliance_type` + 24-hour created_at window | Fuzzy safety net for cases where claim number didn't parse cleanly. The 24hr window prevents matching against month-old jobs for repeat customers. |

### Match resolution rule

- **No match found** → create new `jobs` row with the channel-specific source id (`housecall_pro_job_id`, `gmail_message_id`, `servicepower_dispatch_id`) populated.
- **Match found** → UPDATE only NULL or empty fields on the existing row. **Never overwrite a populated field.** Preserves any human-edited data Danielle or anyone else has typed in. Always set the new channel's source-id reference even if no other field changed.

### Per-channel implementation

Every channel calls the same dedup helper logic. Candidate implementations:

- **Option A (preferred):** A reusable XanoScript function `dedup_warranty_job($candidate_fields)` that returns `{matched: true|false, job_id, tier_hit}`. Each ingestion handler calls it before any insert/update. Single source of truth for the dedup logic.
- **Option B (fallback):** Inline the three-tier query in each handler. Higher drift risk over time as channels evolve at different paces.

Decision: Option A. Build the helper as part of HCP webhook hardening (when we tighten the existing `hcp_job_webhook` post-first-real-delivery), then have every other channel adopt it.

### Source-id fields on `jobs`

Each ingestion channel writes its own source-id field on every job it touches, even when it didn't create the row. Lets us trace any job back through every channel that contributed to it.

| Source ID column | Channel that writes it | Status |
|---|---|---|
| `housecall_pro_job_id` | HCP webhook | exists in schema |
| `gmail_message_id` | Gmail polling | new field, planned in gmail-integration-design-v1 §8 |
| `servicepower_dispatch_id` | ServicePower SOAP handler | future (when channel ships) |
| `dispatch_source_id` | catch-all for warranty-co-supplied tracking ids | exists in schema, used by `warranty_job_intake` |

### Idempotency log

Each channel keeps its own per-message processing log to prevent duplicate work on retries:
- `gmail_processing_log` (per gmail_message_id) — see gmail-integration-design-v1 §8
- HCP webhook is idempotent by virtue of the 3-tier dedup (HCP retries with the same `hcp_job_id` will Tier-1-match and update-only).
- ServicePower handler will adopt the same per-channel-log pattern when built.

---

## 6. Warranty company normalization

`jobs.warranty_company` is currently a free-text field. Real values seen in production today: only `"AHS"` (3 jobs out of 85 sampled). But the field is unconstrained — any ingestion path could write `"American Home Shield"`, `"AmHomeShield"`, `"AHS Inc"`, or empty. Tier 2 dedup breaks if the same warranty co writes under different names.

**Every ingestion channel must normalize to the canonical name BEFORE writing.** No channel writes raw warranty-company values directly to `jobs.warranty_company`.

### Canonical names (initial set)

| Canonical value | Aliases the parsers must collapse to it |
|---|---|
| `AHS` | American Home Shield, AHS Home Warranty, AHS, ahs, Am Home Shield |
| `SquareTrade` | SquareTrade, Square Trade, ST, square_trade, squaretrade |
| `ServicePower` (with optional `-<client>` suffix when needed) | ServicePower, Service Power, SP, plus per-client variants like `ServicePower-GE`, `ServicePower-Whirlpool` if ServicePower routes us multiple clients with distinct claim numbering |
| `(extend)` | Each new warranty co joining gets added here, in lowercase + spaceless canonical, with the alias list discovered during parser development |

### Implementation

A shared normalization function `normalize_warranty_company($raw)` lives alongside the dedup helper from §5. Returns the canonical name, or `"unknown"` if no alias matches. Every ingestion channel calls it before writing.

For HCP webhook, the warranty co name comes from the HCP payload (typically derived from job tags or account name). For Gmail polling, it comes from the parser (per-warranty parser knows what co it is by definition). For ServicePower, it's `ServicePower` + the client code from the SOAP payload.

### Migration of existing data

The 3 existing AHS rows already use the canonical `"AHS"` value, so nothing to migrate today. As new ingestion channels go live, monitor for non-canonical values landing in `jobs.warranty_company` (event_log alert) and patch the alias list. After 30 days of clean data, consider tightening the schema from `text` to `enum`. Hold the enum tightening until alias coverage is proven — premature enum locks us into a brittle migration when a new warranty co joins.

---

## 7. Migration sequencing

Why HCP first, Gmail second, ServicePower third, MeisterTask last:

### 1. HCP webhook — already done

Configured 2026-05-05 with all 16 events subscribed. The ingestion handler already handles event-name routing, dedup against existing rows, customer creation, scheduling field mapping. Some downstream paths still need verification (data shape D1 vs D2 — see open questions §12), but the bones are in. Ongoing volume: most warranty work routes through HCP eventually, even if email is the original entry point.

### 2. Gmail polling — next

Catches emails BEFORE they enter HCP's systems, adding minutes-to-hours of head-start on dispatch awareness. Also catches dispatches that bypass HCP entirely (rare, but they exist). Gmail is the highest-coverage path that doesn't depend on warranty-company-side cooperation.

Build cost: 6-8 sessions per the detailed design. Deferred until Tech Assist v1 ships (current focus).

### 3. ServicePower SOAP — when volume justifies

ServicePower's API is SOAP-based, which means a substantial integration cost (SOAP envelope construction, WSDL parsing, authentication via their pattern, retry/circuit-breaker logic). Five reference PDFs are available; the build is sizeable — likely 4-6 sessions on top of normal Xano work.

We don't commit to this until ServicePower volume actually justifies it. Until then, ServicePower dispatches arrive via the email path (Gmail polling will pick them up once that ships) or via HCP if the dispatch eventually flows through HCP.

### 4. MeisterTask one-time export — last

Not a live integration. A bulk export of historical AR state from Danielle's MeisterTask board into Xano, executed once when the Warranty AR Tracker exists in Xano to receive the data. Sequence: Build the Warranty AR Tracker first (uses Xano-native data), export MeisterTask AR state once, retire MeisterTask AR usage.

The Warranty AR Tracker doesn't exist yet. Until it does, MeisterTask remains the operational AR system and we don't touch it.

---

## 8. Operational principles

The discipline that holds the migration together:

1. **Each ingestion is ADDITIVE.** A new ingestion writes to Xano without affecting MeisterTask, HCP, or the existing email flow. Danielle's day doesn't change because we shipped a new pipeline. If Xano goes down, Danielle's existing systems are untouched.
2. **Each ingestion is GATED behind an env flag.** Implementation pattern: `HCP_WEBHOOK_ENABLED`, `GMAIL_INTEGRATION_ENABLED`, `SERVICEPOWER_API_ENABLED`. Default false. Flipped to true only after end-to-end verification on real data. Tech Assist v1's `TECH_ASSIST_ENABLED` is the prototype for this pattern. (Note: HCP webhook is currently fired by HCP regardless of any Xano-side flag — the gating happens at the dashboard subscription level. A precondition check on `$env.HCP_WEBHOOK_ENABLED` could be added if we ever need a kill switch.)
3. **Never silently overwrite human-curated data.** Match-and-update writes only fill NULL/empty fields. Any field with a value is sacred — Danielle or someone typed it for a reason.
4. **Always log raw inputs from new sources for the first N events to verify shape, then remove the diagnostic log.** Every new channel ships with a `<channel>_raw_input_capture` event_log action that captures the full input on every event. After we've seen enough real events to confirm the parser handles them correctly, the diagnostic log gets deleted via a code change. The HCP webhook's `hcp_webhook_raw_input_capture` is the prototype.
5. **Never auto-delete jobs.** Cancellations, deletions, and similar are status-field updates only (`scheduling_status`, `current_status`). The `jobs` row stays. Audit history depends on it. Hard delete is a manual action by an authorized human, never automated.
6. **Failure modes route to human review, not silent drops.** Every parser fallback, every match ambiguity, every OAuth revocation, every SOAP timeout escalates to a human (event_log + SMS to the appropriate owner). We'd rather over-alert and tune down than miss a job and find out three weeks later when Danielle escalates.

---

## 9. What "done" looks like

**End state:** any warranty job, regardless of source, lands in Xano within minutes of arriving in our world. Danielle's MeisterTask board remains operational for as long as she wants it, but Xano holds the truth. Office tools — AR tracker, parts ordering, portal claim automation, dashboards — all read from Xano. We can sunset MeisterTask once everything Danielle does there is replicated in Xano-backed tools and proven better.

### Concrete milestones marking progress toward "done"

| Milestone | Indicator | Expected timeframe |
|---|---|---|
| HCP webhook validated against real data shape | First real `job.appointment.scheduled` lands cleanly, raw_input_capture log confirms D1 or D2; data-shape question resolved | Days, dependent on first real warranty dispatch arriving |
| Gmail polling capturing AHS dispatches | First 10 real AHS emails parsed end-to-end, deduped against HCP-source rows correctly | After Gmail Phase 1b ships (~3-4 sessions in) |
| All 4 channels live | HCP, Gmail, ServicePower, MeisterTask export each have a verified production path | Months |
| Warranty AR Tracker in Xano | Replicates AR functionality Danielle uses in MeisterTask, backed by Xano data | Separate project, sized when scoped |
| MeisterTask sunset | Danielle voluntarily stops opening MeisterTask because Xano-backed tools replaced everything she did there | Quarter+ horizon |

---

## 10. Out of scope

Things that are NOT this pipeline, even if they touch warranty jobs:

- **Outbound to warranty companies** (claim submission, status sync). That's the future TDR Portal Automation project — a separate effort that READS from this pipeline's output but isn't part of the inbound pipeline.
- **Tech-side data flows** (Tech Assist v1, Tech Scheduler). Those READ from this pipeline (they need `jobs` rows to operate against) but aren't ingestion channels themselves.
- **Customer-side data flows** (Customer Ant chat creating jobs via `create_job_from_chat`). Already Xano-native — the customer Ant flow writes directly to `jobs` without going through any external system. Logically a fifth channel, but doesn't need a migration plan because it's been Xano-native from day one.
- **Data quality / cleanup of existing test rows.** Real concern, separate project. This pipeline's mission is forward-looking ingestion; legacy cleanup is a parallel sweep.

---

## 11. Project sequencing under this umbrella

In priority order, with rough effort estimates:

| Project | Status | Estimate | Blocker |
|---|---|---|---|
| **Tech Assist v1 Phase 1d** | Active focus | 1-2 sessions | Blocked on Danielle interview (per-warranty-company TDR field requirements + escalation routing rules) |
| **Gmail integration Phase 1a-1e** | Scoped, ready when Tech Assist clears | 6-8 sessions | None (GCP project setup is the first action) |
| **Warranty AR Tracker** | Not yet scoped | TBD when scoped | Probably 4-6 sessions; gates MeisterTask export |
| **ServicePower SOAP API** | Parked | TBD when committed | Volume justification + 5 reference PDFs available |
| **MeisterTask one-time export** | Deferred | 2-3 sessions | Blocked on Warranty AR Tracker existing first |
| **HCP webhook hardening** | Live but unverified at full shape | 0.5-1 session | Blocked on first real HCP delivery to verify D1 vs D2 + remove diagnostic logs |

The build queue isn't strict serial. Tech Assist Phase 1d unblocks once Danielle is interviewed; Gmail Phase 1a is also independent and could run in parallel if a second focused session is available. ServicePower and MeisterTask wait on volume + AR Tracker respectively.

---

## 12. Open questions

Things we don't know yet that would refine this pipeline:

1. **HCP data shape D1 vs D2.** The hcp_job_webhook handler currently assumes D1 (`data: {job:{...}, appointment:{...}}`). If real HCP deliveries show D2 (`data` IS the entity, flat), the `$body` reconstruction in the handler needs adjustment. The diagnostic raw_input_capture log will answer this on first real delivery. Until then, treat HCP path as semi-verified.
2. **What % of email dispatches actually reach HCP today?** If 100%, Gmail integration is purely a redundancy / safety-net play. If <100%, Gmail becomes a critical primary path for the missing slice. Danielle's email walkthrough partially answered this; concrete numbers TBD by sampling the real `hcp_webhook_received` log over a week of real traffic against Gmail's `Dispatches`-labeled volume.
3. **Are there warranty companies beyond AHS, SquareTrade, ServicePower we should plan for?** First parsers we build are dedicated to those three. The Claude generic-fallback parser handles everything else, but if there's a fourth+ company with material volume, dedicated parsers earlier in the sequence would help.
4. **Do email dispatches ever land WITHOUT a corresponding HCP entry?** If yes, Gmail integration becomes critical (not redundant) — it's the only source for those jobs. Danielle's anecdotal answer suggests "rare but happens." Concrete numbers will come from comparing Gmail-source jobs vs HCP-source jobs over a 30-day window once both channels are live.
5. **MeisterTask data model parity.** What fields does Danielle's MeisterTask board carry that don't yet have homes in Xano's schema? Answers gate the Warranty AR Tracker design. TBD when AR Tracker scoping begins.
6. **Operational ownership of the dedup helper.** Who owns it long-term — engineering or shared with Danielle for tweaking match thresholds (e.g., the 24hr Tier 3 window)? Probably engineering for v1, with metrics surfaced to Danielle if tuning becomes needed.

Each open question has a forcing function (real data arriving, Danielle interview, channel going live) that will collapse it into a known answer. None are blocking the current build queue.

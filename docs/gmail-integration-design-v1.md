# Gmail Integration — Design v1

**Status:** Scoping complete. Build deferred until after Tech Ant Assist v1 ships.
**Last updated:** 2026-05-05
**Owner:** Teddy / James Pivacek
**Estimated build:** 6-8 marathon sessions (~20-30 active hours)
**Source mailbox:** tnappliancerepair@gmail.com (Danielle's inbox)

---

## 1. Goal

Capture warranty job dispatches at the inbox the moment they arrive, before Danielle clicks any of the warranty-portal links inside them. Today, ~40 dispatch emails per day land in Danielle's Gmail; clicking the link inside each one populates MeisterTask + Housecall Pro through portal-side automation, but does not push to Xano directly. Xano only sees the job after HCP fires its webhook (which now works post-2026-05-05 setup), but that's downstream of MeisterTask and after the click. We want Xano to see the job at the email — earlier in the flow, with full context (claim number, warranty company, dispatch source).

**Scope boundaries.** This integration only reads warranty-dispatch emails to create or enrich Xano `jobs` rows. It does NOT replace the HCP webhook (both will run in parallel; dedup logic prevents double-creation). It does NOT touch personal email, customer replies, or non-dispatch correspondence. It does NOT send email out. v1 is read-only on a single Gmail account.

---

## 2. Architecture options

| Option | Approach | Tradeoffs |
|---|---|---|
| **A. Gmail watch + Cloud Pub/Sub push** | Real-time. Gmail fires push notifications to a Pub/Sub topic on every mailbox change; Pub/Sub HTTP-pushes to a Xano webhook endpoint. Each notification carries a `historyId`; handler walks history and fetches messages. | Pros: sub-second latency, no polling waste. Cons: requires GCP project setup, Pub/Sub topic + subscription, push-endpoint signature validation, watch must be re-armed every ~7 days (recommended daily) via cron. More moving parts. |
| **B. Gmail API polling on schedule** | Cron task in Xano calls `users.messages.list` with a query like `label:dispatches is:unread newer_than:1h` every 2-3 minutes. Walks `historyId` since last poll. | Pros: simpler — same scheduled-task pattern we already use for `compute_tech_performance_ledger` etc. No Pub/Sub. Single GCP project still required for OAuth. ~2-3 min latency. Cons: wastes API quota when inbox is quiet (mostly fine — Gmail's quotas are generous for a single mailbox). |
| **C. IMAP via XOAUTH2** | Connect to Gmail's IMAP server using OAuth2 access tokens; poll for unread/labeled messages. | Pros: standard protocol, library support across languages. Cons: **effectively non-starter.** Google's "restricted" scope policy (in effect since 2018) requires a third-party security assessment costing $15k-$75k for production IMAP read access on Gmail. Basic auth was deprecated 2025-03-14, so XOAUTH2 is the only auth path, but the assessment requirement makes IMAP commercially impractical for a new build at this scale. Documented here only to explain why we're rejecting it. |

### Recommendation: Option B (polling).

Rationale:
- **40 dispatches/day doesn't need real-time.** A 2-3 minute lag is invisible to Danielle's workflow and to downstream systems (HCP webhook continues to run in parallel anyway).
- **Reuses existing infrastructure pattern.** Xano scheduled tasks already drive `compute_tech_performance_ledger`, `daily_tech_summary`, `process_feedback_queue`, `scheduling_queue_worker`, `vapi_warranty_followup_scheduler`, and `compute_tech_assist_escalation`. One more cron is cheap.
- **Simpler ops model.** No Pub/Sub topic to provision, no push-endpoint signature validation, no watch-renewal cron. OAuth + token storage + cron + Gmail API calls is the entire system.
- **Option A is documented as a v2 upgrade path** if polling proves insufficient (e.g., dispatches start coming faster than 2-3 min and the lag becomes operationally meaningful).

---

## 3. Required infrastructure

### Google Cloud project
- One GCP project owned by Teddy (Gmail account holder).
- Gmail API enabled.
- OAuth 2.0 client created (type: Web application).
- Authorized redirect URI pointing to a Xano endpoint (`/gmail_oauth_callback`) that accepts the auth code and exchanges it for tokens.
- For Option B, no Pub/Sub topic / subscription needed. (Pre-create if v2 upgrade is anticipated within 6 months.)
- Quotas: Gmail API default is 1,000,000,000 quota units/day per project — far above what 40 dispatches/day needs. No quota concern.

### OAuth scope
- `https://www.googleapis.com/auth/gmail.readonly` — minimum sufficient. Does NOT include modify/send/delete. Read-only on messages, threads, labels, history.
- Verification: Gmail's `gmail.readonly` is a "restricted" scope, which means the OAuth consent screen needs Google verification before being available to users beyond the project owner. Since we're only consenting one user (Danielle's `tnappliancerepair@gmail.com`, owned by Teddy), we can stay in **testing mode** with up to 100 test users — no verification needed. If we ever expand to multi-tenant, verification becomes a real cost ($15k+ assessment, same as the IMAP-restricted-scope problem above). v1 stays single-tenant.

### Token storage in Xano
- New table `gmail_oauth_tokens` (schema in section 8).
- Refresh token stored encrypted at rest. Access token cached and refreshed before each polling batch.
- Manual re-auth flow if refresh token gets revoked (user removes app from Google account).

### Polling task in Xano
- New scheduled task `process_gmail_dispatches.xs`. Runs every ~2-3 min (`freq: 180`). Test-mode-gated like other crons (`$env.GMAIL_INTEGRATION_ENABLED == "true"`).
- Pulls new messages since last `historyId`, dispatches each through the parser router, dedups against existing jobs, creates rows.

---

## 4. Email classification problem

We must avoid pulling personal email, customer replies, or marketing content into the dispatch pipeline. Options:

| Option | Approach | Pros | Cons |
|---|---|---|---|
| Sender allowlist | Hardcoded list of warranty-company sender domains (e.g., `@ahs.com`, `@squaretrade.com`) | Fast, deterministic, low risk of false positives | New warranty co requires code change. Spoofable in theory, but Gmail spam filtering catches most of that. |
| Subject-line patterns | Regex on subject (e.g., `^Dispatch:`, `^New Service Request`) | Sender-independent | High false-positive risk (marketing emails use these too). Brittle — warranty cos change subject formats. |
| Label-based filtering | Danielle creates a Gmail filter → "Dispatches" label; system only reads emails with that label | Simple, human-curated, transparent | Requires Danielle's discipline; new dispatch sources need a new filter rule from her |
| Claude classification per email | Send each email's headers + first 500 chars to Claude with "is this a warranty dispatch? yes/no" prompt | Most flexible, handles novel formats automatically | Expensive at 40+/day plus the long tail of non-dispatch emails. Latency adds up. Overkill for this filtering problem. |

### Recommendation: Label-based filtering as primary + sender allowlist as secondary.

- Danielle creates a Gmail filter rule per warranty company that auto-labels matching emails with `Dispatches/AHS`, `Dispatches/SquareTrade`, etc.
- Polling task queries `label:dispatches newer_than:1h` (matches the parent `Dispatches` label and all sub-labels).
- Sender domain allowlist is a secondary check inside the polling task — defense-in-depth in case Danielle's label rule misfires.
- Adding a new warranty company = Danielle adds a new filter rule (no engineering work). A new parser is added later by engineering once we see the email format.
- This pushes the classification UX onto Gmail's well-understood filter rules, where Danielle already operates daily.

Claude classification is held in reserve as a Phase 1c addition if label-based filtering proves to have gaps.

---

## 5. Per-warranty parser strategy

Each warranty company sends a different email format. v1 ships with three first-class parsers (AHS, SquareTrade, ServicePower's client variants) and a generic fallback.

### Parser router

- Polling task fetches each new dispatch-labeled message.
- Dispatcher inspects sender domain + subject pattern to route to the right parser.
- Each parser extracts a normalized struct: `{customer_name, customer_phone, customer_email, address, city, state, zip, appliance_type, brand, model_number, complaint, claim_number, warranty_company, dispatch_source_id, scheduled_window_hint?}`.
- Returns parser-confidence score (high/medium/low) per field.

### Fallback strategy for emails matching dispatch criteria but with no dedicated parser

**Primary fallback: Claude-based generic extraction.**
- Send the email body (HTML stripped, plaintext) to Claude with a structured-output prompt asking for the same field set the per-warranty parsers produce.
- Mark the resulting Xano `jobs` row with `parser_used="generic"` for downstream auditability.
- Log a `parser_fallback_used` event so we can track which warranty companies need new dedicated parsers.

**Secondary fallback: pending review queue.**
- If generic extraction fails confidence threshold (no claim number, ambiguous customer info, missing critical fields), park raw email in `pending_email_review` table (schema in section 8).
- Surface in a Danielle-facing dashboard widget for manual triage.
- Don't auto-create a stub job — better to hold than to create garbage data.

**Hard rule: NEVER auto-reject a label-matched email.** Better to over-capture and let Danielle review than to silently drop dispatches.

### Parsers to build in order

1. **AHS** — single sender domain, predictable HTML template
2. **SquareTrade** — single sender domain, simpler plaintext
3. **ServicePower client variants** — multiple subtypes (the dispatcher recognizes the variant by subject + body markers and routes to per-client sub-parsers)
4. **Generic Claude fallback** — covers everything else
5. **Anything that ends up in pending review for 7+ days repeatedly** — prioritize building a dedicated parser

---

## 6. Required Xano-side components (synthesis — replace if you had different intent for section 6)

> **Note:** Original numbering jumped from section 5 to section 7. I've inserted this section as a logical bridge covering the new endpoints and cron tasks needed; rewrite or delete if you had a different concept in mind for section 6.

### New endpoints

- **`gmail_oauth_init` (GET)** — owner-only. Returns Google's OAuth consent URL with the appropriate scope + state. Teddy clicks once during initial setup.
- **`gmail_oauth_callback` (GET)** — receives `?code=...` from Google after consent. Exchanges code for refresh + access tokens. Stores in `gmail_oauth_tokens`. Idempotent (overwrites if account already exists).
- **`gmail_reauth` (POST, owner-only)** — manual re-auth trigger if refresh token revoked. Returns the OAuth URL again.
- **`pending_email_review_list` (GET, admin-only)** — for Danielle's dashboard widget. Returns paginated unprocessed entries.
- **`pending_email_review_resolve` (POST, admin-only)** — Danielle marks an entry as manually-handled or triggers retry-with-correction.

### New cron task

- **`process_gmail_dispatches`** — every 180s (3 min). Gated on `$env.GMAIL_INTEGRATION_ENABLED == "true"`. Pulls new dispatch-labeled messages since last `historyId`, dispatches each through the parser router, persists outcomes.

### New env vars

- `GMAIL_INTEGRATION_ENABLED` — `"false"` default, `"true"` to activate cron
- `GOOGLE_OAUTH_CLIENT_ID` — from GCP project
- `GOOGLE_OAUTH_CLIENT_SECRET` — from GCP project
- `GMAIL_TARGET_ACCOUNT` — `"tnappliancerepair@gmail.com"` (so handlers know which row in `gmail_oauth_tokens` to use)

---

## 7. Dedup architecture

Gmail-source jobs must dedupe against HCP-webhook-source jobs and any other intake paths. Same warranty dispatch may arrive at us via multiple routes within minutes of each other.

### Three-tier matching, in order

| Tier | Match key | When |
|---|---|---|
| 1 | `housecall_pro_job_id` | If the email body contains an HCP job link or an explicit HCP job id, parse it and match against existing `jobs.housecall_pro_job_id` |
| 2 | `warranty_company` + `claim_number` | Composite match: same warranty co name (case-insensitive trim) + same claim number string |
| 3 | `customer.phone` (E.164 normalized) + `appliance_type` + 24-hour window | Soft match — for cases where claim number didn't parse cleanly. 24hr window prevents matching against month-old jobs for repeat customers. |

### Match resolution

- **No match** → create new `jobs` row with `intake_source="gmail"`, `gmail_message_id=<gmail message id>`, `parser_used=<parser name>`.
- **Match** → update only NULL or empty fields on the existing row (never overwrite). Always set `gmail_message_id` reference even if other fields stayed put. Log `gmail_dedup_matched` with which tier hit.

### Idempotency

- Polling task checks `gmail_processing_log` (section 8) for the message id BEFORE doing any work. If already processed, skip. Prevents double-processing on cron retries or manual re-runs.

---

## 8. Schema additions

### Existing-table additions

**`jobs`:**
- `gmail_message_id` (text, nullable, unique-indexed) — Gmail's message id (immutable, globally unique). Links Xano job → Gmail message.
- `intake_source` — already a text field in current schema. Just need to start writing `"gmail"` as a value alongside existing `"hcp_webhook"`, `"web_chat"`, `"jotform"`, etc. No schema change. Document the new value.
- `parser_used` (text, nullable) — name of the parser that produced this job (`"ahs"`, `"squaretrade"`, `"servicepower_v2"`, `"generic"`, etc.). Useful for tracking parser quality and identifying which formats need dedicated parsers.

### New tables

**`gmail_oauth_tokens`**
```
id (pk)
created_at, updated_at
account_email (text, unique) — e.g. "tnappliancerepair@gmail.com"
refresh_token (text, encrypted at rest) — long-lived
access_token (text, encrypted at rest) — short-lived (~1hr), refreshed before each batch
expires_at (timestamp) — when the current access_token dies
scope (text) — recorded for audit
last_refreshed_at (timestamp)
revoked (bool, default false) — set true on 401, requires manual re-auth
```

**`pending_email_review`**
```
id (pk)
created_at
gmail_message_id (text, unique) — links to Gmail
account_email (text)
sender (text)
subject (text)
raw_body (text) — full plaintext, access-restricted
parser_attempted (text) — which parser ran and failed (or "generic" if generic also failed)
parser_failure_reason (text) — why we punted
status (enum: pending, in_review, resolved_to_job, resolved_ignore, abandoned)
resolved_at (timestamp, nullable)
resolved_by (text, nullable) — Danielle's user identifier or "system"
resolved_to_job_id (int, nullable, fk jobs)
notes (text, nullable)
```

**`gmail_processing_log`**
```
id (pk)
created_at
gmail_message_id (text, unique-indexed) — primary idempotency key
account_email (text)
processed_at (timestamp)
action_taken (enum: created_job, updated_existing_job, queued_pending_review, skipped_duplicate, classification_skipped, error)
job_id_created (int, nullable, fk jobs)
job_id_updated (int, nullable, fk jobs)
parser_used (text, nullable)
dedup_tier_hit (int, nullable) — which dedup tier (1/2/3) matched, or null for new
error_message (text, nullable)
```

---

## 9. Token storage / refresh / rotation

### Refresh token storage
- Stored in `gmail_oauth_tokens.refresh_token` encrypted at rest.
- Refresh tokens never expire under Google's contract — they are long-lived until explicitly revoked.
- Revocation triggers: user removes the app from Google account; user changes password; org suspends the account; we hit certain abuse triggers.

### Access token rotation
- Access tokens have a ~1hr TTL.
- Polling task fetches the current access token from `gmail_oauth_tokens`. If `expires_at < now() + 60s`, refresh first using `refresh_token`, write new access token + expires_at back.
- Refresh is one HTTP POST to Google's `/oauth2/v4/token` endpoint with `grant_type=refresh_token`. Standard OAuth flow.

### Revocation handling
- If any Gmail API call returns 401 with `invalid_grant`, mark `gmail_oauth_tokens.revoked=true`, log `oauth_token_failure`, send SMS to `OWNER_PHONE_NUMBER` with a re-auth URL pointing at `/gmail_reauth`.
- Polling task checks `revoked=false` precondition; halts gracefully if true.
- Re-auth flow: Teddy clicks the link, completes Google consent, callback writes new tokens, sets `revoked=false`. Polling resumes on next tick.

---

## 10. Failure modes + observability

| Failure | Detection | Response |
|---|---|---|
| Per-warranty parser breaks (warranty co changes email format) | Parser raises or returns confidence-low on critical fields | Fall back to Claude generic parser. Log `parser_fallback_used` with parser name + warranty co. Recurring fallbacks (3+ in 24hr for same co) trigger SMS to Teddy. |
| Generic parser also fails confidence threshold | Confidence score below threshold on required fields (claim number, customer name, phone) | Park in `pending_email_review` with `parser_attempted="generic"` and `parser_failure_reason`. Surface in Danielle's dashboard. No SMS — this is expected. |
| OAuth token revoked | 401 with `invalid_grant` from Gmail API | Mark `revoked=true`, log `oauth_token_failure`, SMS Teddy within 5 min of detection. Polling halts. Manual re-auth required. |
| Polling task fails (Gmail API 5xx, network, etc.) | Cron task returns error | Existing scheduled-task retry pattern handles it. Alert SMS to Teddy if 3 consecutive failures (similar pattern to other crons). |
| Duplicate processing within a single tick | `gmail_processing_log` already has the message id | Skip. Logged as `skipped_duplicate` action. |
| Watch expires (only relevant for v2 push path) | N/A in v1 | N/A. If we upgrade to Option A, add a daily cron to re-arm watch. |

### Audit trail

- Every Gmail API call logged with timestamp, message ids accessed, action taken (`gmail_processing_log`).
- Every job creation/update tagged with `gmail_message_id` for tracing.
- Every parser fallback logged as `parser_fallback_used` event.
- Every 401 logged as `oauth_token_failure`.

---

## 11. Security / PII

- **Scope minimization:** Use `gmail.readonly` only. Never request modify/send/delete scopes. If we ever need to mark messages as read or apply labels, escalate scope intentionally.
- **Sender allowlist as primary filter:** even though label-based filtering is the main classifier, the polling task also enforces a hardcoded sender domain allowlist BEFORE pulling message bodies. Avoids accidentally pulling content from emails labeled `Dispatches` by mistake.
- **No raw bodies in `event_log`:** event_log entries reference `gmail_message_id` and parsed fields. Raw email bodies live only in `pending_email_review.raw_body` (access-restricted) or in the Gmail API itself (we don't replicate).
- **Encryption at rest:** `gmail_oauth_tokens.refresh_token` and `access_token` stored encrypted. Use Xano's built-in encrypted-field type if available; otherwise envelope-encrypt with a key in env vars.
- **`pending_email_review` ACL:** admin-only read access. Customer phone/address visible only to Danielle and Teddy, not to techs or any public endpoint.
- **Audit log of every Gmail API access:** which message ids were read, at what time, for what reason. Stored in `gmail_processing_log`.
- **OAuth consent screen:** stays in testing mode while we have one user (Danielle's mailbox). Single-tenant doesn't trigger Google's third-party security assessment requirement. If we ever need multi-tenant, this re-opens the same $15k+ assessment problem that killed Option C — plan accordingly.

---

## 12. Phasing

Build deferred until after Tech Ant Assist v1 ships. Estimated 6-8 sessions / ~20-30 hours active build once started:

| Phase | Scope | Sessions |
|---|---|---|
| **1a** | GCP project, OAuth client, token storage table, `gmail_oauth_init` + `gmail_oauth_callback` endpoints, smoke test reading first 5 emails. | ~1 |
| **1b** | AHS-only parser. Single warranty co path. Dedup against HCP-webhook-source. Polling cron with `GMAIL_INTEGRATION_ENABLED=false`. End-to-end test with Danielle's real AHS dispatches. | ~2 |
| **1c** | SquareTrade parser. Generic Claude fallback. `pending_email_review` queue. | ~2 |
| **1d** | ServicePower client variants (multiple sub-parsers via dispatcher). Danielle review dashboard widget. Error alerting (SMS for parser-fallback recurrence + OAuth revocation). | ~2 |
| **1e** | Live test with `GMAIL_INTEGRATION_ENABLED=true`. Soft launch — let it run alongside HCP webhook for a few days, watch dedup metrics, watch parser fallback rate, fix anything that surfaces. | ~1 |

**Total estimate: 6-8 sessions, 20-30 hours of focused build time.**

Post-v1, watch for:
- Polling latency complaints (escalate to Option A push if real)
- Parser fallback recurrence (build dedicated parsers for the worst offenders)
- Multi-mailbox needs (e.g., a second Gmail account for a different team) — re-architects single-tenant assumptions

---

## 13. Operational handoff

| Responsibility | Owner |
|---|---|
| GCP project ownership | Teddy (also owns `tnappliancerepair@gmail.com` Gmail account) |
| OAuth consent screen verification (if/when needed) | Teddy + engineering |
| Initial OAuth grant (clicking through consent) | Teddy (one-time, during phase 1a setup) |
| Re-auth on token revocation | Teddy (responds to SMS alert with re-auth URL) |
| Cron task health (renewal, monitoring) | Cron itself + existing task-failure alerts. No dedicated human. |
| Watch renewal (only if v2 push upgrade happens) | Daily cron, no human |
| Adding new per-warranty parsers when a new warranty co joins | Engineer (Teddy + Claude Code), driven by parser-fallback recurrence in event_log |
| Monitoring `pending_email_review` queue | Danielle (front-line — she handles the same emails today, just in her inbox) |
| Escalation: pending review → unresolved | Danielle → if Danielle stuck → Teddy via SMS |
| Parser confidence tuning | Engineer, periodically — review fallback events and adjust thresholds |

---

## Recommendation note for v2

If polling latency ever becomes operationally meaningful (dispatches arriving in clusters and 2-3 min lag matters for routing decisions), the architecture cleanly upgrades to Option A:

- Provision a Pub/Sub topic + push subscription against the same GCP project
- Add a `gmail_pubsub_webhook` POST endpoint in Xano (signature-validates the X-Goog-IAM-Authority header)
- Replace the polling cron with a watch-renewal cron (daily) calling Gmail API `users.watch`
- The parser router, dedup logic, schema, and storage all stay identical
- Effort estimate for the swap: 1-2 sessions

The doc-level decision is to NOT do this in v1 — but the schema and component design are deliberately compatible with the upgrade path so we don't paint ourselves into a corner.

---

## Sources

- [Configure push notifications in Gmail API | Google for Developers](https://developers.google.com/workspace/gmail/api/guides/push) — the canonical Option A reference
- [Push subscriptions | Pub/Sub | Google Cloud Documentation](https://docs.cloud.google.com/pubsub/docs/push) — webhook delivery + signature header validation
- [Receive Gmail Push Notifications Using Google Cloud Pub/Sub | Torq](https://kb.torq.io/en/articles/9138324-receive-gmail-push-notifications-using-google-cloud-pub-sub) — practical Option A walkthrough
- [Transition from less secure apps to OAuth | Google Workspace Admin Help](https://support.google.com/a/answer/14114704?hl=en) — basic-auth deprecation timeline
- [Gmail Access Evolution: From GIMAP to OAuth Restrictions to IMAP again | Aurinko](https://www.aurinko.io/blog/gmail-imap/) — context on Option C's security-assessment cost trap
- [OAuth 2.0 Mechanism | Gmail | Google for Developers](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol) — XOAUTH2 spec reference

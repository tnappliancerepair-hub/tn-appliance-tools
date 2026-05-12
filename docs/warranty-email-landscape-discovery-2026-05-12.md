# Warranty email landscape discovery — 2026-05-12

> Phase C inventory: catalog every email type arriving in `tnappliancerepair@gmail.com` from warranty vendors over the past 60 days. Output of a single read-only Gmail survey (gitignored helper at `.tmp_smoke/gmail-landscape-survey.js`). No parsers built, no production changes. This doc is the planning input for the next round of intake-automation work that aims to replace Danielle's email triage.

**Method.** Authenticated to `tnappliancerepair@gmail.com` via existing `ahs-gmail-poller` OAuth credentials, queried 5 sender-domain buckets with `newer_than:60d`, sampled up to 30 most-recent messages per bucket (137 total messages classified). Subject patterns collapsed by replacing digit runs and ID-shaped tokens with placeholders. PII redacted in body samples before saving anywhere on disk.

---

## 1. Executive summary table

| Vendor | Email type | Sender | Sample count (60d) | Operational meaning | Body shape | Parser difficulty |
|---|---|---|---|---|---|---|
| **AHS / Frontdoor** | New Dispatch Notification #{n} | `noreply@msg.frontdoor.com` | 15 | DISPATCH_OFFER (auto, XML) | XML attachment | ✅ **DONE** |
| AHS / Frontdoor | Estimate for dispatch {n} instantly approved | `noreply@msg.frontdoor.com` | 5 | ESTIMATE_APPROVED | HTML | Easy |
| AHS / Frontdoor | Estimate for dispatch {n} processed | `noreply@msg.frontdoor.com` | 3 | ESTIMATE_APPROVED (manual) | HTML | Easy |
| AHS / Frontdoor | CIL Accepted for dispatch {n} | `noreply@msg.frontdoor.com` | 3 | CASH_IN_LIEU (replacement) | HTML | Medium |
| AHS / Frontdoor | Estimate for dispatch {n} was not instantly approved | `noreply@msg.frontdoor.com` | 2 | ESTIMATE_PENDING_REVIEW | HTML | Easy |
| AHS / Frontdoor | Your daily status update | `noreply@msg.frontdoor.com` | 1 | DAILY_DIGEST (xlsx) | xlsx attachment | Hard (parse Excel) |
| **AHS direct** | Opportunity of New Dispatch – Dispatch ID -{n} | `DispatchRegionP1@ahs.com` | 1 | DISPATCH_OFFER (human, sparse) | Prose | Medium (few fields) |
| **ServicePower** | Service Request | `noreply@servicepower.com` | 12 | DISPATCH_OFFER (incl. SquareTrade) | Labeled plaintext | Easy |
| ServicePower | Service Request Notice | `noreply@servicepower.com` | 6 | DISPATCH_OFFER (with accept/reject link) | Labeled plaintext | Easy |
| ServicePower | SERVICER NEW NOTES | `noreply@servicepower.com` | 8 | NOTES_ADDED | HTML | Medium |
| ServicePower | Rescheduled Service Request Notice | `noreply@servicepower.com` | 1 | RESCHEDULE | Labeled plaintext | Easy |
| ServicePower | Service Request Notice Cancellation | `noreply@servicepower.com` | 1 | CANCELLATION | Labeled plaintext | Easy |
| ServicePower | ServicePower Call Status Update | `noreply@servicepower.com` | 1 | STATUS_UPDATE | TBD | Medium |
| ServicePower | ServicePower Status Report (STATUS.TXT) | `NOREPLY@servicepower.com` | 1 | DAILY_DIGEST | txt attachment | Easy |
| **SquareTrade / Allstate** | ServicePower Repair {n} | `warrantysupport@squaretrade.com` | 5 | CLAIM_CREATED (companion to ServicePower dispatch) | HTML/prose | Medium |
| SquareTrade / Allstate | request for updated Appliance call status (1st/2nd/3rd/Final) | `appliance_dispatch@squaretrade.com` | 13 (across 4 escalation tiers) | STATUS_REQUEST_REMINDER | HTML/prose | Hard (template) |
| SquareTrade / Allstate | RMA Number #[{n}] for Claim #[claim_{n}] is available | `rma_request@squaretrade.com` | 4 | RMA_AVAILABLE | HTML | Medium |
| SquareTrade / Allstate | 24hr / Failed Repair Notice Reply Requested for {n} | `appliance_team@squaretrade.com` | 4 | FAILED_REPAIR_ESCALATION | Prose | Medium |
| SquareTrade / Allstate | Service power-New Dispatch (2nd visit follow-up) | `appliance_team@squaretrade.com` | 2 | SECOND_VISIT_DISPATCH | Prose | Medium |
| SquareTrade / Allstate | Diagnostic Truck Roll Request | `appliance_dispatch@squaretrade.com` | 1 | DIAGNOSTIC_REQUEST | TBD | Medium |
| SquareTrade / Allstate | Upcoming Repair: Schedule Change Requested by Customer | `appliance_dispatch@squaretrade.com` | 1 | RESCHEDULE_REQUEST | TBD | Medium |
| SquareTrade / Allstate | Claim Update {n} | `appliance_team@squaretrade.com` | 1 | CLAIM_UPDATE | TBD | Medium |
| **NSA** | NSA Dispatch for {PROGRAM} Dispatch# {PROGRAM}{n} Case# ... | `notifications@em.nationalservicealliance.com` | 5+ (ARW/HAP/ASU/SHW) | DISPATCH_OFFER | HTML with buttons | Medium |
| NSA | NSA Update Request for {PROGRAM} Dispatch#... | `notifications@em.nationalservicealliance.com` | 5+ | STATUS_REQUEST_REMINDER | HTML | Medium |
| NSA | HIS Parts Shipped for Case# H{n} | `notifications@em.nationalservicealliance.com` | 2 | PARTS_SHIPPED | HTML | Medium |
| NSA | Repair Cancelled for HAP Case#... | `notifications@em.nationalservicealliance.com` | 2 | CANCELLATION | HTML | Medium |
| NSA | Repair Closed by NSA for Case#... | `notifications@em.nationalservicealliance.com` | 1 | COMPLETION_CONFIRMATION | HTML | Medium |
| NSA | Estimate Approved Dispatch#: ARW... | `notifications@em.nationalservicealliance.com` | 1 | ESTIMATE_APPROVED | HTML | Medium |
| NSA | NSA EFT Payment Register | `notifications@em.nationalservicealliance.com` | 1 | PAYMENT_REGISTER | HTML | Medium |
| NSA | NSA Action Needed - Potential Parts Charge | `notifications@em.nationalservicealliance.com` | 1 | ACTION_ITEM | TBD | Hard |
| NSA | Integrity OVERDUE PART RETURN, CASE# {n} | `partsupport2@nationalservicealliance.com` | 1 | RMA_REMINDER | TBD | Medium |
| NSA | (multiple human reply-thread variants) | `Katelyn.Shumway@`, `angie@`, etc. | ~5 | HUMAN_REPLY | Free text | Very Hard (skip) |

**Volume note.** Counts are samples capped at 30 per query and only reflect the 60-day window. Real volumes per type require a wider survey or accumulation over time. Notable ratios from the sample:
- ~50% of SquareTrade volume is **status-request reminders** (43% of the 30-message SquareTrade sample = 13 reminders). Big efficiency lever if we automate status-back.
- ~50% of ServicePower volume is **dispatch offers** (18 of 28 = "Service Request" or "Service Request Notice"). Together these and the AHS Frontdoor XML cover the lion's share of inbound dispatch.
- NSA covers **four distinct program prefixes** (ARW, HAP, ASU, SHW) — much more diverse template space than AHS or SquareTrade.

---

## 2. Per-vendor detailed sections

### 2.1 AHS / Frontdoor (29 emails in sample, 7 patterns)

**Two distinct dispatch paths:**

**Path A — Frontdoor automated XML** (`noreply@msg.frontdoor.com`). This is what `ahs_email_intake` already parses. 15 of 30 are this type. Subject: `New Dispatch Notification #{dispatch_id}`. Body is rendered HTML; XML payload is in `dispatch.xml` attachment.

**Path B — AHS direct human dispatcher** (`DispatchRegionP1@ahs.com`). 1 of 30 in sample. Subject: `Opportunity of New Dispatch – Dispatch ID -{n} -KD`. Body is prose, very sparse — only `Dispatch ID`, `City, Zip`, `Item (Brand)`, `Symptoms`. The footer is human-signed ("Karla Danner- Contractor Dispatcher"). Likely a smaller-volume human-managed channel for special situations. **Different parser path needed** — much thinner data, would likely require Teddy or Danielle to fill gaps via the AHS portal post-intake.

**Lifecycle events after dispatch** (all from `noreply@msg.frontdoor.com`):

- `Estimate for dispatch {n} was instantly approved!` (5) — small repair approved without human review
- `Estimate for dispatch {n} has been processed!` (3) — manual approval
- `Estimate for dispatch {n} was not instantly approved` (2) — needs adjuster review
- `CIL Accepted for dispatch {n}` (3) — "Cash In Lieu" (replacement instead of repair); the customer is being paid out, **we don't service**. **Operational meaning matters** — we should mark the job as closed/cancelled, NOT continue scheduling.
- `Your daily status update` (1, attachment `appointment.xlsx`) — daily roll-up across all our AHS jobs. Useful for reconciliation but probably not worth parsing — better to query AHS portal API if we ever get one.

**Join key:** `dispatch_id` (7-digit number) → matches `jobs.claim_number` on AHS-origin jobs.

### 2.2 ServicePower (28 emails in sample, 7 patterns)

ServicePower is the dispatch **platform** that routes work for SquareTrade/Allstate and others (so most of these 28 are SquareTrade jobs flowing through ServicePower's email system, distinct from the SOAP API we inventoried separately).

**Two distinct dispatch-offer types** with subtle differences:

- `Service Request` (12) — full dispatch with `Call Status: Accepted` already set. ALL fields populated in clean labeled-text format: Servicer Account, Call #, Brand, Product, Model #, Serial #, Schedule Date/Period, Call Type, ServiceType, Authority Number, Co-Pay, Contract #, Install Date, Repeat Call, Call Status, Consumer Name/Address/City/State/Zip/Phones, Customer Problem. **Very parseable.**
- `Service Request Notice` (6) — same field set PLUS `Call Status: Open` / `Call Sub Status: OPEN`, PLUS an "Appointment completion form" URL (`https://www.squaretrade.com/frontend/schedule-appointment/...`), PLUS an `Accept/Reject` flow. **This is the dispatch OFFER that requires our response.** The "Service Request" type appears to be the post-accept confirmation. Two-step flow.
- `SERVICER NEW NOTES` (8) — manufacturer/client added notes to an existing call. Subject prefix is the call number. Body delivers note text; need to associate with existing Xano job via call number.
- `Rescheduled Service Request Notice` (1) — same shape as Service Request Notice but for a reschedule. Schedule Date/Period have new values.
- `Service Request Notice Cancellation` (1) — call cancelled by consumer. Sparser body: just Call No, Product, Brand, Consumer name/phone, ZIP, dates.
- `ServicePower Call Status Update` (1) — generic status change.
- `ServicePower Status Report` (1, attachment `STATUS.TXT`) — daily status digest, plain text.

**Join key:** `Call # / Call No` (typically 12 digits) → `jobs.claim_number`. Note: same Call # often appears in both the ServicePower email AND the corresponding SquareTrade email (see §2.3) — cross-channel correlation possible.

**Body parsing observation:** ServicePower emails use a remarkably clean label-value-newline format throughout. Same parser strategy as our AHS XML (split-on-label, split-on-newline) would work. Likely the easiest of the new sources to parse.

### 2.3 SquareTrade / Allstate Protection Plans (30 emails, 12 patterns)

Multiple sub-senders, each handling specific operational concerns:

| Sub-sender | Operational role |
|---|---|
| `appliance_dispatch@squaretrade.com` | Status request reminders + diagnostic/reschedule requests |
| `appliance_team@squaretrade.com` | Failed repair escalations + 2nd-visit dispatches + claim updates |
| `warrantysupport@squaretrade.com` | Initial claim creation announcements |
| `rma_request@squaretrade.com` | Parts return authorization |

**Key dispatch-related types:**

- `Allstate Protection Plans: ServicePower Repair {n}` (5) — claim creation announcement. **Companion email** to a ServicePower dispatch — the dispatch comes via `noreply@servicepower.com` (see §2.2), this email announces the SquareTrade-side claim. The {n} is the claim number.
- `Service power-New Dispatch` (2) — **2nd-visit follow-up**, NOT a fresh dispatch. Body explicitly: *"The customer you previously serviced has reported ongoing issues with their unit shortly after the repair. Please close out the original dispatch {old_n} ... We have created a new dispatch call number for an additional repair: {new_n}"*. Critical: links OLD dispatch number → NEW dispatch number. We should mark the old job as "closed - second visit needed" and create a new job linked back.

**Reminder cascade — 13 of 30 messages = 43% of SquareTrade volume:**

- `Allstate request for updated Appliance call status` (4)
- `Allstate request for updated Appliance call status, 2nd request` (5)
- `Allstate request for updated Appliance call status, 3rd request` (1)
- `Allstate request for updated Appliance call status, Final request` (2)

Each tier escalates if we don't respond. **Single biggest DRY-up target in the inbox.** Automatically posting status back to ServicePower / SquareTrade would eliminate this entire cascade. (The ServiceDispatch SOAP `updateCallInfo` from yesterday's inventory is the write path.)

**Escalation messages:**

- `24hr notification from Allstate: Reply Requested on Failed Repair for {n}` (2)
- `Allstate Failed Repair Notice: Reply requested for {n}` (2)

Triggered when a previous repair attempt failed and the customer is back complaining. Need human attention.

**RMA / parts return:**

- `Allstate Protection Plans RMA Number #[{n}] for Claim #[claim_{n}] is available` (4) — parts being recalled. Has both RMA number AND claim number in subject for join.

**Other:**

- `Diagnostic Truck Roll Request` (1)
- `Upcoming Repair: Schedule Change Requested by Customer` (1)
- `Claim Update {n}` (1)

**Join key:** Call number / claim number (typically 12 digits). When subjects format as `Claim #[claim_026093774130]` the `claim_` prefix is consistent — strip it.

### 2.4 NSA — National Service Alliance (30 emails, 24 patterns)

NSA has the most diverse template space — 24 distinct patterns in a 30-message sample. Most volume from a single bulk sender; some human reps reply directly.

**Bulk sender:** `Notifications <notifications@em.nationalservicealliance.com>` — 22 of 30 messages.

**Four distinct program prefixes** observed:

| Prefix | Likely full name | Notes |
|---|---|---|
| `ARW` | (TBD — Asurion? Apple Repair Warranty?) | Most common in sample |
| `HAP` | Hisense Appliance Program | Body contains "HIS Parts Shipped" etc. |
| `ASU` | (TBD) | Less common |
| `SHW` | (TBD) | Less common |

Each program has the same template family applied:
- `NSA Dispatch for {PROGRAM} Dispatch# {PROGRAM}{n} Case# ...` — DISPATCH_OFFER
- `NSA Update Request for {PROGRAM} Dispatch#...` — STATUS_REQUEST
- `Repair Cancelled for {PROGRAM} Case# ...` — CANCELLATION
- `Repair Closed by NSA for Case#: ...` — COMPLETION
- `Estimate Approved Dispatch#: ...` — ESTIMATE_APPROVED

**Dispatch body shape** (ARW example): HTML email with branded header, three buttons (Confirm / Confirm Alternative Date / Reject), pre-authorized totals, signed by a rep (Katelyn Shumway). Includes a per-customer rep contact phone/email inline. **HTML parsing required** — no XML attachment.

**Human-rep replies:** `Katelyn Shumway@`, `Angie Hewett@` etc. — these are free-form replies within email threads, requesting status updates or providing parts info. **Skip parsing** — these are conversations that require human handling.

**Other operational notifications:**

- `HIS Parts Shipped for Case# H{n}` (2) — Hisense parts shipped, with tracking
- `NSA EFT Payment Register - {id}` (1) — payment register, attaches a list of EFT payments
- `Integrity OVERDUE PART RETURN, CASE# {n}` (1) — RMA reminder from `partsupport2@`
- `PENDING ESTIMATE` (1) — pending estimate notification

**Join key:** Both **dispatch number** (`ARW…`, `HAP…`) and **case number** (`NSA…`, `H…`, `PRN…`). Different programs use different case-number prefixes. We probably want to store both.

### 2.5 The "210" query — no warranty hits

Search for `from:210` OR `subject:210` over 60 days returned **2 results**, both RingCentral voicemail notifications from a Tennessee phone (629) 210-####. **Not a warranty source.** The "210" reference from yesterday's planning conversation needs clarification — possibilities:

- A different vendor I haven't surfaced (different domain that doesn't match my queries)
- A case-number prefix on SquareTrade or NSA emails I'd need to search differently
- A phone area code (210 = San Antonio) that came up in a different context

**Flag for Teddy:** what does "210" refer to in your mental model?

---

## 3. Surprise findings

1. **AHS has a SECOND dispatch path** — `DispatchRegionP1@ahs.com` direct, distinct from `noreply@msg.frontdoor.com`. Human dispatchers send these with sparse data ("Opportunity of New Dispatch – Dispatch ID -…"). Probably lower volume but a clear gap in our current AHS coverage.
2. **SquareTrade emails are mostly reminders, not new work.** ~43% of inbox volume is the same "where's the status?" cascade. Automating status-back via ServiceDispatch `updateCallInfo` would silence this entire category.
3. **ServicePower and SquareTrade send PARALLEL emails for the same job.** A new SquareTrade-warranted job triggers BOTH a `noreply@servicepower.com` "Service Request Notice" AND a `warrantysupport@squaretrade.com` "Allstate Protection Plans: ServicePower Repair {n}" announcement. They share the same Call #. **Dedup before creating duplicate Xano jobs.**
4. **"Service power-New Dispatch" is misnamed** — it's a second-visit follow-up notification (close old dispatch, open new one for same customer), not a fresh dispatch. Subject format misled my initial pattern match. Don't treat as DISPATCH_OFFER.
5. **CIL Accepted means the job is dead from our side.** Frontdoor's "Cash In Lieu Accepted" means the customer is being paid out and we never service. We should auto-close any of our jobs that get a CIL notification.
6. **NSA covers FOUR programs under one inbox** (ARW, HAP, ASU, SHW). Each program is essentially a separate warranty product, but they all share NSA's template family. One parser can handle all four if it extracts the program prefix as a field.
7. **SquareTrade RMA process is parts-return-driven.** When ServicePower sends a part to the customer, SquareTrade triggers an RMA email with a separate RMA number. Need to track RMA number alongside claim number for parts logistics.
8. **A daily Frontdoor digest exists as an Excel attachment.** `Your daily status update` with `appointment.xlsx`. Could be a fallback reconciliation source if any individual email is missed.
9. **ServicePower's "Service Request Notice" includes a one-time accept/reject URL.** `https://www.squaretrade.com/frontend/schedule-appointment/...?token=...` — looks like a signed token URL. If we auto-accept via API (ServiceDispatch `updateCallInfo`), we shouldn't ALSO follow this URL. Mutually exclusive paths.
10. **"210" produced false positives** — the planning-conversation reference to "210" as a warranty source doesn't match anything in the inbox. May be a misremembered name or a vendor not yet emailing us.

---

## 4. Recommended Phase A build order

Order by leverage (volume covered × parser easiness) and dependency:

**Phase A1 — ServicePower "Service Request" + "Service Request Notice" parser.**

- **Volume:** 18 of 30 ServicePower messages = ~60% of platform volume; this is the SquareTrade/Allstate intake path.
- **Difficulty:** Easy. Cleanly labeled plaintext, parser shape identical to the AHS XML parser (split-anchor pattern). No SOAP, no XML, no attachment juggling — just split-by-label.
- **Dependency:** None. Standalone.
- **Output:** Job rows with `customer_type=warranty`, `warranty_company=SquareTrade` (or `Allstate`), `claim_number=Call #`.
- **Dedup risk:** SquareTrade ALSO emails the same job via `warrantysupport@squaretrade.com` (see surprise #3). Use `claim_number` uniqueness check to skip duplicates.

**Phase A2 — AHS Frontdoor "CIL Accepted" handler.**

- **Volume:** 3 of 30 AHS messages = ~10% of AHS volume.
- **Difficulty:** Medium. HTML parsing needed but specifically just to extract `dispatch_id`.
- **Why next:** Closes the existing AHS workflow gap — without this, "Cash In Lieu" dispatches stay open as ghost jobs in Xano forever. Auto-close them.
- **Dependency:** Existing AHS parser job-lookup (`claim_number`).

**Phase A3 — SquareTrade status-update writer.**

- **Volume:** Silences the 43% reminder cascade.
- **Difficulty:** Medium. NOT an inbound parser — this is the OUTBOUND ServiceDispatch SOAP `updateCallInfo` call. Triggered by job status transitions in Xano (e.g., when a tech accepts, completes, etc.), it posts status back to ServicePower.
- **Dependency:** ServicePower SOAP credentials (Teddy is following up on this per the warranty-operations-strategy notes).

**Phase A4 — AHS direct (`DispatchRegionP1@ahs.com`) dispatch parser.**

- **Volume:** Low (~1 per 30 = ~3% of AHS), but it's a structural gap.
- **Difficulty:** Medium. Prose body, sparse data. Probably ingest as a thin shell job with a flag like `requires_manual_enrichment=true` and route to Teddy/Danielle for completion.
- **Dependency:** None.

**Phase A5 — NSA dispatch parser (covering ARW/HAP/ASU/SHW).**

- **Volume:** ~10-20% of total inbox volume.
- **Difficulty:** Medium. HTML parsing with program-prefix extraction.
- **Dependency:** None. Standalone.

**Phase A6 — Estimate / RMA / Parts shipped / Repair closed handlers.**

- **Volume:** Distributed across vendors, ~30% combined.
- **Difficulty:** Easy-Medium each, similar HTML parsing.
- **Why later:** These are state-transition handlers for jobs ALREADY in Xano. Without the upstream dispatch parsers, there's nothing to update.

**Skip / defer indefinitely:**

- Human-rep reply threads (Katelyn / Angie / etc.) — free-form text, low value.
- Daily digest xlsx attachments — reconciliation tool, not real-time signal.
- "210" — pending clarification from Teddy.

---

## 5. Open questions for Teddy

1. **"210" reference** — what does it map to? Not a warranty source per the inbox.
2. **ARW / ASU / SHW program identification** — which manufacturers does NSA route under each prefix? HAP is clearly Hisense; the others are unknown. Affects warranty_company field assignment.
3. **CIL operational decision** — when a CIL is accepted, do we want auto-close the Xano job + notify Teddy, or just notify and require manual close?
4. **Service Request vs Service Request Notice** — confirm my interpretation that Notice = offer-pending-accept and Request = post-accept confirmation. If correct, only one of the two should create a Xano job; the other should update its status.
5. **`Service power-New Dispatch` (2nd visit) handling** — should the new job link to the old job via a `parent_job_id` column? Or just standalone with a note?
6. **NSA vs ServicePower volume** — based on this sample, NSA is meaningful but smaller than ServicePower/SquareTrade and AHS. Confirm priority ordering — is NSA worth doing before SquareTrade auto-status-back?
7. **Dedup model** — SquareTrade and ServicePower send PARALLEL emails for the same job (sharing Call #). Confirm dedup on `claim_number` is the right approach, OR if we should mark them as separate-but-linked records.

---

## 6. Methodology + scope notes

- Survey conducted via local Node script (`.tmp_smoke/gmail-landscape-survey.js`), gitignored. Uses existing OAuth refresh token from Netlify env. Read-only — no labels applied, no message modifications.
- All bodies redacted before storage: names → `{name}`, phones → `{phone}`, emails → `{email}`, street addresses → `{street}`, ZIP → `{state-zip}`.
- Subject patterns collapsed by replacing digit runs and ID-shaped tokens with `{n}` / `{id}` so multiple instances aggregate under one canonical pattern.
- 30-message cap per sender query. Real long-term volumes likely 2-5× the 60-day sample window. Material new patterns may exist outside this window.
- "210" query was broad to catch unknown senders. If Teddy clarifies what "210" refers to, a follow-up targeted query can be run.
- The full JSON output is in `.tmp_smoke/landscape.json` (gitignored). Regeneratable from the script.

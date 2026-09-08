# AssistAnt — Invention Disclosure (attorney prep)

> **⚠️ NOT LEGAL ADVICE — attorney work product prep.** This describes how the AssistAnt platform works,
> in plain English, so a patent attorney can assess patentability and draft claims. I make **no claim
> about what is or isn't patentable** — that is the attorney's job. File citations point to the working
> code (evidence of reduction-to-practice). Build dates are marked **[CONFIRM]** for me to fill.

**Inventor / owner:** James "Teddy" Pivacek — TN Appliance Exchange LLC — EIN 38-3886067
**Product:** AssistAnt / AssistAnt 24/7 (multi-tenant SaaS for service businesses)
**Date:** 2026-09-08

**Field of the invention:** software for operating a field-service business (appliance/HVAC/auto repair,
etc.) — AI telephone handling, dispatch/scheduling, diagnosis, parts commerce, and multi-tenant provisioning.

**What the market has (prior art we're distinguishing from):**
- **Generic AI answering services** (e.g. FixCall AI): an LLM answers the phone and takes a message / books
  a generic slot. One voice for everyone; no operational board; no fulfillment.
- **Marketing/CRM stacks** (e.g. HighLevel): bundled email/SMS/funnels/CRM. Not operational; no phone brain
  grounded in live job data; no repair/diagnosis/parts layer.

The mechanisms below are engineered systems (latency handling, privacy partitioning, reversible operations,
outcome-graded learning, drop-ship commerce), not "an LLM with a prompt." Ranked most→least distinctive.

---

## Mechanism 1 — Pre-call caller recognition on a hard latency budget with graceful degradation
**Files:** `netlify/functions/platform-precall.js`, `netlify/functions/platform-call-brain.js`,
`docs/sql/045_call_brain.sql`. **[CONFIRM first-built date]**

At the instant a call is picked up — **before the AI speaks** — the telephony provider POSTs the call
context to a webhook. The webhook resolves the caller's phone number against *that specific shop's* live
job board and returns the AI's actual opening sentence as a dynamic variable (e.g. "Hi Angela — I see
you're scheduled Thursday with Joey for your dishwasher; is that what you're calling about?"). The whole
resolution races a **hard ~1.8-second deadline** (the provider abandons the webhook after ~2s and would
otherwise speak the literal placeholder), and **any failure or timeout returns a warm generic greeting
(HTTP 200)** so a call is never silent or broken. The shop's identity is **encoded in the webhook URL**
(`?slug=&k=`), so no dialed-number→shop lookup table is needed.

**Why non-obvious:** a generic answering bot asks "who's calling?" and looks things up *mid-conversation*.
This front-loads identity + situation resolution into the sub-2-second pickup handshake, under a real-time
race, with a defined degradation path that guarantees a live greeting — an engineered latency/reliability
mechanism, not a prompt.

## Mechanism 2 — Audience-lens grounded "call brain": one resolver, multiple role-scoped truthful phrasings
**Files:** `netlify/functions/platform-call-brain.js`, the `platform_call_lookup` RPC in
`docs/sql/045_call_brain.sql`. **[CONFIRM]**

Given a shop identifier + a caller handle (phone / warranty-claim number / name), a security-scoped
database function resolves *who* is calling and their current job — company-scoped so one shop can never
surface another shop's data — and then a composer renders **three different grounded sentences from the
same facts, selected by who is listening:** a **homeowner lens** (day-only, never a clock time, never a
part number or claim number, never says "canceled"), a **warranty-representative lens** (full status
including claim number and parts ETA in one breath), and an **office lens** (terse, with operational
flags like "NO TECH / AWAITING PARTS"). Hard grounding rules prevent hallucination (say "your technician"
when no tech name is known; a completed+warranty job redirects to a recall path; a blank "situation" line
when unsure so it never opens on a wrong assumption).

**Why non-obvious:** the AI **reads a server-composed, per-audience, privacy-partitioned line** rather than
free-generating — deterministic truthful phrasing from one fact source, purpose-built for a trade with
warranty intermediaries who must hear different (permitted) detail than the homeowner.

## Mechanism 3 — Honest dual-tier parts offer ("4 options") coupled to a ship-to-customer drop-ship loop
**Files:** `cash-tdr-customer.html`, `teddy-tdr-tool.html`, `api/cash_tdr/stripe_checkout_session_completed_POST.xs`,
`netlify/functions/platform-tn-parts-migrate.js`, plan `docs/amazon-dropship-store-plan-2026-07-18.md`. **[CONFIRM]**

From a single diagnosis, the customer is presented a **2×2 matrix of four transparent options** — OEM part
vs. aftermarket-equivalent part, × DIY (part shipped to the customer's home) vs. professional install —
with prices computed from the *recorded per-failure part costs* (both OEM and aftermarket cost fields)
plus a flat labor rate, framed against a "typical hidden-markup" reference price to demonstrate value. On
payment, the system writes a parts order flagged **ship-to-customer** to the correct supplier at the
service address, closing a **drop-ship fulfillment loop**. It **deliberately excludes warranty jobs** (a
shop ordering the part itself would break the warranty claim), so the fork is self-pay-only by design.

**Why non-obvious:** this couples an AI diagnosis to a real, honesty-framed, four-way commerce offer with a
physical drop-ship path and a rule-based warranty exclusion — not a lead-gen widget or a phone bot.

## Mechanism 4 — Reversible owner-action ledger + role-aware AI operator + pattern-learning from the ledger
**File:** `netlify/functions/_lib/owner-actions.js` (shared by `platform-owner-action.js` and `platform-ant.js`). **[CONFIRM]**

Every management action — whether taken by the AI or a human — flows through **one whitelist of intents**
(set parts margin, toggle/reword customer texts, set tech commission/stops/area, day-off, schedule /
unschedule / move a job, flag a part needed…). Each intent **captures the exact before-state, applies the
change, and logs a record that is fully undoable** by replaying that before-value; writes are always
re-scoped to the resolved shop, and a technician caller gets a self-scoped subset. A **pattern-learning
layer treats the action log itself as the training set** (no new data collection): it detects undo-prone
intents (so the AI stops proposing changes the owner keeps reverting), the owner's habitual parts margin,
communication preferences, and per-area booking defaults.

**Why non-obvious:** an AI that *operates the business's real settings and dispatch* through a reversible,
audited, self-scoped command layer, and learns each business's preferences from its own reversals — a
governed AI-operations layer, categorically beyond an answering service or a marketing automation.

## Mechanism 5 — Self-grading cross-job repair-prediction flywheel with an earned-confidence guardrail
**Files:** `netlify/functions/ant-brain-predict.js`, `ant-brain-grade.js`, `_lib/brain-eval.js`,
`_lib/ant/model-knowledge.js`. **[CONFIRM]**

Before a technician is dispatched, the engine predicts the likely failed part from **what actually fixed
similar machines across all prior jobs** — tiering the match scope (exact model → brand+appliance →
appliance, with a hard appliance gate so it can't cross-leak, e.g. an oven board for a fridge),
aggregating by part, and returning a **confidence number that must be *earned* by repeated corroboration**
(a fix seen only once is down-weighted — the "confidently wrong on one data point" guardrail). A later
grading step **compares each prediction to the job's real repair outcome and records hit/miss**, so
accuracy compounds over time; when it can't predict, it writes a **knowledge-gap ledger** entry.

**Why non-obvious:** a self-grading, honesty-guardrailed prediction loop trained on the operator's own
accumulating repair outcomes — a moat a competitor without a repair-outcome corpus cannot replicate.

## Mechanism 6 — Config-row multi-tenant "vertical factory" (one deployment, many trades/brands)
**File:** `platform/verticals.js` (read by the landing, signup, and provisioning flows). **[CONFIRM]**

Standing up an entirely new trade vertical (appliance → automotive → aquarium → furniture → dealership) is
**a single catalog row plus a domain pointed at the same deployment** — no fork. One hostname resolver maps
many branded domains to the correct face; every vertical rides the **same platform, same AI brain, same
billing**; only the branding/vocabulary/workflow differ (a `trade` key selects the provisioning workflow),
and each trade's knowledge brain starts empty and deepens as that vertical's shops feed it.

**Why non-obvious:** a horizontal AI-operations platform that self-replicates into any service trade by
configuration, each new vertical inheriting and contributing to a shared brain — an architecture, not a feature.

## Mechanism 7 — Mid-call action router: the phone AI closes the loop during the call
**File:** `netlify/functions/platform-call-act.js`. **[CONFIRM]**

Beyond reading status, the AI can **act during the call** — all shop-scoped, all best-effort (a failure
returns a spoken fallback and never throws into the call): **request-a-day** (parses a spoken "Thursday" /
"tomorrow" into a date and records a low-promise scheduling offer the office confirms, or spawns a fresh
lead carrying the requested day); **callback** (writes a note on the job or mints a new lead and texts the
owner — "never lose a caller"); **send-link** (finds/mints the customer's portal token and texts a tracking
or intake link). Human transfer uses the telephony provider's native transfer, gated to business hours.

**Why non-obvious:** the phone AI writes real, reversible, low-promise commitments onto the live
operational board and the fulfillment/portal rails — a transactional loop versus a message-taker.

## Mechanism 8 — Tiered warranty-email intake with an LLM universal-format fallback
**Files:** `netlify/functions/_lib/warranty-email.js`, `platform-email-intake.js`,
`cloudflare/email-intake-worker/src/worker.js`, `_lib/parsers/servicepower.js`, `docs/sql/044_email_intake.sql`. **[CONFIRM]**

Inbound warranty-dispatch emails become normalized job records via a **three-tier extractor, best-first:**
(1) deterministic parsers for known vendor formats (AHS/Frontdoor XML; a ServicePower/SquareTrade text
state-machine); (2) an **LLM fallback that reads a dispatch format never seen before and extracts the same
strict schema** — so onboarding a brand-new warranty company needs zero new code; (3) if even that finds no
customer, the email is logged for a human. Known vendors never touch the LLM (fast/cheap); the LLM is
reserved for novel senders. Each shop's intake address is unique, and records are deduplicated per message.

**Why non-obvious:** a self-extending intake pipeline for the fragmented home-warranty dispatch ecosystem
that generalizes to unseen senders — specific to this trade's B2B2C plumbing, which neither a phone bot nor
a marketing stack addresses.

---

## For the attorney
- These are **described, not assessed** — please advise which (if any) are patentable and worth a provisional.
- The **lead candidates** by distinctiveness are Mechanisms **1, 2, 3, 4**.
- The **repair-outcome data corpus itself (Mechanism 5's training data)** we intend to keep as a **trade
  secret**, not patent — flagging so a patent draft doesn't inadvertently publish the data strategy.
- Related existing protection to be aware of: the NDA + reseller agreement (`docs/partner/tk-*.md`) already
  assign IP to the Company and bar reverse-engineering.

> **Not legal advice. Prepared to help my counsel evaluate patentability and prepare any filing.**

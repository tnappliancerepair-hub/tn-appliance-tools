# Ant Intelligence Architecture — the canonical spine for the brain

*v1 · 2026-08-02. This is to the troubleshooting brain what `ant-operating-plan.md`
is to the business: the source of truth for how we engineer Ant into **the most
advanced, most grounded, most reliable troubleshooting brain in appliance repair**
(the standing #1 goal). Build on this doc; keep the changelog at the bottom current.*

Related: `loop-redesign-postgres-migration.md` (the foundation), `loop-capabilities-backlog.md` (adjacent features), `ant-operating-plan.md` (the business).

---

## 0. The core principle — the moat is the flywheel, not the model
Anyone can call Claude or GPT. **Nobody else has 49k HCP jobs + every TDR our techs
close + a loop that grades its own accuracy every day.** So "most advanced brain"
is not won by the model — it is won by a compounding loop:

> **proprietary data → grounded structured knowledge → measured accuracy → compounding**

The model is a commodity input. The **data + the measurement loop** are the moat.
Every architecture decision serves one test: *does it make the flywheel spin faster
or make it measurable?* If not, it's not intelligence work.

Two non-negotiable constraints, both already adopted:
- **Reliability-first / structured-first, semantic-optional.** The brain must stay
  confident even when a flaky store (vectors/LLM/an external fetch) is down. Every
  external call is timeout-guarded and degrades to thinner-but-present, never absent.
- **Grounded-only.** The brain answers from retrieved truth with citations, or it
  says "I don't know" and logs the gap. It never fabricates a part/day/status.

---

## 1. The five layers (we already have pieces of every one)

### Layer 1 — Unified data substrate (the fuel)
One clean, queryable store (**Postgres + pgvector**). Today the gold is scattered:
Xano, Supabase archives, event_log, the HCP 49k archive, 8yr MeisterTask. **The
Postgres migration is Phase 1 of the brain, not a detour** — it's what unifies the
corpus. Then wire the flywheel's fuel line: **every closed job / TDR / call
transcript / part outcome auto-flows in as a new labeled example** — no manual step.

### Layer 2 — Structured-first knowledge (the anchor)
Deterministic, reliable, degradable recall — the center of gravity:
- **Model-family recall** (`_lib/ant/model-knowledge.js`) — "on this model / platform family, here's what fails + the part." Exact → family → bundled base.
- **Fault codes** (`_lib/ant/fault-codes.json`) — brand-family aliasing + normalization.
- **Component knowledge** (`_lib/ant/component-knowledge.js`).
- **Live TDR aggregate** (`get_common_failures`) — the real-time flywheel; every closed job enriches recall with no embedding needed.
This layer is what makes an answer trustworthy AND what keeps the brain up when everything fancy is down.

### Layer 3 — Grounded reasoning (the composer)
Retrieve, then reason — never reason ungrounded:
- Retrieve **structured** (Layer 2) + **semantic** (pgvector: similar jobs, tech sheets) + **external authority** (MSA World tech sheets, CPSC recalls, brand bulletins, Marcone/mSupply live cost+stock).
- **Claude composes a CITED answer** ([fault-code] / [common-failures] / [job #N] / [tech-sheet]), role-aware (customer sanitized — never a part # to a customer), degrading structured-first.
- **Predict-the-part**: model + symptom → ranked parts + **confidence score** (`ant-brain-predict`). The "Tech vs Ant Brain" game — every round is a labeled training example.

### Layer 4 — The learning loop (THE LINCHPIN — our biggest current gap)
This is what turns effort into *compounding* instead of a plateau. Most "AI systems"
stall here because they never measure. This layer is the difference between "a brain"
and "the best brain":
- **Eval harness (NEW — highest-leverage thing to build).** Hold out real job outcomes as a test set; measure **first-guess part accuracy + diagnosis accuracy, per appliance/brand/model, over time.** You cannot become "the most advanced" without measuring. This is the gravitational center of the whole system.
- **Closed-loop grading** (`ant-brain-score`) — every prediction graded against what actually fixed the job (hit/miss), fed back.
- **Gap ledger** (`knowledge-gap.js`) — every "I don't know" becomes a permanent "now I know"; recurring gaps rise to the top and get filled first.
- **Prompt/retrieval evolution** — changes tested **against the eval set**, not vibes.
- **Nightly scoreboard** (`knowledge-scorecard.js` pattern) — models known, first-guess accuracy, open gaps, trend ▲. Measure it or it's a vibe.

### Layer 5 — One brain, every surface (delivery)
The same intelligence, read by every seat: **tech** (in-truck assist), **phone**
(Ann), **office** (pre-diagnosis), **customer** (DIY), **warranty** (claim/parts
assist) — rendered **multilingual + multi-area**. "One write, many reads," applied
to intelligence. No surface has its own divergent brain.

---

## 2. Exactly how — the build sequence
Order matters; each step is a prerequisite for the next.

1. **Migration first = Phase 1 of the brain.** Clean, unified, queryable Postgres store. (Per `loop-redesign-postgres-migration.md`, done side-by-side, bulletproof-before-flip.)
2. **Unify the corpus** into Postgres + pgvector; wire the auto-flow so every job/TDR/transcript/part-outcome lands as a labeled example.
3. **Build the eval harness — BEFORE new features.** Baseline current accuracy on real held-out outcomes, per appliance/brand/model. This is the discipline that changes the trajectory.
4. **Improve grounding/retrieval against the eval** — structured anchor + semantic + external authority, all cited, all reliability-degradable.
5. **Run the learning loop continuously** — grade → gap-fill → evolve, measured nightly with a trend.
6. **Deliver everywhere + monetize** — warranty parts-prediction (fewer trips), DIY grounding (cash + trust), job-mined localized content (marketing).

---

## 3. Why this is the center of the whole business
The same flywheel powers every growth thread:
- **Warranty efficiency** — predict the part before the truck rolls → one-trip fixes → the biggest warranty margin lever.
- **Cash growth** — honest, grounded DIY diagnosis → trust → bookings + parts revenue.
- **Marketing** — every closed job → localized DIY/pro content in 13 languages across every metro.
Build the flywheel once; warranty, cash, and marketing all pull from it. That's the leverage.

---

## 4. Honest inventory — build-on, not rewrite
We already have ingredients of every layer:
- ✅ Structured knowledge: model-knowledge, fault-codes, component-knowledge, get_common_failures.
- ✅ Reasoning: ant-troubleshoot, ant-brain-predict, MSA/CPSC/Marcone hooks, embeddings.
- ✅ Loop pieces: ant-brain-score (grading), knowledge-gap (ledger), knowledge-scorecard (nightly trend).
- ⚠️ **Missing / weak:** the unified queryable substrate (scattered today → the migration fixes it) and, above all, **the eval harness** (no held-out accuracy measurement per model/brand — the #1 thing to add).
The future system is **unifying these on the clean foundation + making the measurement loop rigorous** — not starting over.

---

## 5. The decision rule
When choosing what to build for the brain, ask: *does it make the flywheel spin
faster (more/better labeled data flowing in) or make it measurable (eval/grading)?*
Deepening data, grounding, accuracy, and reliability wins. Anything that adds a
clever-but-unmeasured feature loses. **Deepening + measuring the knowledge base IS
the business.**

---

## Changelog
- **2026-08-02 — v1.** Canonical architecture captured: flywheel-not-model core principle; 5 layers (unified substrate → structured anchor → grounded reasoning → learning loop → one-brain delivery); build sequence anchored on the Postgres migration as Phase 1; the **eval harness named as the linchpin + biggest gap**; reliability-first + grounded-only constraints; honest build-on inventory. Written with Teddy during the Sunday engineering-strategy session.

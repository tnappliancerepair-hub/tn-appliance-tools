# Protecting AssistAnt — IP strategy & attorney-prep kit

> **⚠️ NOT LEGAL ADVICE.** This is my own strategy memo, prepared so I can hand my counsel an organized
> starting point. It is not a legal document and makes no legal determination. Nothing here is a filing.
> Every fact only I can confirm is marked **[CONFIRM]**. The one required next step is a consultation
> with a licensed intellectual-property attorney (Tennessee).

**Prepared by:** James "Teddy" Pivacek
**Business:** TN Appliance Exchange LLC — EIN 38-3886067 — 3137 Skinner Dr, Antioch, TN 37013
**Product:** AssistAnt / AssistAnt 24/7 (the SaaS platform TN Appliance leases to other shops)
**Date:** 2026-09-08

---

## Why now
Competitors are converging on the same idea fast — **FixCall AI** (a thin AI phone-answering bot) and
**HighLevel** (a marketing stack) are running ads that overlap our pitch. A copycat can clone a *screen*
in a month; the goal of this memo is to protect the three things they can't casually copy: **the name,
the novel mechanisms, and the data.** Today we have strong *contractual* protection (NDA + reseller
agreement — below) but **zero registered IP.** This closes that gap in the right order.

## The three-layer strategy
Protect each asset with the right tool. Do the cheap, fast, high-value moves first.

| Layer | Asset | Tool | Why | Rough cost | Speed |
|---|---|---|---|---|---|
| 0 | Names/handles/domains | Reserve + ™/© notices | Free defensive housekeeping | ~$0–$100 | today |
| 1 | The brand name | **Trademark** (USPTO) | Stops name-copycats; strongest, cheapest registered IP | ~$250–$350/class (self) or +attorney | weeks to file |
| 2 | The novel mechanisms | **Provisional patent** | 12-mo "patent pending" + priority date; scares cloners | ~$1.5K w/ attorney (less DIY) | days–weeks |
| 3 | The data / repair brain | **Trade secret** (keep it secret) | Patenting = publishing = teaching them; the data is the real moat | ~$0 (hygiene) | ongoing |

### Layer 0 — free housekeeping (do today)
- **Reserve the remaining `-Ant` domains + social handles** before someone else does: `ant.repair`,
  `applianceant.com` (live), plus the vertical set `autorepairant.com / aquariumant.com / furnitureant.com /
  dealerant.com`, and the matching handles. [CONFIRM which are already owned.]
- Put **™** on the marks in the product and **© TN Appliance Exchange LLC** on code/content (copyright is
  automatic on original work — nothing to file, but the notice + keeping the repo private matters).
- Mark internal strategy/architecture docs **"Confidential."**

### Layer 1 — TRADEMARK the brand (start here — best value)
**Marks actually in use (name the right ones):**
- **ASSISTANT** — the core product wordmark.
- **ASSISTANT 24/7** — the live customer-facing brand string.
- The **ant device / logo** — `icons/ant-512.svg` (figurative mark).
- **"Ann"** — the per-tenant AI phone-receptionist name (distinct from "Ant" the brand).
- The **"[X]Ant" family** (ApplianceAnt / AutoRepairAnt / …) — worth flagging the **family-of-marks / "-Ant"
  suffix system** so the attorney can advise on protecting the pattern.

**Classes:** **9** (downloadable/SaaS software) and **42** (SaaS / software-as-a-service) — attorney confirms.

**Goods/services description (draft for the attorney):** "Software-as-a-service (SAAS) featuring software
for service-business operations, including AI telephone answering and appointment booking, dispatch and
scheduling, customer communication, and repair diagnosis and parts management."

**Specimens:** live screens of the product (the signup page, the office board, the customer portal) + the
brand used in commerce on `tnapplianceexchange.net` / `assistant247.net`.

**First-use-in-commerce dates:** [CONFIRM — first public launch / first paying customer date for AssistAnt.]

**⚠️ CRITICAL disclosure the attorney MUST hear before filing:** the name "Ant/AssistAnt" is a **memorial
tribute to my son Anthony ("Ant")**, and there is a **known prior family right-of-publicity dispute** — a
past cease-and-desist over t-shirts bearing my son's face; my son's mother was executor of his estate.
This is documented in `docs/legal/provenance-intent-anthony.md`. It does not obviously touch a *software
brand* trademark, but the attorney must be told so they can assess any risk before we file. [CONFIRM the
attorney has the provenance memo.]

**Who files it:** you can self-file a straightforward word mark via **USPTO TEAS** (~$250–$350/class), or
have an IP attorney do the search + file (safer given the family-name history and the family-of-marks
angle). **Recommendation:** given the prior dispute + the "-Ant" family, use an attorney for at least the
search + the primary ASSISTANT / ASSISTANT 24/7 marks.

### Layer 2 — PROVISIONAL PATENT on the novel mechanisms
A provisional application gives **12 months of "patent pending"** + a priority date while you (and the
attorney) decide whether to file a full non-provisional — cheap insurance that also deters cloners.

- **The raw material is ready:** `docs/legal/assistant-invention-disclosure.md` describes the 8 most
  distinctive mechanisms in plain English with file citations (evidence of reduction-to-practice).
- **The attorney decides patentability** and which mechanism(s) to claim — I do not assess that.
- **Lead candidates** (most mechanism-y / non-obvious): the pre-call recognition webhook (with its hard
  latency race + warm-degrade), the audience-lens grounded "call brain," the **honest 4-option dual-tier
  parts offer + ship-to-customer drop-ship loop** (the one already flagged as a provisional target), and
  the reversible owner-action ledger + pattern-learning brain.
- **Budget:** the earlier estimate was ~$1.5K with an attorney for a provisional; DIY is cheaper but
  riskier. [CONFIRM budget / attorney.]

### Layer 3 — TRADE-SECRET the data moat (do NOT patent it)
The real, uncopyable asset is the **cross-job repair-outcome corpus + the self-grading prediction
flywheel** — "a copycat with ChatGPT can clone a screen; they can't clone the outcomes." **Patenting it
would publish it and teach competitors.** Keep it a trade secret instead:
- The contractual protection already exists — **NDA §7** (trade-secret obligations survive "as long as it
  remains a trade secret"), **NDA §1/§4/§5** (defines the platform/source/data/prompts as confidential;
  no reverse-engineering; no license), **reseller §5** (Company owns all IP incl. improvements + feedback
  assignment), **§8** (non-circumvention).
- Add operational hygiene: access control on the data/repo, "Confidential" marking, and keep the
  supplier-data discipline already in place (pulled on-demand, model-specific, **not** bulk-mirrored — IP-clean).

---

## Do-this-first sequence
1. **Today (free):** reserve the remaining `-Ant` domains/handles; add ™/© notices; mark docs Confidential.
2. **This week:** book one consult with a TN IP attorney; bring this memo + the invention disclosure + the provenance memo.
3. **Trademark:** file ASSISTANT + ASSISTANT 24/7 (Classes 9 + 42), disclose the family-name history, add the device mark + "Ann" per the attorney's advice.
4. **Provisional patent:** file on the lead mechanism(s) the attorney selects — gets "patent pending" while you decide on a full application.
5. **Trade secret:** finish the access-control + confidential-marking hygiene; keep the existing NDA/reseller clauses in force with every partner.

## Who to use (honest options — no endorsement)
- **Self-file trademark:** USPTO TEAS for a clean word mark (cheapest; fine for a simple mark, riskier here given the name history).
- **IP attorney / firm:** for the search, the family-of-marks strategy, and the provisional. The patent-firm
  ad that prompted this (The Rapacke Law Group) is **one** option among many — not a recommendation; get a
  couple of quotes, prefer a TN-licensed or nationally-registered IP/patent attorney, and confirm they'll
  handle both trademark and a software provisional.

---

## Fill these blanks before the attorney meeting
- [CONFIRM] AssistAnt's first-use-in-commerce date (first public launch / first paying customer).
- [CONFIRM] Which `-Ant` domains/handles are already owned vs still to reserve.
- [CONFIRM] Which entity owns the marks/IP (TN Appliance Exchange LLC — vs. a separate holding entity the attorney may suggest).
- [CONFIRM] Budget for trademark (per class) + a provisional.
- [CONFIRM] The attorney has the provenance memo (the family-name history).

> **This memo is my own organized starting point for my counsel — not legal advice and not a filing. My
> recommended next step is one consultation with a licensed Tennessee intellectual-property attorney, to
> whom I will hand this memo, the invention disclosure, and the provenance memo.**

*Signed: __________________________  Date: __________*

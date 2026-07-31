# Amazon storefront — reputation defense + fitment-accuracy engine (Ant automation spec, 2026-07-31)

Two pillars that keep the store top-rated: (A) defend reputation against fake/abusive feedback,
(B) be MORE accurate than Sears Parts Direct on "will this part fix + fit my machine" (returns are
the #1 Amazon rank-killer). Companion to `amazon-competition-and-wedge-2026-07-31.md`.

═══════════════════════════════════════════════════════════════════
## PART A — Reputation defense playbook

Amazon has TWO rating systems: **Seller Feedback** (rates us) and **Product Reviews** (rate the item).
Amazon is more defensible than eBay: FBA auto-strikes fulfillment complaints, "Request a Review" +
Vine flood genuine reviews, Brand Registry gives a removal weapon.

**Prevent** — FBA the hero SKUs (Amazon strikes fulfillment-based negative *seller* feedback);
kill wrong-part returns via the fitment engine (Part B); label honestly (aftermarket/reman + fitment);
answer buyer messages <24h.
**Dilute** — Amazon's official "Request a Review" (TOS-safe) on every order + Vine + insert cards +
our 1,081-review base/SMS list. One fake barely moves a high-volume average.
  ⚠️ COMPLIANCE: never incentivize reviews or ask "only if happy" (review-gating = suspension). Neutral
  requests only; service-recovery insert ("problem? contact us") is fine — it doesn't gate.
**Remove** — request seller-feedback removal (90-day window) when it's actually a product review,
profane, contains personal info, is entirely FBA-fulfillment, or is policy-violating (Report Abuse).
Brand Registry → Report a Violation tool. Never contact reviewers off-platform.
**The metric:** keep Order Defect Rate < 1% (gates Buy Box + account health).

### Ant automation (build after SP-API creds land)
1. **auto-review-request** — cron reads shipped orders via SP-API, fires Amazon's native
   `createReport`/Solicitations API "Request a Review" in the day-5..30 window, once/order, TOS-safe.
2. **feedback-monitor** — polls SP-API seller feedback + product reviews; alerts owner on any ≤3★;
   auto-classifies against the removal criteria and **drafts the removal request** (case text) for
   one-tap submit. Logs everything to event_log.
3. **service-recovery insert + QR** — box insert "something wrong? scan / text us, we'll make it
   right same-day" → routes to Ant (reuses the repair-side 👍/👎 satisfaction-gate pattern) →
   intercepts the unhappy buyer BEFORE a public 1-star. Neutral, compliant.
4. **return-reason capture** — pull return reasons via SP-API → feed Ant Brain (esp. "didn't fit")
   → fix fitment upstream. Closes the loop: returns train the fitment engine that prevents returns.

═══════════════════════════════════════════════════════════════════
## PART B — Fitment-accuracy engine (beat Sears Parts Direct where it counts)

**Honest framing:** we do NOT out-catalog Sears/PartSelect/RepairClinic (millions of licensed OEM
diagrams). We beat them on "the part that will FIX + FIT MY machine" — the metric returns hinge on —
by USING the OEM diagram as one input and layering Ant's advantages on top.

### Why Ant is more accurate on the metric that matters
- Diagrams show what's COMPATIBLE, not what's BROKEN. Ant adds symptom + fault code + our repair
  history (Ant Brain model→part corpus) → names the failing part, not just a compatible one.
- Outcome data, not just catalog data: every TDR + "did it fix it?" grades the guess → compounds.
- Serial/photo > typed model: OCR the model/serial sticker → exact sub-variant → removes the #1
  fitment error (wrong sub-model).
- Live supersession + stock via Marcone/mSupply → never ship a discontinued/replaced number.
- Free human (tech) backstop on low confidence — Sears has none.

### The engine (pipeline)
1. **Input:** typed model# OR photo of model/serial sticker (OCR → exact variant).
2. **Resolve:** current OEM part# + supersessions + compatible-model list (OEM diagram refs +
   Marcone/mSupply live data + our TDR corpus).
3. **Rank by failure:** fault code + symptom + Ant Brain history → part + confidence % + evidence
   ("fixed 43/47 similar").
4. **Confirm fitment:** cross-check part vs the exact model/variant → green "confirmed fits your
   <model>" / amber "confirm sub-model" / "tech verify."
5. **Backstop:** low confidence → free tech confirm.
6. **Learn:** log sale + outcome (did it fix?) → grade → accuracy climbs above a static catalog.

### Where it plugs in
- **Amazon:** the QR-in-box + listing "will this fit my model?" widget = the returns-killer.
- **Own site / storefront:** the "confirm your part" concierge door (already scaffolded).
- **Field/office:** same engine already feeds the Teddy Tool pre-diagnosis + tech part-finder.

### What we already have vs net-new
Have: Ant Brain model→part corpus, fault-code DB, model/serial OCR, Marcone/mSupply live data,
TDR outcome history, the satisfaction-gate pattern. Net-new: the SP-API auto-review/feedback/return
hooks (Part A) + packaging the fitment pipeline into a public "confirm it fits" widget + QR flow.

**Gate:** both parts light up once SPAPI_CLIENT_ID/SECRET/REFRESH_TOKEN are vaulted (Teddy, AM).

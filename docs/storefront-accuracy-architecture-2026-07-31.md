# Storefront accuracy architecture — ground truth first, Ant Brain on top (2026-07-31)

**Governing decision (Teddy, 2026-07-31).** Supersedes the prediction-first framing in
`amazon-reputation-and-fitment-spec-2026-07-31.md` Part B.

## The rule that gates everything
**90%+ fitment accuracy is the license to sell on Amazon — not a feature.** Wrong-fit parts →
returns → dead account. Therefore:

> **No SKU goes live without verified, ground-truth fitment. Curated catalog, never a catalog
> dump.** Rather list 50 parts we're 99% sure about than 5,000 we're 70% sure about.

## The bug we're correcting
The system was built **prediction-first** — "Ant Brain guesses the failed part from repair
history." A guess is inherently sub-90% until there's mountains of clean data, so treating it as
fitment truth was the flaw baked in from day one (it threw an oven control board at a fridge
evaporator motor). Accuracy does NOT come from a smarter guess — it comes from the DATA being
ground truth and from WHAT WE CHOOSE TO LIST.

## Marcone API reality (verified 2026-07-31)
- `/parts/lookup` is **part#-first**: returns price, dealer/list, stock, discontinued,
  supersession (`crossReferenceParts`), subParts, dimensions. **No fitment field.**
- **No model→parts** endpoint (`productlistlookup` 500s on every shape; `lookupType:'Model'`
  rejected). A part carries **no compatible-models list** either direction.
- So fitment truth must come from the OEM/catalog per part; Marcone gives the money + tier layer.

## Layer 1 — GROUND TRUTH (build now = the 90% gate)
1. **Universal SKUs (~100% by definition):** SS braided hoses, hard-start kits, dryer-vent kits.
   Fitment can't be wrong → launch here, day-one accuracy.
2. **Model-specific SKUs:** list ONLY with a verified **compatible-models list** captured once,
   at listing time, from the part's authoritative OEM/catalog fitment data. Confirm against it.
   No verified fitment = not listed.
3. **Money + tiers from Marcone API:** live cost, stock, supersession, cross-reference equivalents
   (OEM ↔ aftermarket ↔ superseding) — accurate today.

## Layer 2 — ANT BRAIN (add when Layer 1 is solid)
- Operates **strictly inside the verified-compatible set** — it never decides fitment, so it can
  never surface a non-fitting/cross-appliance part.
- Answers the higher-value question: **"of the parts that fit your machine, which fixes your
  symptom?"** — ranked by our real repair outcomes, with confidence + evidence.
- **Trained by the clean data Layer 1 generates:** verified fitment + repair outcomes +
  "did it fix it?" + Amazon return reasons. Compounds instead of guessing from a thin corpus.
- Enhancement only. If Ant Brain is uncertain, fall back to the ground-truth list + "talk to a tech."

## What changes immediately
- **Kill customer-facing prediction.** Ant's diagnosis smarts become an INTERNAL tech aid only,
  never a customer/Amazon promise. `fits.html` becomes a part-confirmation + tier tool
  (part# → live stock + OEM/aftermarket tiers via crossReferenceParts; "confirmed fits" only for
  listed SKUs with verified fitment; else "talk to a tech").
- **Start the universal-SKU beachhead** (accurate now).
- **Build the per-SKU fitment-capture step** for controlled model-specific expansion.

## The path to a real fitment brain (future project, not tonight)
Model→parts index from: the Marcone WEBSITE model-search (daemon, for models we service) + our
own clean repair history (verified_part_number per job, accumulating now) + optionally a licensed
OEM diagram catalog. That feeds Layer 2's coverage over time.

**Companion docs:** amazon-parts-store-tiers, amazon-competition-and-wedge, amazon-reputation-and-fitment-spec.

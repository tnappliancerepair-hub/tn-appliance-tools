# Warranty-Claim Automation — Scope (2026-08-03)

*The #1 build-worthy revival from the agent triage. Scoped against the ACTUAL
codebase, not the CLAUDE.md log — and the finding reframes the whole thing.*

## TL;DR — it's not a build, it's a go-live
Warranty-claim automation is **~70% already built and running in SHADOW right now.**
The ServicePower/SquareTrade path — auto-accept, status-push, claim-build-from-TDR,
claim-submit, and the hourly autosubmit driver — all exist, gated behind LIVE flags,
filing nothing until we flip them. The remaining work is **refinement + validation +
a gated, per-vendor flip**, not a from-scratch build. The single external blocker is
Frontdoor/AHS API authorization (waiting on their side).

**Why it matters:** warranty is 95% of jobs, and claim paperwork + portal updates are
Danielle's single heaviest manual load. This is the biggest labor-saver we have — and
most of the code is done.

---

## Current state — vendor × stage

| Stage | ServicePower / SquareTrade | Frontdoor / AHS |
|---|---|---|
| Dispatch intake | ✅ LIVE (poller) | ✅ LIVE (poller) |
| Auto-accept dispatch | ✅ LIVE (`servicepower-auto-accept`) | n/a (no accept step) |
| Status/notes push to portal | 🟡 **BUILT, SHADOW** (`servicepower-push`, flag `SERVICEPOWER_PUSH_LIVE`) | 🟡 BUILT, SHADOW + **🔴 BLOCKED** (`frontdoor-push-status`, 403 until Brian authorizes the key) |
| Claim build from TDR | 🟡 **BUILT, shadow/preview** (`servicepower-claims-build`, CODE_MAP seeded) | — |
| Claim submit | 🟡 **BUILT, SHADOW** — `servicepower-claims-submit` + `servicepower-claims-autosubmit` (**scheduled hourly, previewing now**, flag `SP_CLAIM_AUTOSUBMIT_LIVE`) | 🔴 **DOES NOT EXIST** (Frontdoor is status-push only; AHS's claim model is TBD) |
| Claim status + payment reconcile | ✅ LIVE (`servicepower-claims-sync`) | — |
| Parts returns (chargeback shield) | ✅ LIVE (`squaretrade-rma-watch`, `warranty-parts`) | ✅ LIVE (`ahs-parts-watch`) |
| Inbound status webhook | n/a | 🟡 DARK (`frontdoor-webhook`, flag `FRONTDOOR_WEBHOOK_LIVE`) |
| Denial handling / resubmission | 🔴 not built (archived concept) | 🔴 not built |

**Key nuance:** SquareTrade completion has TWO paths — the manual **web wizard**
(tokenized squaretrade.com form Danielle uses) and the **ServiceClaims API `/submission`**
(what our automation uses). The API path is the legit automation replacement; it's the
same API that already reads claims + payments successfully.

---

## The remaining work, phased

### Phase A — SquareTrade go-live (near-term, mostly refinement + validation) ⭐
The machinery is done + shadow-running. To flip it live safely:

1. **Refine the claim codes.** `servicepower-claims-build`'s `CODE_MAP` (Defect / Repair /
   Category, part-fault / job codes) is seeded from ONE real claim (MONAHAN). Load
   SquareTrade's **official code lists** from the portal so Ant maps the tech's plain TDR
   to the right codes every time. *(Teddy/Danielle: pull the code dropdowns from the ST portal.)*
2. **Confirm the labor-rate rule** — $105 first-trip / $150 completing-trip (documented;
   confirm it's still fixed, not per-job).
3. **Close the TDR gaps.** The claim needs specific fields; the shadow build already emits a
   "still-needed" list per job. Run it across recent completions → see which fields are
   routinely missing → tighten the TDR capture so claims auto-complete. *(Ties directly to
   the "no stop without a completed TDR" vision.)*
4. **Validate with a decision-diff** *(reuse the migration's exact pattern).* The autosubmit
   is ALREADY building claim previews in shadow. Compare **Ant's built claim vs what Danielle
   actually filed** on N real completions. When they match ~100% across appliance types →
   proven. `servicepower-claims-sync` then confirms acceptance (Submitted → Paid, no rejects).
5. **Flip — safest stage first, per the one-actor rule:**
   - (a) `SERVICEPOWER_PUSH_LIVE=true` — status/notes push. **No money involved**, and it kills
     the biggest manual chore (portal status updates). Flip this first.
   - (b) `SP_CLAIM_AUTOSUBMIT_LIVE=true` — actually files claims. **Real money + partner
     relationship** — flip only after (a) is proven AND the shadow claims validated. Danielle
     stops filing SquareTrade claims the same day (exactly one actor).
   - Human = hot rollback: reverse the flag, Danielle resumes, in ~1 minute.

### Phase B — Frontdoor / AHS status push (blocked externally)
- **Blocker (Teddy/Frontdoor side):** Brian Bullock must authorize our sandbox Client ID
  (the `frontdoor-auth-watch` cron is polling the 403 and will text the moment it clears),
  then grant production access. Nothing we can build unblocks this.
- On clear: flip `FRONTDOOR_PUSH_LIVE=1` (status push) + `FRONTDOOR_WEBHOOK_LIVE` (inbound),
  same shadow → validate → flip. Kills Danielle's AHS portal updating.

### Phase C — AHS claim submission (needs discovery)
- Confirm whether AHS requires a **claim submission** (like ServiceClaims) or is
  **dispatch-completion-based** (status-push = the claim). If submission is required, mirror
  the ServicePower build/submit pattern once AHS's claim fields are known. If not, Phase B covers it.

### Phase D — later (after live claims accumulate)
- **Denial-pattern + auto-resubmission** — low priority (SquareTrade "basically never
  rejects" per the ops log); build once there's rejection data to learn from.
- **NSA** (2nd dispatcher) — needs vaulted portal creds, then the same pattern.

---

## Dependencies — who unblocks what
| Need | Owner | Blocks |
|---|---|---|
| SquareTrade official code lists (portal dropdowns) | Teddy/Danielle | Phase A #1 (claim accuracy) |
| Confirm labor-rate rule | Teddy/Danielle | Phase A #2 |
| Decision to flip status-push, then claim-submit | Teddy | Phase A #5 |
| Brian authorizes Frontdoor sandbox key + prod | Frontdoor (Teddy nudges) | all of Phase B |
| AHS claim-model answer | Teddy/AHS | Phase C |
| NSA portal creds (vault) | Teddy | Phase D |

**Me (autonomous, no blocker):** wire the decision-diff harness for claims (Ant's built
claim vs the human's), refine CODE_MAP once the lists land, tighten the TDR-gap capture,
build the flip-readiness scorecard (shadow match-rate per vendor/appliance).

---

## Safety model (non-negotiable — this is vendor-facing + real money)
Same discipline as the loop migration:
1. **Shadow first** — everything previews/logs; files nothing (already the default).
2. **Decision-diff to "bulletproof"** — Ant's claim must match the human's on real traffic
   before a flip; `claims-sync` confirms Submitted→Paid with no rejections after.
3. **Flip per-vendor, per-stage** — status-push (no money) before claim-submit (money).
4. **Exactly one actor** — when Ant goes live for a vendor, the human stops filing for that
   vendor the same day. Two actors = double claims.
5. **Human = hot rollback** — reverse the flag any time.

## Recommendation — the near-term move
Phase A is the whole win and it's mostly validation, not building. Concretely, next:
1. I wire the **claims decision-diff + flip-readiness scorecard** (shadow match-rate).
2. Teddy/Danielle pull the **ST code lists** so I refine CODE_MAP.
3. Watch the shadow match-rate climb; when it's ~100%, flip **status-push** first, then
   **claim-submit**, each with Danielle as rollback.

Frontdoor (Phase B) proceeds in parallel but is gated on Brian — nudge him, then it's a flip.

*Nothing here is a big build. The build already happened; this is taking a finished,
shadow-running system to production the safe way.*

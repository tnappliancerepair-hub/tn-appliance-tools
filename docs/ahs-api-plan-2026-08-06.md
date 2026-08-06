# AHS / Frontdoor API — Plan: what it can do + what we'll use it for
**2026-08-06 · Teddy + Claude.** Dev team starts our integration **Tue 8/11** (Brian Bullock confirmed; he emails 8/11). AHS/Frontdoor = **~95% of the business**, and this API is the single biggest labor-saver on the board — it kills Danielle's manual portal work and plugs the money leaks (pulled dispatches, unpaid jobs, part-return deductions). This doc is the reference to build on.

---

## 0. The one-paragraph state
Our side is **built and authenticating** — the connector mints a live JWT, the inbound webhook receiver is deployed (dark), the outbound push path is built (shadow). Two things gate go-live and **both are Frontdoor-side, not ours**: (1) Brian links our sandbox **Client ID `040c014f-…`** to our account (clears the 403 on the push endpoint), and (2) Frontdoor points their webhook at **`tnapplianceexchange.net/.netlify/functions/frontdoor-webhook`**. Once those land, going live is a flag flip on our end. The 8/11 dev start is when their side begins.

---

## 1. What the API can do (capabilities)

Two **independent** directions — we can turn them on separately.

### A) OUTBOUND — Frontdoor → us (auto-intake + live job events)
Frontdoor POSTs events to our webhook. Four payload types:
| Event | What it carries | Our use |
|---|---|---|
| **Schedule** | full dispatch: customer, split address, appliance, **brand**, symptom, priority (Normal/Expedited), autho-required, trade, contract, vendor id | **Auto-create + auto-route the job** — replaces Gmail-XML parsing, richer + real-time |
| **Status** | dispatch status changed (code + description + timestamps) | Update the job's live status automatically |
| **notes** | a note was added (text, author, type incl. expert_call_id) | Attach vendor/AHS notes to the job thread |
| **ncc** | non-covered cost created/accepted | Flag out-of-pocket $ owed → feeds our pay flow |

**Key point:** this direction does **not** need the Dev Portal Client ID linked. It only needs Frontdoor to point their webhook at us → then we flip `FRONTDOOR_WEBHOOK_LIVE=1`. **This is the cleanest first win.**

### B) INBOUND — us → Frontdoor (push status + notes into the portal)
We POST a **Dispatch Status Update** (which also carries the note in the same call — one call does both). This is what replaces Danielle typing into `contractor.frontdoorhome.com`.

**Status codes** run 10–500+ (full catalog in `docs/frontdoor-api-spec-2026-06-24.md`). The subset we've coded (the ones that matter for a repair job):
`APPOINTMENT_SET 30 · EN_ROUTE 70 · ARRIVED 90 · IN_PROGRESS 20 · PARTS_ON_ORDER 100 · PARTS_ORDERED 380 · PARTS_ARRIVED 410 · RETURN_SET 400 · AUTH_REPORTED 290 · COMPLETE 10 · INVOICED 440 · CANCELLED 40 · ON_HOLD 150`.

Two candidate endpoints exist (`/dispatch-connector/v1/webhook` vs the simpler `/{routingId}/v1/case-lifecycle/dispatch_status_update`) — **which one we're authorized for is a question for Brian** (may need a `FRONTDOOR_ROUTING_ID`).

---

## 2. What we'll USE it for (prioritized)

Ranked by value ÷ effort. Each kills a specific piece of manual work.

### 🥇 Use case 1 — Auto-intake + auto-route (OUTBOUND Schedule)
New AHS dispatch → job created in Ant instantly, richer than the email parse, **auto-routed to the right crew** by vendor→area. Retires the Gmail poller (kept as a 1-week fallback).
- **Kills:** the 15-min email-parse lag + the "1, LA" address-drop class + manual triage.
- **Readiness:** ~90% built. Needs Frontdoor to point the webhook at us + `FRONTDOOR_WEBHOOK_LIVE=1`. **First to go live.**

### 🥈 Use case 2 — Auto status + notes push (INBOUND) — the Danielle-killer
Tech taps On-my-way / Arrived / Start / Complete in Ant → the status lands in the Frontdoor portal automatically, with the note. No more manual portal status typing.
- **Kills:** Danielle's per-job manual status updates (roadmap item that most directly replaces her).
- **Readiness:** push path built (shadow). Needs (a) Brian to clear the 403, (b) us to **wire the push into the tech lifecycle taps** (a real build, ~a day), (c) reconcile the status-code map.

### 🥉 Use case 3 — The money loop (autho → part order → invoice)
Push **SmartAutho** (estimate before repair), **SmartPart** (parts order), and **Invoicing** (how we get paid) through the API instead of by hand. Autho must precede invoicing (hard rule).
- **Kills:** the three hand-run portal tasks that gate payment; late/missed invoices.
- **Readiness:** later phase — higher $ but gated on **TDR completeness** (labor hours, repair prose, per-unit part cost, tax, timestamps are thin today because techs don't finish TDRs). The `frontdoor-queue.js` portal-helper already composes these fields; the API turns paste-into-portal into a push.

### 4 — Part-return protection
Auto-track the **5-day** part-return deadline (miss it → AHS deducts the part cost). Ties into the returns tooling we already have.

### 5 — NCC / out-of-pocket → pay flow
An `ncc` event (non-covered cost accepted) → surface the out-of-pocket amount → the durable pay link we just built. Warranty repair covered, the extra billed cleanly.

---

## 3. Built vs. blocked vs. to-build

| Piece | State | Gate to live |
|---|---|---|
| Connector (`_lib/frontdoor.js`) — JWT auth, `dispatchStatusUpdate`, STATUS map, vendor→area | ✅ built, JWT proven | — |
| Inbound webhook receiver (`frontdoor-webhook.js`) | ✅ built, **dark** (Bearer-auth, dedup, vendor→crew routing) | Frontdoor points webhook at us → flip `FRONTDOOR_WEBHOOK_LIVE=1` |
| Outbound push (`frontdoor-push-status.js`) | ✅ built, **shadow** | Brian clears 403 → flip `FRONTDOOR_PUSH_LIVE=1` |
| Auth watcher (`frontdoor-auth-watch.js`) | ✅ live — texts Teddy the moment the 403 clears | — |
| Diagnostics (`frontdoor-test`, `frontdoor-keys`) | ✅ built | `frontdoor-keys` returns the Client ID + username to hand Brian |
| **Webhook Status/notes/ncc → actually update the job** | ⛔ TO BUILD — today they're only logged | needs a thin find-job-by-dispatch endpoint |
| **Push wired into lifecycle taps** (on-my-way/arrived/complete/notes) | ⛔ TO BUILD | the real work for Use case 2 |
| Status code↔description reconciled to Frontdoor's authoritative list | ⛔ TO CONFIRM | lock from the ticket/sandbox |
| Production creds + prod webhook token | ⛔ later | after sandbox proves, set `FRONTDOOR_ENV=production` |

---

## 4. Go-live sequence (what happens after 8/11)
1. **Brian links our Client ID** → the 403 clears → `frontdoor-auth-watch` texts Teddy. *(their step)*
2. **Frontdoor points their sandbox webhook at our URL.** *(their step)*
3. We watch 2–3 real sandbox payloads land in `event_log` (`frontdoor_webhook_event`, mode:dark) → confirm the parse looks right.
4. **Flip `FRONTDOOR_WEBHOOK_LIVE=1`** → auto-intake is live (Use case 1). Keep the Gmail poller 1 more week as fallback, then retire it.
5. **Build + ship** the webhook→job-update endpoint + the lifecycle-push wiring (shadow).
6. **Flip `FRONTDOOR_PUSH_LIVE=1`** → status/notes auto-push is live (Use case 2).
7. Prove sandbox end-to-end → get **production creds + a fresh prod token** → `FRONTDOOR_ENV=production`.

---

## 5. Open decisions (for Teddy / to raise with Brian 8/11)
1. **Confirm the contractor account gets this API at all.** The make-or-break: the ProConnect program is real-estate/DTC-heavy — Brian/BD must confirm our contractor account is provisioned for the dispatch/case-lifecycle status API. *(Ask first.)*
2. **Which inbound endpoint are we authorized for** — `/dispatch-connector/v1/webhook` or `/{routingId}/v1/case-lifecycle/...`? If the latter, we need our `FRONTDOOR_ROUTING_ID`.
3. **The authoritative status-code list** — get Appendix A / the live reference so our STATUS map matches theirs exactly (codes go to ~590, incl. NCC/quote/autho states).
4. **Lead order — recommend: auto-intake (Use case 1) first** (outbound, nearly ready, low risk), then the status-push Danielle-killer (Use case 2), then the money loop. Confirm you agree.
5. **Legacy vendor IDs** — portal lists 5 vendor IDs; we've mapped the 3 active ones (822418 John · 822218 Andre · 839828 TN crew). Confirm 1373302 + 120868 are dead, or map them.
6. **Warranty Phase 2 (from the parts session):** alert-only ETA-vs-visit vs. early part-push to the vendor — the push needs this write API, so it unblocks once inbound is live.

---

## 6. Why this matters beyond the labor savings (the big-vision frame)
Frontdoor Inc. (NASDAQ: FTDR) owns AHS, 2-10, and Streem (video/AR diagnosis). That makes them simultaneously our **biggest distribution channel**, our **most natural acquirer**, and our **most dangerous build-it-themselves competitor**. Running deep on their rails is the wedge — but keep independent legs and don't hand over "the how" (the dual-tier/confidence model). Full framing: `docs/big-vision-home-os-frontdoor-2026-06-09.md`.

---

### Reference docs
- `docs/frontdoor-api-spec-2026-06-24.md` — endpoints + full status catalog
- `docs/frontdoor-integration-spec-2026-07-09.md` — the official partner spec Brian sent (payload schemas)
- `docs/frontdoor-go-live-checklist-2026-07-13.md` — the step-by-step cutover
- `docs/frontdoor-portal-workflows-2026-06-22.md` — the manual portal loop this replaces
- `_lib/frontdoor.js` · `frontdoor-webhook.js` · `frontdoor-push-status.js` — the code

### Changelog
- 2026-08-06 — Plan written ahead of the 8/11 dev start. — Claude

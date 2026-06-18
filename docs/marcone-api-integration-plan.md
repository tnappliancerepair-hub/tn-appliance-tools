# Marcone API — Integration Plan

**Date:** 2026-06-18
**Status:** Pre-integration (API access meeting pending)
**Owner:** Teddy / Ant

The goal: replace the brittle authenticated-browser Marcone path with a clean
REST API, and wire Marcone parts data into the three places Ant already needs it
— **lookup, ordering, and tracking** — so the parts loop runs itself.

---

## 1. What this replaces / why

Today Ant gets Marcone data through a **live browser session** — `colony-loop/parts/serve.js`
keeps a "Chrome for Testing" window logged into Marcone, and `parts-lookup-direct.js`
proxies to it over a Cloudflare tunnel. It works, but it's fragile:
- the session expires when the browser closes → manual re-login,
- the Mac + tunnel must stay up,
- selectors break when Marcone changes their HTML.

A real **API** kills all of that: reliable, no daemon, no tunnel, no scraping.
(We keep the daemon for **Amazon/Tribles/MSA** until those have APIs too — this
plan is Marcone-only.)

---

## 2. The three data flows (where Marcone plugs into Ant)

| Flow | Marcone API gives us | Plugs into | Payoff |
|---|---|---|---|
| **A. Lookup** | part # by model, **OUR cost**, live stock qty, ETA, supersessions | cash-TDR 4 options (`qc_diagnosis_view`), Teddy-Tool "🔍 Auto-find parts", general parts search | accurate price/availability instantly, no guessing |
| **B. Order** | place order, **ship-to-customer (blind/dropship)**, returns order # | To-Order board (`parts-orders.html`), cash-TDR auto-order on payment | one-tap order, part ships straight to the customer |
| **C. Track** | order status + tracking + delivery ETA | `parts_orders` ledger → auto-set `parts_eta_date` → flip job to ready-to-schedule | **this is Danielle's parts-chase, automated** — Ant asks the API "where's the part?" instead of her emailing |

**Flow C is the big one for the office** — it turns the manual "email 12 vendors
for status" grind into an automatic poll.

---

## 3. Architecture (mirrors what we just did for Digits)

- **`netlify/functions/_lib/marcone.js`** — the API client (auth + `lookup()`,
  `placeOrder()`, `orderStatus()`), same shape as `_lib/digits.js` / `_lib/amazon-business.js`.
- **Creds in the VAULT** — Marcone API key / OAuth creds go in the Xano `app_config`
  vault via `admin-secrets.html` (the exact pattern that just unblocked Digits past
  the 4KB Netlify wall). Read with `getSecret`/`getSecretPreferVault`. No env limits.
- **Netlify wrappers** — `marcone-lookup.js`, `marcone-order.js`, `marcone-track.js`
  (or fold into the existing `parts-lookup-direct.js` / `create-parts-order.js` with
  a Marcone branch). The existing front-ends (cash-TDR, Teddy Tool, To-Order board)
  call these instead of the daemon.
- **Tracking poll** — a scheduled function (`netlify.toml` cron, like the existing
  pollers) walks `parts_orders` in `awaiting_parts`, calls `orderStatus()`, updates
  `parts_eta_date`, and flips the job when it ships.

---

## 4. Implementation phases (lowest-risk first)

- **Phase 1 — Lookup (week 1).** Wire `marcone.lookup(model/part#)` → real cost +
  stock + ETA into the cash-TDR options and the Teddy-Tool auto-find. Immediate
  accuracy win; replaces the daemon's Marcone lookup. Validate against a few known
  models (e.g. WTW5000DW1).
- **Phase 2 — Ordering (week 1–2).** Wire `placeOrder(ship_to_customer)` into the
  To-Order board's "Order via Marcone" button + the cash-TDR auto-order on payment.
  Start in the API's TEST/sandbox mode, then go live.
- **Phase 3 — Tracking (week 2) — the office win.** Scheduled poll → auto-update
  `parts_eta_date` + ready-to-schedule flip. Replaces Danielle's manual chase.
- **Phase 4 — AI Search (if exposed).** If Marcone's "AI Search" troubleshooting
  tool has an API endpoint, fold it into Ant Diagnose alongside our fault-code DB
  + MSA intel. (Confirm in the meeting whether it's API or portal-only.)

---

## 5. What the meeting needs to nail down (gate to Phase 1)

1. **API docs** — get them sent (this is the whole unlock).
2. **Auth method** — API key vs OAuth2? (Either is fine; key → straight in the vault.)
3. **Sandbox/test env** — or do we test against live with a test account?
4. **Our Marcone account #** — confirm it (seen on the portal) so pricing = our cost.
5. **Scope of API access** — lookup only, or **ordering + dropship** too? (We want all three flows.)
6. **Rate limits.**
7. **AI Search** — is it an API endpoint or portal-only?
8. **Timeline** to get credentials issued.

**"Who's your IT team?"** → *"Custom in-house platform (Ant) — serverless on
Netlify + Xano, REST/JSON. I handle the integration directly."* You're a software
platform sending them more orders through their API — that's the customer they want.

---

## 6. Day-1-after-credentials checklist

1. Drop the Marcone API key/creds into the **vault** via `admin-secrets.html`.
2. Build `_lib/marcone.js` from their docs (auth + lookup first).
3. `marcone-lookup.js` → test against a known model, confirm cost/stock match the portal.
4. Point the cash-TDR + Teddy-Tool auto-find at it (behind a flag; daemon stays as fallback).
5. Then Phase 2 (order) + Phase 3 (track).

The vault + the existing parts surfaces mean **once the key lands, Phase 1 is a same-day wire-up.**

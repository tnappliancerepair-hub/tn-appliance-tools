# AHS / Frontdoor API — what we actually need (re-run from scratch, 2026-09-15)

Teddy asked to start the API process over and take nothing from the earlier attempts on
faith. Did that — hosts, auth, identity, then the path map — and **the answer changed.**

## ❌ The old ask was wrong
We have been chasing a **sandbox config ticket** to link our key and issue a routing-id.
That was the wrong target on two counts:

1. **The sandbox API gateway is EMPTY.** Every path on `api.sandbox.frontdoorhome.com`
   returns 404 — including a control path under a known prefix. Nothing is deployed there.
   **That is the entire source of the 404s we have chased since June.** There is nothing to
   configure in sandbox because there is nothing there.
2. **There is no routing-id.** Routing is by **prefix**, and `/ahs`, `/ftdr` and our org-id
   all 404 as unknown prefixes on production. The routing-id theory is dead.

## ✅ What is actually true (measured, `frontdoor-rerun`)

| step | result |
|---|---|
| **auth** | Sandbox password-grant **mints fine**. Token `introspect` → **`active: true`**. Auth has never been the problem. |
| **both production token URLs** | `invalid_client` — **our key is sandbox-only**. |
| **scopes the IdP can issue** | only `openid, offline_access, email, phone, profile`. **No dispatch/contractor scope exists to request** — we are not under-asking. |
| **roles on every token** | `["external-partner"]`, nothing more. |
| **sandbox gateway** | **zero routes.** Unknown-prefix control 404s *and* known-prefix control 404s. |
| **production gateway** | **routing is by prefix** (unknown prefix 404s, nonsense sub-path under a known prefix 401s). |
| **live + JWT-gated prefixes on production** | **`/dispatch-connector`** · `/address` · `/dtc` · `/real-estate` |
| **our token against production** | `401 — "Jwt issuer is not configured"` |

**Read: the dispatch service is real, it is on production, and it is at the prefix we already
coded. It rejects us for exactly one reason — our token is issued by the sandbox issuer,
which production does not trust. We need a PRODUCTION API key.**

⚠️ One honest limit: a 401 proves the **prefix** is live, not the exact sub-path
`/v1/webhook`. Only a token production trusts settles that. Everything else is confirmed.

## ⏭️ THE ASK — a production API key (not a sandbox ticket)

**Who:** your Frontdoor **BD rep** and **`partnerapiadmin@frontdoorhome.com`** (cc Brian
Bullock, Brian.Bullock@ahs.com). Per Frontdoor's own FAQ, production access has exactly one
path: the BD rep.

**Where the key is generated:** developer portal → *Your API key* → **Add API Key**, with the
environment set to **Production** (ClientId is environment-specific — the sandbox one will
never work against production).

### Paste this

> We are an AHS appliance contractor (TN Appliance Exchange LLC) building an automated
> job-status integration so our technicians' status and notes post to the contractor portal
> without anyone retyping them.
>
> Our **sandbox** API key authenticates correctly — the token mints and introspects as
> active, and identifies our organisation. But the sandbox API gateway returns 404 on every
> path we try, including the service root, so there is nothing reachable to test against.
>
> Against **production** (`api.frontdoorhome.com`) the `/dispatch-connector` service does
> respond — it returns `401 "Jwt issuer is not configured"`, which we read as production
> correctly not trusting a sandbox-issued token.
>
> Could you please:
> 1. Issue us a **Production API key** for this integration, and
> 2. Grant it access to the **Dispatch Status Update / dispatch-connector** surface, and
> 3. Confirm the exact endpoint path and payload for posting a dispatch status + note.
>
> Our AHS vendor IDs are **839828** (Middle TN), **822418** (North Shore, LA) and
> **822218** (South Shore, LA).

### Our identifiers (share freely — these are not secrets)
| field | value |
|---|---|
| Portal account email | `tnappliancerepair@gmail.com` |
| Organisation | `TN Appliance Exchange LLC` |
| Sandbox ClientId | `040c014f-06e5-4697-a336-137dfa942128` |
| Sandbox Username | `697f8d99-f790-47d8-ba49-6e5f1ae77c36` |
| Org ID | `3d640f2f-4747-475a-8ef0-d039b0c7897c` |
| Developer ID | `6d345b45-9a7b-4afb-99ee-9d4d69c33370` |

🔒 **Never send the API key password.** It lives in the vault as `FRONTDOOR_API_PASSWORD` and
Frontdoor does not need it.

## ✅ What flips the day a production key lands
Everything downstream is built and already running — **`frontdoor_push_shadow` = 100 events
in 90 days.** On-my-way → EN_ROUTE, start → IN_PROGRESS, complete → COMPLETE with the
composed TDR note all fire on every AHS job today; they just log instead of sending.

1. Vault `FRONTDOOR_CLIENT_ID` / `FRONTDOOR_API_USERNAME` / `FRONTDOOR_API_PASSWORD` with the
   **production** values, and set **`FRONTDOOR_ENV=production`**.
2. `frontdoor-rerun?secret=…&step=paths&host=https://api.frontdoorhome.com` — the 401 should
   become a 400/422/200. **A 400 is a win** (auth accepted, body argued with).
3. Flip **`FRONTDOOR_PUSH_LIVE=1`** and the shadow becomes real pushes.

`frontdoor-auth-watch` now probes **production** (it used to watch the empty sandbox gateway,
so it would have waited forever) and reports `issuer_not_trusted` until that key exists.

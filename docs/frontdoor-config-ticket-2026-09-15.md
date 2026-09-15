# Frontdoor / AHS — the config ticket to file (2026-09-15)

**This is the one thing standing between us and killing Danielle's manual portal updating.**
Not production access. Not Brian's dev team. The config ticket — step 2 of Frontdoor's own
Getting Started — which links our API key to our contractor account and issues the routing-id.

## How we know (probed live, not assumed)
`frontdoor-probe?secret=<admin>` decoded our own JWT and walked every candidate path:

| evidence | reading |
|---|---|
| token mints, 200, `org_name: "tn appliance exchange llc"`, `dev_email: tnappliancerepair@gmail.com` | the key is real and correctly ours — **auth is not the problem** |
| `roles: ["external-partner"]` and nothing else | generic developer-portal role. **No contractor/dispatch scope, no routing-id, no OfficeIds** |
| dispatch-connector · case-lifecycle · address API · `/health` · bare `/` → **all 404** | the gateway has **no routes provisioned for this key** |
| `api.sandbox.frontdoorhome.com` resolves and answers "Not Found" | the host is right — we are knocking on a real door with no rooms behind it |

A valid key + zero routes + only the generic role is exactly what an unprocessed config
ticket looks like.

⚠️ The long-standing note that we were "403, waiting on Frontdoor" was **stale since at least
2026-08-12** — it has been 404 that whole time, and the watcher that was supposed to tell us
was mis-reading 404 as success (fixed same day).

## File it here
**https://ftdr-developer.atlassian.net/servicedesk/customer/portal/3/group/11/create/53**
(and CC/email **partnerapiadmin@frontdoorhome.com**, plus Brian Bullock — Brian.Bullock@ahs.com)

## Paste these values

| field | value |
|---|---|
| Portal account email | `tnappliancerepair@gmail.com` |
| Organisation name | `TN Appliance Exchange LLC` |
| API Key **ClientID** | `040c014f-06e5-4697-a336-137dfa942128` |
| API Key **Username** | `697f8d99-f790-47d8-ba49-6e5f1ae77c36` |
| Environment | **Sandbox** (then Production) |
| Org ID | `3d640f2f-4747-475a-8ef0-d039b0c7897c` |
| Developer ID | `6d345b45-9a7b-4afb-99ee-9d4d69c33370` |

🔒 **The API key PASSWORD is never included** — not in the ticket, not in email. They don't need
it; it's in our vault as `FRONTDOOR_API_PASSWORD`.

## The ask (paste as the ticket body)

> Our API key authenticates successfully against the sandbox FusionAuth endpoint and the token
> correctly identifies our organisation, but the key appears to have no APIs linked to it — every
> path we call returns 404, including the service root. The token carries only the
> `external-partner` role with no routing-id.
>
> Could you please:
> 1. Link this API key to our ProConnect contractor account, and
> 2. Enable the dispatch status/note surface for it — Case-Lifecycle
>    (`/v1/case-lifecycle/dispatch_status_update`) and/or the dispatch-connector webhook, and
> 3. Confirm the routing-id segment our URLs should use.
>
> We are an AHS appliance contractor. Our AHS vendor IDs are **822418** (North Shore, LA),
> **822218** (South Shore, LA) and **839828** (Middle TN). The goal is to push job status and
> technician notes automatically instead of updating the contractor portal by hand.

## What happens the moment they answer
Everything below it is already built and has been running in shadow:
- `frontdoor_push_shadow` — **100 events in the last 90 days.** The lifecycle wiring (on-my-way →
  EN_ROUTE, start → IN_PROGRESS, complete → COMPLETE + the composed TDR note) already fires on
  every AHS job; it just logs instead of sending.
- Flip vault **`FRONTDOOR_PUSH_LIVE=1`** and the shadow becomes real pushes.
- If they hand back a routing-id, vault it as **`FRONTDOOR_ROUTING_ID`** — the connector already
  prefixes it (`caseLifecycleStatusUpdate`) and the probe already tests both shapes.
- Re-run `frontdoor-probe?secret=<admin>` to confirm; a **400/422 is a PASS** (endpoint took our
  auth and only argued with the body). `frontdoor-auth-watch` will text once it goes genuinely
  reachable.

# API follow-up nudges — 2026-06-29 (Teddy sends from the matching inbox)

Two APIs are sitting un-replied. Short, specific follow-ups below — ready to send.
Keep them brief; we're just asking for a status + the one action each side owes us.

---

## 1. Amazon Business Ordering API — production authorization
**State:** Sandbox auth is proven (token acquired, env=sandbox, ordering endpoint +
schema validated). We're blocked only on **production app authorization** for our
Solution Provider Portal app (under tnappliance@gmail.com, buyer acct A-22A7N0U5ZWQ5H).
**Send to:** the Amazon Business API advisor / SP-API support case you opened (reply on
that thread; if none, open a case at the SP-API/Business API support console).

> Subject: Production authorization status — TN Appliance Exchange (Business Ordering API)
>
> Hello,
>
> Following up on our Amazon Business Ordering API application. Our **sandbox**
> integration is complete and tested — we successfully acquire LWA tokens and reach
> the Ordering API with the documented request schema. We're ready to go live and are
> only waiting on **production application authorization** for our Solution Provider
> Portal app (Amazon Business account A-22A7N0U5ZWQ5H, tnappliance@gmail.com).
>
> Could you tell me the current status and what, if anything, you still need from us
> to authorize the production app? We're a single appliance-repair business ordering
> our own replacement parts to ship to our customers — not a reseller.
>
> Thank you,
> James "Teddy" Pivacek — TN Appliance Exchange LLC

---

## 2. Frontdoor / AHS Partner API — authorize sandbox key + production access
**State:** Developer-portal sandbox key generated and **auth verified** (we mint a JWT,
200). But the **Dispatch Status Update endpoint returns 403** — the sandbox key isn't
authorized for the `dispatch-connector` scope yet. You emailed partnerapiadmin on ~6/25;
no reply. This is a follow-up on that thread.
**Send to:** partnerapiadmin@frontdoorhome.com (cc your BD rep "Ben" if you have him).

> Subject: Follow-up — authorize sandbox key for dispatch-connector + production access (TN Appliance Exchange, vendor TNA00001)
>
> Hi,
>
> Following up on my note from last week. Our Frontdoor Partner API integration is
> built and authenticating cleanly against the sandbox (we mint a JWT successfully),
> but calls to the **Dispatch Status Update** endpoint (`/dispatch-connector/v1/webhook`)
> return **403 Forbidden** — it looks like our sandbox key isn't yet authorized for the
> dispatch-connector scope.
>
> Could you please:
> 1. **Authorize our sandbox key** for the dispatch-connector endpoint so we can finish
>    testing status + note pushes, and
> 2. Let me know the path to **production access** for live AHS dispatches.
>
> Account / vendor ID: **TNA00001**. Portal email: tnappliancerepair@gmail.com. Happy to
> send our key username + client ID on a secure channel if that helps link it.
>
> The goal is to push job status and notes straight into the contractor portal so our
> office stops updating it by hand. Appreciate your help.
>
> Thanks,
> James "Teddy" Pivacek — TN Appliance Exchange LLC

---

### Notes
- Both are **build-ready** — nothing blocks our side; we're only waiting on their grant.
- Watchers are armed (`amazon-api-watch`, `vendor-api-watch`) and will flag the replies.
- Don't include phone/secrets in the email bodies; offer key IDs on a secure channel only.

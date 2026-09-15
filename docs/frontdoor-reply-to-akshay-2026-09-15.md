# Frontdoor / AHS — follow-up nudge to Akshay (2026-09-15)

## Where this actually stands
**Teddy already answered correctly on 2026-09-08.** That reply said, in his words:

> *"Inbound (your dispatches → us): working… Outbound (our status push → you): not yet verified.
> Our push authenticates, but posting a status update to `/dispatch-connector/v1/webhook` returns
> a 404 — so we're pointed at the wrong endpoint."*

…and asked for exactly the two right things: (1) the routing-id / which endpoint our Client ID is
authorized to push to, and (2) production credentials.

**So the ball has been in Frontdoor's court for 7 days.** This is a *nudge*, not a re-ask —
and it carries new diagnostic detail we didn't have on the 8th, which is what makes it worth
sending rather than just bumping the thread.

## What's new since 9/8 (worth telling them)
| finding | why it sharpens the ask |
|---|---|
| `api.sandbox.frontdoorhome.com` returns **404 on every path including its own root** | It isn't a wrong *path* — that whole host has no routes for us. Possibly the sandbox inbound API was never deployed/exposed. |
| On `api.frontdoorhome.com`, `/dispatch-connector` **does** respond — `401 "Jwt issuer is not configured"` | The service is real and live on production; our sandbox token just isn't trusted there. |
| Tested `/{routing-id}` shapes — `/ahs`, `/ftdr`, our org-id — **all 404 as unknown prefixes** | **The routing-id theory is dead.** Don't ask for a routing-id; ask for the base URL. |
| **161 distinct dispatches / 500 events received, latest 9/14** | Turns "inbound is working" into a number they can verify against their own send log. |
| We are now genuinely sending `source: TN_APPLIANCE_EXCHANGE` | ⚠️ On 8/31 we *told* them we were, but the code still had `DISPATCH_ME`. Fixed 9/15. Don't re-state it as though it were always true. |

---

## Draft — reply-all on the existing thread
*To: Akshay.Kyatam@frontdoor.com · Cc: Brian Bullock, Shivam Arora, Vaibhav Parashar, Adarsha Dash, Danny Suarez*
*Subject: (keep) Re: [External] Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates*

> Hi Akshay,
>
> Following up on my note from the 8th — still just need the outbound endpoint to close this out.
>
> **Inbound (Frontdoor → us) is confirmed and steady.** Since we last spoke we've received
> **161 distinct dispatches across 500 events, most recently September 14**. Dispatch
> **22863999** came through 7 times, both the `schedule` and `status` operations. Nothing is
> being dropped — happy to reconcile against your send log any time.
>
> **Outbound (us → Frontdoor) is the one open item**, and I can be more specific than I was
> last week about where it's failing:
>
> - `https://api.sandbox.frontdoorhome.com` returns **404 on every path we try, including the
>   bare service root**. So this doesn't look like us using a wrong path — it looks like there
>   may be no inbound API exposed on that host for us.
> - On `https://api.frontdoorhome.com`, `/dispatch-connector` **does** respond — it returns
>   `401 "Jwt issuer is not configured"`, which reads like production correctly declining a
>   sandbox-issued token.
> - We also tried routing-id-style prefixes (`/ahs`, `/ftdr`, our org id) and they all 404 as
>   unknown prefixes, so I don't think a routing-id is what we're missing.
>
> **So the single thing I need is the base URL + path you want our status updates posted to**
> — plus a sample request body, so we match your schema exactly rather than guess. Our token
> generates and introspects as active, and we're sending `source: TN_APPLIANCE_EXCHANGE` per
> your 8/24 note.
>
> The moment we get a 200 on that push we're clear to proceed to production. We'll send our
> production webhook credentials the same day, and we'd need the production API key/ClientId
> from your side since the sandbox one won't authenticate against production.
>
> Our AHS vendor IDs for reference: **839828** (Middle TN), **822418** (North Shore, LA),
> **822218** (South Shore, LA).
>
> Thanks Akshay — appreciate you staying on this.
>
> James (Teddy) Pivacek
> TN Appliance Exchange LLC

---

## If this gets no reply
Brian Bullock is already cc'd. A one-line direct note to Brian — *"we're one endpoint URL away
from going live, can you help unstick it?"* — is the right escalation, since he owns the
relationship and brought Akshay's team in.

## Our side is ready
- **`frontdoor_push_shadow` = 100 events/90d** — on-my-way→EN_ROUTE, start→IN_PROGRESS,
  complete→COMPLETE with the composed TDR note, all firing, just logging.
- ⛔ **Do NOT flip `FRONTDOOR_WEBHOOK_LIVE=1` yet** — those 161 are *sandbox* dispatches; going
  live now would create 161 junk jobs on the real board. Dark mode is correct until production.
- Go-live order: get a 200 on outbound → swap production creds both directions → then flip.

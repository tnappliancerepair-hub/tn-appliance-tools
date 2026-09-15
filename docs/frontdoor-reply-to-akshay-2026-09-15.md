# Frontdoor / AHS — follow-up to Akshay (drafted 2026-09-15)

## Why this draft is written the way it is

**1. Akshay asked us a direct question three times and we have never answered it.**
His Sept 3 and Sept 8 emails both ask the same thing: *"22863999 is the Dispatch ID
that we sent in the request. Could you please verify whether it was received on your
end?"* We answered around it twice. The answer is **yes**, and we can prove it.

**2. Our Aug 31 email told them the broken direction was working.**
Verbatim, from us: *"Inbound (our system → Frontdoor): Confirmed working. We're
generating a token against the sandbox and reaching your endpoint cleanly now — the
earlier authorization issue is cleared. A test status update currently comes back as
'not found,' which we expect."*

That was wrong. We read a 404 as "dispatch not found" — a pass. Measured
2026-09-15: `api.sandbox.frontdoorhome.com` has **zero routes deployed**. Every path
404s, including a control path that cannot exist by construction. So that 404 never
meant "dispatch not found." It meant "this host serves nothing."

**Consequence: Akshay believes TN → Frontdoor works, because we told him it does.**
He has no reason to go look at it. Until we retract that, he won't.

**3. We inverted his vocabulary on Sept 8.**
Akshay's convention, stated twice in his own words:
- *"the inbound integration (TN App system to Frontdoor)"* → **inbound = us → them**
- *"outbound updates (Frontdoor to your webhook)"* → **outbound = them → us**

Our Aug 31 email matched that. **Our Sept 8 email reversed it** — *"Inbound (your
dispatches → us): working. Outbound (our status push → you): not yet verified …
returns a 404."*

Read in his dictionary, our Sept 8 email says: *"us → you works; **you → us** is
404ing."* He had just watched **you → us** return `{"ok": true, "received": 1}` with
his own eyes. From his side our last email was incoherent. Seven days of silence
follows naturally.

**So this draft drops the words "inbound" and "outbound" entirely** and uses explicit
arrows. There is no version of this thread where those two words help us.

---

## Does Frontdoor only want to SEND, not receive?

**No.** Five independent pieces of evidence, all from their own emails:

1. Subject line they chose: *"Please Verify **Inbound and Outbound** Updates"*
2. Aug 24: *"Please generate a token and verify the inbound integration (your system
   to Frontdoor)."* — that is them asking us to call them.
3. Aug 24: they enabled sandbox access **for our Client ID**. You do not issue a
   partner a client credential so they can receive.
4. Aug 24: *"please use the following value as the source in the request payload
   **when calling our webhook API**: TN_APPLIANCE_EXCHANGE"* — a value that only
   exists for requests we originate.
5. Sept 3 **and** Sept 8: *"Once you confirm that **both** the outbound and inbound
   flows are working as expected, we should be good to proceed with the production
   go-live."*

Two-way is what they built and it is what they are gating go-live on. The blocker is
not permission — it is that the sandbox URL they gave us serves nothing, and they
don't know that yet because we told them it worked.

The draft still asks the question plainly at the end, so that if the answer ever *is*
"contractor status-push isn't available to you," we hear it and stop chasing it.

---

## Verified figures used in the email (re-measured 2026-09-15, uncapped query)

| Figure | Value | Source |
|---|---|---|
| Frontdoor → TN deliveries | **823** | `list_recent_event_log?action=frontdoor_webhook_event&days_back=120&limit=5000` |
| Distinct dispatch IDs | **276** | same |
| Deliveries of 22863999 | **7** | same |
| First delivery | 2026-07-10 7:26 AM CT | same |
| Most recent delivery | 2026-09-14 5:41 PM CT | same |
| Operations seen | status 412 · schedule 399 · notes 5 · ncc 6 | same |

⚠️ An earlier version of this draft said "161 dispatches / 500 events." Those were read
off a query that silently capped at its `limit`. Do not re-use them.

---

## THE EMAIL

**To:** Akshay.Kyatam@frontdoor.com
**Cc:** Brian.Bullock@ahs.com · vaibhav.parashar@frontdoor.com · shivam.arora@frontdoor.com · adarsha.dash@frontdoor.com · jpivacek@gmail.com
**Subject:** Re: [External] Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates

---

Hi Akshay,

Direct answer to your question first, then a correction I owe you.

**Yes — we received dispatch 22863999.** It came through 7 separate times, carrying
both the schedule and status operations, exactly as you described. It is not an
isolated success: since July 10 we have received and logged **823 requests from
Frontdoor covering 276 distinct dispatch IDs** — 399 schedule, 412 status, 5 notes,
6 NCC. The most recent landed yesterday, September 14 at 5:41 PM Central. That
direction has been solid for two months.

They are currently logged rather than written into our live board — that is the
`"mode": "dry_run"` you see in our response. That is a deliberate safety catch on our
side while we're on sandbox, and we flip it the moment we go to production. Nothing
has been lost.

**Now the correction.** On August 31 I told you our side calling yours was confirmed
working. That was wrong, and I'd rather say so plainly than let it sit.

What I had was a 404 from `api.sandbox.frontdoorhome.com`, and I read it as "dispatch
not found" — which would have been a pass. It wasn't. We re-tested this week against a
path we invented that cannot exist on any server, and it returned the same 404. That
host appears to have no routes deployed at all — bare root included. So the 404 was
never about the dispatch. We have never successfully reached you, and I reported
otherwise. Apologies for sending you down the wrong road on that.

Here is exactly where we are:

**Frontdoor → TN Appliance:** ✅ working. 823 requests, 276 dispatches, since July 10.

**TN Appliance → Frontdoor:** ❌ not working. Two specific findings:

1. **`api.sandbox.frontdoorhome.com` returns 404 for every path we try**, including a
   deliberately nonsensical control path. That reads like nothing is deployed there,
   rather than like we're using the wrong URL.

2. **On `api.frontdoorhome.com`, `/dispatch-connector` is live but rejects our token**
   with `401 — "Jwt issuer is not configured"`. Our key mints a token fine against
   `frontdoorhome-dev.fusionauth.io`, and that token introspects as active — but
   production doesn't trust that issuer, which is what we'd expect from a sandbox-only
   credential. `login.frontdoorhome.com/oauth2/token` returns `invalid_client` for us.

Reading those together, it looks like we have a sandbox credential and no working
sandbox host to use it against. But you're much better placed to say than I am.

**What would unblock us — any one of these:**

- A base URL for the sandbox that is actually serving, if `api.sandbox.frontdoorhome.com`
  isn't the right one; **or**
- A production credential for Client ID `040c014f-06e5-4697-a336-137dfa942128`, so we
  can authenticate against `api.frontdoorhome.com` where `/dispatch-connector` is
  clearly alive; **and**
- The exact path and payload shape you expect for a status update. We've been posting
  to `/dispatch-connector/v1/webhook` with `source: TN_APPLIANCE_EXCHANGE` per your
  Aug 24 note — if that's the wrong path, the right one is all we need.

If it's easier, a single successful request/response pair from your side — any dispatch,
any status — tells us everything.

**One plain question so we're not chasing something that isn't there:** is contractor
status-push available to us at all on this integration, or is Frontdoor → TN the only
direction on offer today? Either answer is workable. We just want to stop guessing.

For the production webhook: it is the same URL and the same token you already have, and
it's live now. We can rotate to a fresh production token on your word, same day.

Once we get a 200 on a status update from our side, we're clear to go.

Thank you,

James (Teddy) Pivacek
TN Appliance Exchange LLC
866-268-0111
https://tnapplianceexchange.net

---

## Send notes

- **Reply into the existing thread**, don't start a new one. Akshay's Sept 8 message is
  the last one on it.
- **Do not paste the webhook token value.** Akshay sent it in the clear on Aug 24; we
  don't need to repeat it. The Client ID is an identifier and is already in the thread.
- **Do not include Teddy's cell.** 866-268-0111 is the published line.
- If there's still no answer by ~Sept 22, the escalation path is Brian Bullock
  (Brian.Bullock@ahs.com) — he's on the Cc and owns the relationship, and the ask
  becomes "can someone confirm whether the sandbox host is deployed."

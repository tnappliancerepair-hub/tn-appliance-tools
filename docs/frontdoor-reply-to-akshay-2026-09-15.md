# Frontdoor / AHS — follow-up to Akshay (drafted 2026-09-15, triple-verified)

> Every factual claim below was re-verified on 2026-09-15 against a live source — the
> emails re-pulled from Gmail, the numbers re-queried uncapped, the API re-probed.
> The verification pass found **five errors in the first draft** and they are corrected
> here. See "What the verification changed" at the bottom.

## Why this draft is written the way it is

**1. Akshay asked us a direct question twice and we have never answered it.**
Sept 3 and Sept 8 both ask the same thing: *"22863999 is the Dispatch ID that we sent in
the request. Could you please verify whether it was received on your end?"* We answered
around it twice. The answer is **yes**, and we can prove it to the second.

**2. Our Aug 31 email told them the broken direction was working.** Verbatim, from us:

> *"Inbound (our system → Frontdoor): Confirmed working. We're generating a token against
> the sandbox and reaching your endpoint cleanly now — the earlier authorization issue is
> cleared. A test status update currently comes back as "not found," which we expect, since
> we don't yet have a live sandbox dispatch to reference"*

That was wrong. We read a 404 as "dispatch not found" — a pass. It wasn't (proof below).
**Consequence: Akshay believes TN → Frontdoor works, because we told him it does.** He has
no reason to go look at it. Until we retract that, he won't.

**3. We inverted his vocabulary on Sept 8.** Akshay's convention, his own words, both
directions, confirmed verbatim:

- *"Please generate a token and verify the inbound integration (your system to Frontdoor)"* → **inbound = us → them**
- *"we have started sending outbound updates (Frontdoor to your webhook)"* → **outbound = them → us**

Our Aug 31 email matched it. **Our Sept 8 email reversed it** — *"Inbound (your dispatches
→ us): working. Outbound (our status push → you): not yet verified … returns a 404."*

Read in his dictionary, our Sept 8 email says *"us → you works; **you → us** is 404ing"* —
the exact direction he had just watched return `{"ok":true,"received":1}` with his own eyes.
From his side our last email was incoherent. Seven days of silence follows naturally.

**So this draft drops the words "inbound" and "outbound" entirely** and uses arrows. There
is no version of this thread where those two words help us.

---

## Does Frontdoor only want to SEND, not receive?

**No.** Five pieces of evidence, every one re-pulled from their emails today:

1. The subject line they chose: *"Sandbox Integration Ready for Testing – Please Verify **Inbound and Outbound** Updates"*
2. Aug 24: *"Please generate a token and verify the inbound integration (your system to Frontdoor)."* — them asking us to call them.
3. Aug 24: *"We have enabled sandbox access for the Client ID (040c014f-06e5-4697-a336-137dfa942128) you provided."* You do not issue a partner a client credential so they can receive.
4. Aug 24: *"Regarding the inbound integration (TN App system to Frontdoor), please use the following value as the source in the request payload when calling our webhook API: TN_APPLIANCE_EXCHANGE"* — a value that only exists for requests we originate.
5. Sept 3 **and** Sept 8: *"Once you confirm that **both** the outbound and inbound flows are working as expected, we should be good to proceed with the production go-live."*

Two-way is what they built and it is what they are gating go-live on. The blocker is not
permission — and it is not that their sandbox is switched off (it isn't; see below). It is
that we have never actually reached them, and we told them we had.

The draft still asks the question plainly at the end, so if the answer ever *is* "contractor
status-push isn't available to you," we hear it and stop chasing it.

---

## Verified figures (re-measured 2026-09-15, live + uncapped)

`list_recent_event_log?action=frontdoor_webhook_event&days_back=120&limit=5000`
→ `count: 823` and `len(items): 823` **— confirmed not capped.**

| Figure | Value |
|---|---|
| Events logged from Frontdoor | **823** |
| Distinct after de-duplicating their retries | **637** |
| Distinct dispatch IDs | **276** |
| Dispatch IDs carrying a `schedule` op | **270 of 276** |
| Log entries for 22863999 | **7** (4 schedule + 3 status) → **3 distinct payloads** |
| First delivery | 2026-07-10 7:26 AM CT |
| Most recent delivery | 2026-09-14 5:41 PM CT |
| Ops, raw | status 412 · schedule 399 · ncc 6 · notes 5 · unparsed 1 |
| Ops, de-duplicated | status 357 · schedule 270 · notes 5 · ncc 4 · unparsed 1 |

⚠️ **"823 requests" is the wrong noun** — Frontdoor POSTs an array and our webhook writes one
row per *event*, so 823 is events, not HTTP requests. The email says "events".
⚠️ An older note said "161 dispatches / 500 events." Those came off a silently-capped query.
Do not re-use them.

## Verified API state (re-probed 2026-09-15)

Unauthenticated control pair, run against **both** hosts, identical results:

| path | sandbox | production |
|---|---|---|
| `/` · `/health` · `/zzz-cannot-exist/control` | 404 `Not Found` | 404 `Not Found` |
| `/dispatch-connector/v1/webhook` | **403 `RBAC: access denied`** | **403 `RBAC: access denied`** |
| `/dispatch-connector/zzz-nonsense-subpath` | **403 `RBAC: access denied`** | **403 `RBAC: access denied`** |
| `/address/v1/zip` | **403 `RBAC: access denied`** | **403 `RBAC: access denied`** |
| `/v1/case-lifecycle/dispatch_status_update` | 404 `Not Found` | 404 `Not Found` |

**→ `/dispatch-connector` IS a routed prefix on the sandbox host. The sandbox gateway is NOT
empty.** The gateway routes by prefix: unknown prefix → 404 with a `Not Found` body; known
prefix → 403 RBAC before it ever looks at the sub-path.

With **our sandbox token** (`roles: ["external-partner"]`):

| path | sandbox | production |
|---|---|---|
| `/dispatch-connector/v1/webhook` | **404, empty body** | **401 `Jwt issuer is not configured`** |
| `/dispatch-connector/dispatch-connector/v1/webhook` *(cannot exist)* | **404, empty body** | — |
| `/dispatch-connector/v1/health` | **404, empty body** | **401 `Jwt issuer is not configured`** |
| `/address/v1/zip` | **404, empty body** | **401 `Jwt issuer is not configured`** |
| `/` · `/health` | 404 `Not Found` | 404 `Not Found` |

**→ The control path that cannot exist returns the SAME empty 404 as the real one.** So the
sandbox 404 means "no route matched," not "dispatch not found." That is the retraction,
properly proven this time.

Token state: sandbox mints fine (`frontdoorhome-dev.fusionauth.io`, HTTP 200).
Production returns `invalid_client — "client_id: 040c014f-06e5-4697-a336-137dfa942128 is not valid."`

---

## THE EMAIL

**To:** Akshay.Kyatam@frontdoor.com
**Cc:** reply-all on the existing thread (Brian Bullock · Vaibhav Parashar · Shivam Arora · Adarsha Dash · Danny Suarez · jpoivacek@gmail.com)
**Subject:** Re: [External] Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates

---

Hi Akshay,

Direct answer to your question first, then a correction I owe you.

**Yes — we received dispatch 22863999.** It's in our log 7 times, which de-duplicates to
three payloads you sent: the schedule (September 3 at 6:16 AM Central, re-sent September 5),
and two status updates, codes 250 and 30. Nothing was dropped.

It is not an isolated success. Since July 10 we have received and logged **823 events from
Frontdoor — 637 distinct once your retries are collapsed — across 276 dispatch IDs.** The
most recent landed yesterday, September 14 at 5:41 PM Central. That direction has been solid
for two months.

They're being logged rather than written into our live board — that's the `"mode": "dry_run"`
you saw in our response. That's a deliberate safety catch on our side while we're on sandbox,
and we lift it the moment we go to production. Nothing has been lost.

**Now the correction.** On August 31 I told you our side calling yours was confirmed working.
That was wrong, and I'd rather say so plainly than let it sit.

What I had was a 404 from `api.sandbox.frontdoorhome.com`, and I read it as "dispatch not
found" — which would have been a pass. This week I re-tested it properly. I made up a path
that cannot exist on any server — `/dispatch-connector/dispatch-connector/v1/webhook` — and it
returned the identical 404, byte for byte. So the 404 was never about the dispatch. We have
never successfully reached you, and I reported otherwise. Apologies for sending you down the
wrong road on that.

Here's exactly where we are:

**Frontdoor → TN Appliance:** ✅ working. 823 events, 276 dispatches, since July 10.

**TN Appliance → Frontdoor:** ❌ not working. Two specific findings, and I'd rather give you
the raw observations than my interpretation of them:

1. **On `api.sandbox.frontdoorhome.com`, our token gets past your access-control layer but
   then finds no route.** An unauthenticated request to `/dispatch-connector/v1/webhook` is
   refused with `403 — "RBAC: access denied"`, so the prefix is clearly routed. Ours isn't
   refused — it returns an empty-bodied `404` instead, and so does every other path under
   that prefix, including the invented one above.

2. **On `api.frontdoorhome.com`, `/dispatch-connector` is alive but rejects our token** with
   `401 — "Jwt issuer is not configured"`. Our key mints a token fine against
   `frontdoorhome-dev.fusionauth.io`; production just doesn't trust that issuer, which is
   what we'd expect from a sandbox-only credential.
   `login.frontdoorhome.com/oauth2/token` returns `invalid_client` for us.

Read together, it looks like we have a sandbox credential that authenticates against the
sandbox gateway but finds no matching route there, and a production gateway that has the
route but won't accept a sandbox-issued token. You're much better placed to say than I am.

**What would unblock us — any one of these:**

- **The exact path and method** you expect a status update on in sandbox. We've been POSTing
  to `/dispatch-connector/v1/webhook` with `source: TN_APPLIANCE_EXCHANGE` per your Aug 24
  note. If that's the wrong path, the right one is all we need; **or**
- **A production credential for Client ID `040c014f-06e5-4697-a336-137dfa942128`**, so we can
  authenticate against `api.frontdoorhome.com` where `/dispatch-connector` is clearly alive; **or**
- **One successful request/response pair from your side** — any dispatch, any status. That
  tells us everything in one shot.

**One plain question so we're not chasing something that isn't there:** is contractor
status-push available to us at all on this integration, or is Frontdoor → TN the only
direction on offer today? Either answer is workable. We just want to stop guessing.

For the production webhook: it's the same URL and the same token you already have, and it's
live now. We can rotate to a fresh production token on your word, same day.

Once we get a 200 on a status update from our side, we're clear to go.

Thank you,

James (Teddy) Pivacek
TN Appliance Exchange LLC
866-268-0111
https://tnapplianceexchange.net

---

## Send notes

- **Reply-all into the existing thread**, don't start a new one. ⚠️ **Our Sept 8 reply is the
  last message on the thread** (Sept 8, 10:46 AM CT) — Akshay's follow-up came in at 2:35 AM CT
  that morning and we answered it the same day. So this is us following up on our own last
  message, not on his.
- ⚠️ **The thread's Cc carries `jpoivacek@gmail.com` — a typo** (Teddy's address is
  `jpivacek@gmail.com`, no "o"). Reply-all will propagate the typo. Fix it in the Cc line if
  you want Teddy's personal inbox copied. **Danny Suarez** is also on the thread Cc.
- **Do not paste the webhook token value.** Akshay sent it in the clear on Aug 24; we don't
  need to repeat it. The Client ID is an identifier and is already in the thread.
- **Do not include Teddy's cell.** 866-268-0111 is the published line.
- If there's still no answer by ~Sept 22, escalate to Brian Bullock (Brian.Bullock@ahs.com) —
  he's on the Cc and owns the relationship. The ask becomes: "can someone confirm which path
  our sandbox key is meant to POST a status update to."

---

## What the verification changed

The first draft was wrong in five places. Each was caught by re-checking against a live
source rather than the prior session's notes.

| # | First draft said | Verified truth | Why it mattered |
|---|---|---|---|
| 1 | Sandbox host "has no routes deployed at all — bare root included" | `/dispatch-connector` **is** routed there — unauthenticated requests get `403 RBAC`, not 404. Only unrouted prefixes 404. | **This was the big one.** It would have been a second false technical claim inside the email whose whole purpose is retracting the first one — and Akshay could disprove it in ten seconds. |
| 2 | "It came through **7 separate times**" | 7 log entries = **3 distinct payloads** (schedule ×1 re-sent, status ×2) | He knows what he sent. Overstating it invites a third correction. |
| 3 | "823 **requests**" | 823 **events**; Frontdoor POSTs arrays and we log per event. 637 distinct after retries. | Wrong noun, and he can see his own send count. |
| 4 | "Akshay's Sept 8 message is the last one on the thread" | **Our** Sept 8 reply is last (10:46 AM CT vs his 2:35 AM CT) | Changes the framing from "chasing him" to "following up on our own note." |
| 5 | Cc list omitted Danny Suarez; didn't flag the `jpoivacek@` typo | Both confirmed on-thread | Teddy's personal copy silently doesn't arrive. |

**Confirmed correct and unchanged:** all five two-way proofs (verbatim) · the Aug 31
"Confirmed working" quote (verbatim) · Akshay's inbound/outbound convention in both
directions (verbatim) · our Sept 8 inversion (verbatim) · 276 distinct dispatch IDs · 7 log
entries for 22863999 · the 2026-07-10 → 2026-09-14 range · the raw ops split · production
`401 "Jwt issuer is not configured"` (verbatim) · `invalid_client` on
`login.frontdoorhome.com` · sandbox token mints · `source: TN_APPLIANCE_EXCHANGE` in the
shipped code · Client ID · 270 of 276 dispatch IDs carry a `schedule` op (the junk-job risk
that keeps `FRONTDOOR_WEBHOOK_LIVE` off).

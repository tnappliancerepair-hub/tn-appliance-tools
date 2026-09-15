# Frontdoor / AHS — follow-up to Akshay (drafted 2026-09-15, triple-verified)

> Every factual claim below was re-verified on 2026-09-15 against a live source — the
> emails re-pulled from Gmail, the numbers re-queried uncapped, the API re-probed, and
> the outbox checked against `in:sent`. The verification pass found **six errors in the
> first draft**, one of them severe enough to invert the whole email's posture. See
> "What the verification changed" at the bottom.

## 🔴 READ THIS FIRST — the ball has been in OUR court since Aug 31, not theirs

**Our September 8 reply was never sent to Akshay.** Neither was our September 3 one. Both
were sent to `jpivacek@gmail.com` — Teddy's own personal address — not to Frontdoor.

Confirmed three independent ways on 2026-09-15:

1. Thread view: every message from us after Aug 31 carries `To: james pivacek <jpivacek@gmail.com>`, empty Cc.
2. `in:sent subject:"Verify Inbound and Outbound Updates" newer_than:45d` → 4 sends, **all** to `jpivacek@`. Only the **Aug 31** message has `To: Akshay Kyatam`.
3. `from:tnappliancerepair@gmail.com to/cc:Akshay.Kyatam@frontdoor.com after:2026/09/01` → **count: 0.**

### What the thread actually looks like from Akshay's side

| when (CT) | who | what |
|---|---|---|
| Aug 24 9:12 AM · 9:33 AM | **Akshay** | Sandbox enabled for our Client ID; webhook URL + token; use `source: TN_APPLIANCE_EXCHANGE` |
| **Aug 31 9:47 AM** | **US** | *"Inbound (our system → Frontdoor): **Confirmed working**"* ← the false claim, and **the last thing he ever heard from us** |
| Sep 3 9:51 AM | **Akshay** | Follow-up #1 — *"we have already started sending outbound requests… 22863999 is the Dispatch ID we sent. Could you please verify whether it was received on your end?"* |
| Sep 8 2:35 AM | **Akshay** | Follow-up #2 — *"Just following up on my previous email regarding the webhook integration testing. Could you please let us know if everything looks good"* |
| Sep 8 10:34 · 10:46 AM | *(us, to ourselves)* | Reply drafted and sent to `jpivacek@gmail.com`. **Never reached Frontdoor.** |

**So: 15 days of OUR silence, and two unanswered follow-ups from him.** Frontdoor is not
stonewalling and never was. The last thing Akshay has from us is an email telling him the
broken direction works — which is exactly why he has no reason to go look at it, and why
his two follow-ups read as "everything good?" rather than "what's broken?"

**This retires the earlier "he went quiet because we inverted his vocabulary" theory.** He
never received the email that inverted it. The reason he went quiet is simpler: **we never
replied.** (The vocabulary rule below still stands for the email we sent — it
just wasn't the cause.)

---

## Why this draft is written the way it is

**1. Akshay asked us a direct question twice and has never received an answer.**
Sept 3 and Sept 8 both ask the same thing: *"22863999 is the Dispatch ID that we sent in
the request. Could you please verify whether it was received on your end?"* The answer is
**yes**, and we can prove it to the second. It leads the email.

**2. Our Aug 31 email told them the broken direction was working.** Verbatim, from us:

> *"Inbound (our system → Frontdoor): Confirmed working. We're generating a token against
> the sandbox and reaching your endpoint cleanly now — the earlier authorization issue is
> cleared. A test status update currently comes back as "not found," which we expect, since
> we don't yet have a live sandbox dispatch to reference"*

That was wrong. We read a 404 as "dispatch not found" — a pass. It wasn't (proof below).
**Consequence: Akshay believes TN → Frontdoor works, because we told him it does, and
nothing has corrected it in 15 days.** Until we retract it, he won't look.

**3. Never use "inbound"/"outbound" with Frontdoor.** Akshay's convention, his own words,
both directions, confirmed verbatim:

- *"Please generate a token and verify the inbound integration (your system to Frontdoor)"* → **inbound = us → them**
- *"we have started sending outbound updates (Frontdoor to your webhook)"* → **outbound = them → us**

That is the opposite of how we use the words internally. **This draft drops both words
entirely and uses arrows.** There is no version of this thread where those two words help us.

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
that we have never actually reached them, we told them we had, and then we stopped replying.

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

## Verified API state (re-probed 2026-09-15, and again immediately before send)

Unauthenticated control pair, run against **both** hosts, identical results:

| path | sandbox | production |
|---|---|---|
| `/` · `/health` · `/zzz-not-a-real-prefix/v1/x` | 404 `Not Found` | 404 `Not Found` |
| `/dispatch-connector/v1/webhook` | **403 `RBAC: access denied`** | **403 `RBAC: access denied`** |
| `/dispatch-connector/dispatch-connector/v1/webhook` | **403 `RBAC: access denied`** | **403 `RBAC: access denied`** |
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
**Cc:** none — **verified 2026-09-15.** Akshay's Sept 3 and Sept 8 messages carry an EMPTY Cc and go only to `tnappliancerepair@gmail.com`, so reply-all reaches him alone. (Brian Bullock, Vaibhav Parashar, Shivam Arora, Adarsha Dash and Danny Suarez appear only inside quoted body text from an older forwarded thread — none of them is a live recipient here.) Leave it that way: this email owns our silence and retracts a false claim, and cc'ing a senior contact on that would read as going over the head of the one person who has been responsive.
**Subject:** Re: [External] Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates

---

Hi Akshay,

I owe you a reply — two, really. You followed up on September 3 and again on September 8 and
got nothing back from me. That's on us, and I'm sorry. Here's the answer to your question,
and then a correction I owe you on something I told you August 31.

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
That was wrong, and I'd rather say so plainly than let it sit — especially since it's been
sitting for two weeks.

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

Once we get a 200 on a status update from our side, we're clear to go. And you'll get a same-day
reply from me from here on.

Thank you,

James (Teddy) Pivacek
TN Appliance Exchange LLC
866-268-0111
https://tnapplianceexchange.net

---

## Send notes

- 🔴 **Reply-all to AKSHAY'S Sept 8, 2:35 AM message** — the last message he actually sent —
  and **confirm `Akshay.Kyatam@frontdoor.com` is in the To: line before you hit send.** The
  last two replies we composed went to `jpivacek@gmail.com` instead of to him and never left
  the building. That is the single reason this thread stalled. Check the To: line.
- ✅ **Cc is empty and should stay empty.** Akshay's last two messages have no Cc at all, so
  reply-all goes to him only — nothing to fix, nothing to strip. (The `jpoivacek@gmail.com`
  typo was on his Aug 24 opener's To: line and has not been on the thread since.)
- **Do not paste the webhook token value.** Akshay sent it in the clear on Aug 24; we don't
  need to repeat it. The Client ID is an identifier and is already in the thread.
- **Do not include Teddy's cell.** 866-268-0111 is the published line.
- **After sending, verify it sent** — open Sent and confirm the To: line. Don't assume.
- If there's still no answer by ~Sept 22, escalate to Brian Bullock (Brian.Bullock@ahs.com) —
  he owns the relationship, but he is **not** on this thread, so that is a NEW email, not a
  reply-all. The ask becomes: "can someone confirm which path our sandbox key is meant to POST
  a status update to."

---

## What the verification changed

The first draft was wrong in seven places. Each was caught by re-checking against a live
source rather than the prior session's notes. #7 was caught in the final pre-send pass, which
is the argument for doing one.

| # | First draft said | Verified truth | Why it mattered |
|---|---|---|---|
| **6** | **"Frontdoor has been silent 7 days; Teddy answered correctly on Sept 8"** | **Our Sept 3 AND Sept 8 replies went to `jpivacek@gmail.com`, not to Akshay. `in:sent … to:Akshay after 2026/09/01` → count 0. Akshay has heard nothing from us since Aug 31 and has followed up twice.** | **Severe.** The email was written as "following up on our own note, ball in their court." Sent that way it would have read as blaming a partner for a gap we caused — on top of the false claim we're already retracting. Posture inverted: we open by owning 15 days of silence. |
| 1 | Sandbox host "has no routes deployed at all — bare root included" | `/dispatch-connector` **is** routed there — unauthenticated requests get `403 RBAC`, not 404. Only unrouted prefixes 404. | A second false technical claim inside the email whose whole purpose is retracting the first one — and Akshay could disprove it in ten seconds. |
| 2 | "It came through **7 separate times**" | 7 log entries = **3 distinct payloads** (schedule ×1 re-sent, status ×2) | He knows what he sent. Overstating it invites a third correction. |
| 3 | "823 **requests**" | 823 **events**; Frontdoor POSTs arrays and we log per event. 637 distinct after retries. | Wrong noun, and he can see his own send count. |
| 4 | "Akshay's Sept 8 message is the last one on the thread" | Superseded by #6 — **his** Sept 8 2:35 AM message IS the last one he knows about, because ours never sent. | Determines which message to reply-all to. |
| 5 | Cc list omitted Danny Suarez; didn't flag the `jpoivacek@` typo | Superseded by #7 — there is no Cc on this thread at all | — |
| **7** | **"Reply-all cc's Brian Bullock + 4 others; Brian is on the Cc and is the escalation"** | **Akshay's Sept 3 + Sept 8 messages have an EMPTY Cc and go only to `tnappliancerepair@gmail.com`. Every one of those five names appears only in quoted body text from an older forwarded thread. Proven: a Gmail search for `Brian.Bullock@ahs.com` returns these messages by BODY match, with `CC:` blank on every hit.** | Two ways. We'd have told Teddy to fix a Cc that isn't there. And the escalation plan assumed a reply-all would reach Brian — it won't; that has to be a new email. |

## ✅ SENT — 2026-09-15, 7:05:37 AM CT

Message id **`1a0a4f55771043dd`**, thread `1a0341dcd5f4a3e4`, from `tnappliancerepair@gmail.com`,
**`To: Akshay.Kyatam@frontdoor.com`**, Cc empty. Composed programmatically (no hand-typed `To:`
line anywhere in the chain) and then **read back out of Gmail's Sent folder** — the one check
whose absence caused this whole mess.

**The proof is the query that used to return zero.** `in:sent to:Akshay.Kyatam@frontdoor.com`
returned **count 0** for Sept 3 and Sept 8. Run today it returns this message, with
`TO: Akshay.Kyatam@frontdoor.com`.

⚠️ **Gmail's `in:sent` index lags roughly 20 seconds.** The first read 4 seconds after the send
returned **0 hits** and was indistinguishable from a failed send. Wait and re-query before
concluding anything — and never take the API's `200 {"mode":"sent"}` as proof on its own.

⚠️ **The draft was NOT consumed.** `gmail-send` with `send:true` POSTs to `/messages/send`, which
creates a *new* message; draft `1a0a3b083eba2a8a` still sits in the same thread. It is now a
duplicate of an email that already went out — **delete it in Gmail** so nobody sends Akshay the
same thing twice. (`gmail-send` has no delete action; this is a manual one-tap.)

**Also retired by #6:** the "he went quiet because our Sept 8 email inverted his
inbound/outbound vocabulary" theory. He never received that email. The no-inbound/outbound
rule still stands for the email we sent — it just wasn't the cause of the stall.

**Confirmed correct and unchanged:** all five two-way proofs (verbatim) · the Aug 31
"Confirmed working" quote (verbatim) · Akshay's inbound/outbound convention in both
directions (verbatim) · 276 distinct dispatch IDs · 7 log entries for 22863999 · the
2026-07-10 → 2026-09-14 range · the raw ops split · production `401 "Jwt issuer is not
configured"` (verbatim) · `invalid_client` on `login.frontdoorhome.com` · sandbox token mints ·
`source: TN_APPLIANCE_EXCHANGE` in the shipped code · Client ID · 270 of 276 dispatch IDs carry
a `schedule` op (the junk-job risk that keeps `FRONTDOOR_WEBHOOK_LIVE` off) · the full
unauthenticated/authenticated probe matrix, re-run immediately before send with identical results.

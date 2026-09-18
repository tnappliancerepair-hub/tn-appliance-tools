# Frontdoor / AHS — the finish line, and a pre-written answer for every way it comes back

**Written 2026-09-18.** Question from Teddy: *"do we think we're gonna be able to get this completed
with Akshay? What is the finish line? Stay aggressive, finish as soon as possible without pushing.
Anticipate every potential outcome and work on the strategy for it right now — no matter how it comes
back, I want to come back harder."*

---

## 1. The honest read: yes, and Akshay is not the risk

Measured off the thread, not remembered:

| when | who | what |
|---|---|---|
| 8/24 14:12 + 14:33 | **Akshay** | Opened it himself. Enabled our Client ID for sandbox, gave us the webhook URL + token, told us the `source` value to send. |
| 9/03 14:51 | **Akshay** | Followed up unprompted — *"22863999 is the Dispatch ID we sent, could you verify it was received?"* |
| 9/08 07:35 | **Akshay** | Followed up **again** — *"just following up, let us know if everything looks good."* |
| 9/15 07:05 | us | First reply that actually reached him (the 9/3 + 9/8 answers went to Teddy's own gmail). |
| 9/15 12:25 | **Brian Bullock** | Same day. |
| 9/16 07:35 | **Vaibhav Parashar** | Next morning — *"The issue with Sandbox instance is fixed. Can you please check again?"* |
| 9/17 07:30 | **Akshay** | Next morning — and he didn't just answer, he **went into his environment, pulled a request body that actually saves, and handed it to us.** That's what cracked the fifteen-day stall. |
| 9/17 18:45 | us | v4 sent, six recipients, four asks. |
| **now** | — | ~22 hrs of quiet, spanning one night, into a Friday. **Normal.** |

**Their measured turnaround once engaged is same-day to next-morning.** Two of them chased *us*. The
only thing that has ever stalled this integration is **our own silence** — twice (9/3 and 9/8 replies
that never sent, then the fifteen days after 8/31). That is the single most important fact in this
document, because it means the finish date is mostly in our hands, and the failure mode to guard
against is not theirs.

**Confidence it completes with Akshay: high.** The residual risk is not him. It is (a) us going quiet
again, (b) their internal queue for the one provisioning action, (c) a contract/security gate nobody
has mentioned yet.

---

## 2. The finish line, stated exactly

Not "they replied." **Four gates — and only three of them are theirs:**

| # | gate | who owns it | state today |
|---|---|---|---|
| **1** | **A production credential is issued** and mints a token whose `iss` is the production issuer. | **them** | ❌ Our token still issues from `login.sandbox.frontdoorhome.com`; hitting `api.frontdoorhome.com` returns `401 "Jwt issuer is not configured"`. Everything else on our side is a credential swap. |
| **2** | **One real production status push returns 200 AND a human confirms it rendered on the dispatch.** | shared | ❌ Can't start until gate 1. ⚠️ **A 200 is not a receipt** — their own words. We have no read-back, so this gate needs a human's eyes exactly once. |
| **3** | **Written confirmation the production feed is scoped to vendor ids 822418 / 822218 / 839828.** | **them** | ❌ Said verbally on 9/17 (*"in production you will receive data only for your actual vendors"*). **Not yet in writing.** Until it is, `FRONTDOOR_WEBHOOK_LIVE` stays off — the sandbox feed is other contractors' dispatches (1396202 / 157992 / 1636528, none ours) and flipping it live would create their jobs on our board. |
| **4** | **`FRONTDOOR_PUSH_LIVE` + `FRONTDOOR_WEBHOOK_LIVE` on, watched a full business day clean.** | **us** | ❌ One flag flip + one day of watching, after 1–3. |

**Everything outbound on our side is already done and proven:** the saving envelope, all 23 statuses,
the 11-step lifecycle demo, the 900-char TDR note, and a test suite that fails if the email ever drifts
from the code. The gap is not build. **The gap is three handovers and one afternoon of watching.**

**Realistic finish:** if the credential lands early next week, **gates 2–4 are one business day.**
If it needs a contract or security review, add one to three weeks — and that's the branch to detect
early (see G below), because it's the only one where the clock isn't ours.

---

## 3. Aggressive without pushing — the actual lever

Frequency is not the lever. Their dev queue has other partners in it; emailing more often does not move
us up it. **Two things do:**

### 3a. Unbundle the asks — this is the highest-value single move

All four asks currently ride one email, so **the reply waits on the slowest one.** Ask #1 (a production
credential) is likely a ten-minute provisioning action. Asks #3 (auth outcomes + notes + NCC pushed to
us) and #4 (feed scoping in writing) may need a meeting or a product decision.

**Split them.** Get to production on the cheap ask while the expensive ones sit in their backlog.
A separate, short, single-ask email is *easier* to answer than a nudge on a four-ask one — so it reads
as less pushy, not more, while moving faster.

### 3b. Come back with delivery, not a nudge

**"Come back harder" = the next email reports something new we did, not something we're still waiting on.**
A partner who ships between emails gets prioritized; a partner who asks twice gets queued.

**The thing to ship before the next email: wire the five `mapped` statuses.** ARRIVED · PARTS_ORDERED ·
PARTS_ON_ORDER · RETURN_SET · ON_HOLD are each **one call site** from live — the map entry exists,
nothing passes the key. Wiring them takes **3 automatic → 8 automatic** and turns the next email from
*"any update?"* into *"since Thursday we wired five more; here's the corrected table."* That is entirely
ours, needs nothing from them, and is the cheapest credibility we will ever buy.

### 3c. The escalation ladder, without going over his head

Never "I'm escalating past you." The non-pushy version is **asking him who owns the thing**:
> *"Akshay — is the production credential something you issue, or should I be asking someone else so I
> stop routing it through you?"*

That's a courtesy, and it surfaces the real owner. Known ladder if needed: **Ben Kelly** is the BD rep
who owns production access; **Brian Bullock** is the senior PM (already on the thread since 9/16, so he
has seen the retraction — no cold-start briefing needed).

### 3d. Cadence, so we're never the ones who went quiet again

- **Mon 9/22 AM** — if still silent, send the **unbundled single-ask** email (draft in branch A/F below). Four business days after ours is a check-in, not a nudge.
- **Thu 9/25** — if still silent, the *"who owns this"* line to Akshay, cc Brian.
- **Tue 9/30** — Ben Kelly, new email, leading with what's already proven.
- **Standing:** never let seven days pass with the ball on our side. **The stall has always been us.**

---

## 4. Every way it can come back — and what we send within the hour

> **Rule for all branches: reply same business day.** Speed is the whole relationship.
> **Second rule: never claim a 200 is a save.** It isn't, and we said so first.

### A. Full yes — credential + confirmation + feed scoped
**What it means:** finish line is one day out.
**We do, in order:** vault the production creds → flip `FRONTDOOR_ENV=production` → run one status push
on ONE real dispatch → ask them to eyeball it → on confirm, `FRONTDOOR_PUSH_LIVE=1` → watch a business
day → then `FRONTDOOR_WEBHOOK_LIVE=1` **only if #3 came in writing**.
**We reply:** confirmation of the exact dispatch we'll test, the timestamp, and the one thing we need
(a human glance). Nothing else.

### B. Credential yes, feed scoping silent
**Most likely partial.** Take the win, don't bundle it back up.
**We do:** everything in A **except** the webhook flip. Receiver stays dark.
**We reply:** *"Production push is live as of \<time\>. The receiver stays off until I have the feed
scoping in writing — I don't want to create another contractor's dispatch on our board."* **That
sentence is the whole play** — refusing to flip a switch we could flip is the most credible thing in
the whole thread, and it makes the written confirmation their easy next action.

### C. "22863999 landed" but no credential timeline
**We do:** nothing technical — that ask is answered.
**We reply:** thank them, close that loop **explicitly** ("that's the last thing I needed on sandbox"),
then 3c verbatim: *is the credential yours to issue or should I ask someone else?* Converts a
non-answer into a routing answer.

### D. They answer the `status` question (description vs code-as-string)
**We do:** one-word change in `_lib/frontdoor.js` if they say code; re-run `tests/frontdoor-payload-shape.test.js`
and the email-matches-code test; re-sweep the 13 codes.
**We reply:** *"Changed and re-swept, all N codes still 200."* Same day. **Fastest possible turnaround
on a partner's correction is itself a credential.**

### E. "Your envelope is wrong for production" — prod differs from sandbox
**We already built the reversal.** `FRONTDOOR_LEGACY_SHAPE=1` restores the documented `data[]` body as a
one-line flip, no deploy.
**We do:** flip it, re-probe production, report the result with the HTTP status and their error code.
**We reply:** the probe table (`frontdoor-probe?shape=all` gives all 24 rows in one call). **Do not argue
the spec** — hand them measurements and let the data make the case. That is what cracked 9/17.

### F. Silence past Mon 9/22
**Not a bad sign** — he chased us twice; he's not ghosting. Assume queue, not disinterest.
**We do:** ship the five mapped statuses first (3b).
**We reply (short, one ask, delivery-led):**
> *Akshay — since Thursday we wired five more statuses, so eight now fire automatically instead of
> three (Arrived, Parts Ordered, Parts on Order, Return Appointment Set, On Hold). Everything on our
> side is done and tested against the body you sent.*
> *The one thing I need to go live is a production credential for Client ID 040c014f-… — our sandbox
> token gets "Jwt issuer is not configured" against api.frontdoorhome.com. The other three questions
> can wait; that one unblocks everything.*
> *Is that yours to issue, or should I be asking someone else so I stop routing it through you?*

Delivers, unbundles, and routes — in six lines.

### G. "We need X first" — security review, questionnaire, contract, MSA
**The branch that actually moves the date, so detect it early.** (ERP pulled exactly this once.)
**We do:** answer it **the same day, completely.** Company facts are already assembled — TN Appliance
Exchange LLC · EIN 38-3886067 · 3137 Skinner Dr, Antioch TN 37013 · NAICS 811412 · est. 2012 · carriers
Hiscox GL / Hartford WC / Progressive auto · COI + W-9 + license live at `/vendor-compliance.html`.
**Never let a form sit overnight.** ⚠️ Anything with a **purchase commitment or volume minimum** goes to
Teddy before it's signed — that's a business decision, not a technical one.

### H. "We're pausing / deprioritizing"
**The only genuinely bad branch, and the least likely.**
**We do:** nothing loud. Ask for the honest version: *is this a quarter thing or a this-integration
thing?* — that tells us whether to wait or route around.
**Then:** the work is **not wasted.** The envelope-walking method, the probe harness, the code↔email
pinning, the 23-status catalog — all of it is the template for ServicePower, NSA, and the next warranty
network. Point it at whoever is ready. **Our leverage was never one partner; it's being the contractor
whose integration is already done.**

### I. "Your pushes did NOT land" despite the 200s
**We predicted this out loud, which is why it won't hurt us.** We told them a 200 is not a receipt
before they could tell us.
**We do:** `frontdoor-probe?shape=all` on the failing dispatch, send the 24-row table, ask one question:
*which field should differ?* **Do not guess.** Walking their validator one error at a time is the method
that already worked once.
**We reply:** *"That matches what I flagged — the 200 is an acknowledgement, not a save. Here's every
variant and the exact code each returns."*

### J. They flag the wrong status-70 entry on their test dispatch
**We disclosed that ourselves**, in the same email, unprompted — a Parts-Arrived note went out under
status 70 because `frontdoor-test` silently fell back to EN_ROUTE on an unknown key.
**We do:** nothing. It's fixed (returns 400 listing valid keys).
**We reply:** *"Yes — that was mine, disclosed in Thursday's note. The fallback that caused it is gone;
it now refuses an unknown key instead of guessing. Say the word and I'll push a corrected 410."*
**Self-disclosed bugs are trust deposits.** Do not get defensive about one we volunteered.

### K. They offer a call
**Take it, same week, any time they name.** Bring: the 11-step lifecycle run, the 23-status split
(23 ours to report / 15 theirs to decide and we deliberately do not push), and **one ask** — the
credential. **Do not bring the other three asks to the call** unless they raise them; get to production,
then earn the rest.
**The line that lands:** *"We're not asking you to build anything. The receive half is already written —
it handles Schedule, Status, Notes and NCC, auto-advances on safe codes, and flags authorization
outcomes for a human instead of acting on them. It's dark for one reason: the sandbox feed is other
contractors' dispatches."* **Declining to push the 15 decision codes is the credibility move** —
asserting a decision we don't make is how an integration gets its credentials pulled.

### L. A different Frontdoor person replies (Shivam / Adarsha / Danny / Vaibhav / Brian)
**Answer them directly, keep everyone on the thread, don't re-route back through Akshay.** Six people
are on it now; whoever engages is the right person. **Never drop a recipient from the To: line.**

---

## 5. What we do regardless of which branch hits

Ranked by what buys the most, needing nothing from them:

1. **Wire the five `mapped` statuses** → 3 automatic becomes 8. One call site each. Turns the next
   email into a delivery. **Do this first.**
2. **Solve the read-back.** `_lib/frontdoor.js` is write-only (`dispatchStatusUpdate` +
   `caseLifecycleStatusUpdate`, no GET). That's why "did it land?" is an *ask* instead of a *check* —
   a permanent dependency on a human's eyes. If any read path exists, it removes one ask forever and
   turns gate 2 from a favor into a self-service verification. **Worth asking for explicitly**, and
   worth probing for once we have production creds.
3. **Never go quiet.** The stall has always been us. `gmail-send` (`from` + `to` + `thread_id` +
   `send:true`) — **never reply from a `Fwd:` copy**, that's what lost 9/3 and 9/8.
4. **Keep the email pinned to the code.** `tests/frontdoor-email-matches-code.test.js` — if a status
   changes tier or a count moves, the suite goes red **before** the email goes out. Re-run
   `node --test tests/*.test.js` before every send.

---

## 6. The one-line answer

**Yes, it finishes — and the finish line is three handovers and one afternoon, not more building.**
Our side is done and tested. The way to be aggressive without being pushy is to **unbundle the cheap
ask from the expensive ones, and make every email a delivery instead of a nudge** — which means the
next thing to build is the five wired statuses, so that when they answer, we've already come back harder.

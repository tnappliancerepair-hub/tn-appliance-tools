# Bulletproof Phone Plan — 0-Human-Help Voice (2026-07-06)

Midnight brainstorm with Teddy: *"How would you kick my ass with our tech stack if
you were a competitor? Make the phone hands-down the best."* Red-teamed our own
Telnyx→Vapi→Claude→Xano rig, audited what's actually built, and landed the plan
below. **We're ~70% there already** — the net exists; it has one hole (exactly where
3 AHS reps fell through on 7/3), and a few boring reliability layers missing.

## 🎯 THE INVARIANT (the bar that makes it bulletproof)
> **No caller ever hits dead air, a dropped call, or a dead end. Ever. The worst
> outcome in the entire system is a logged, prioritized recovery that closes itself —
> never a lost human.**

"Zero human help" is the wrong brag — it breaks. The real goal is **zero dropped
callers.** Once you accept that, this is reliability engineering, not AI. Our brains
tie any competitor; we win or lose on the boring layers you only see after 3 failed
calls at 6pm on a Friday.

## ✅ WHAT WE ALREADY HAVE (better than it feels)
- **Dead-air fix** — `vapi-tool.js` caps every lookup at **4.5s** and returns a
  "keep talking, take their details" fallback instead of freezing (was the #1
  dropped-call cause: slow Xano → silence-timed-out).
- **Capture net** — `capture-callback` + `vapi-webhook` convert voicemail / silence /
  short-hangup / **transfer-fail** into an auto-callback or a "sorry we couldn't
  connect, tell me here" text.
- **Worked queue** — `callback-watch` SMSes Teddy every 30 min, at-risk callers
  (repeat/complaint/"tech came out but…"/asked-for-a-person) flagged first;
  `callbacks.html` + `dismiss-dropped-call` is the board.
- **Grounding** — every status answer routes through **job-truth** (one truth, every
  seat). Ant literally can't hallucinate a status.
- **Retry-on-voicemail** — one auto-retry 30 min later, hard-capped at 2 attempts.
- **STT fallback** — Deepgram nova-3 multi with AssemblyAI-en fallback.

## 🕳️ THE GAP — feature by feature
| Capability | Now | Bulletproof | Size |
|---|---|---|---|
| **`transport-never-connected`** | ❌ **Falls into a void.** The webhook's drop-reason lists (voicemail/silence/no-answer/transfer-fail) **don't include it**, and these calls are 0s → nothing fires. **This is where the 3 AHS reps vanished on 7/3.** | Caught like any other drop → office alert + caller assurance | **Small — #1 fix** |
| **Watchdog / canary** | ❌ None for phone (found the 7/3 blip by hand, days later) | Synthetic call every ~10 min asserts "Ant answered + spoke"; a cluster auto-pages | **Medium** |
| **Talk-while-working** | 🟡 4.5s cap + fallback, but Ant goes *quiet* during the lookup | Spoken "one sec, pulling that up" filler → never any silence | **Small (assistant cfg)** |
| **Hot-data edge cache** | ❌ Every lookup is a live Xano hit | Today's jobs + open claims cached at edge → 20ms; Xano off the call's critical path | **Medium** |
| **Carrier redundancy** | ❌ Single Telnyx trunk on the critical path | Dual-carrier auto-reroute (Telnyx↔Twilio) | **Now buildable — Twilio is live** |
| **STT keyterm boost** | 🟡 generic multi | Loaded with model#/part#/claim-digit/warranty-co vocab | **Small (cfg)** |
| **Golden-transcript eval** | ❌ tune live, learn from bad calls | 30 recorded real calls replayed against every prompt change | **Medium** |

## 🛡️ THE UNIVERSAL SAFETY NET (the whole trick)
Under everything, one function every unhappy path falls into — **`captureAndAssure`**:
no matter what broke (carrier, tool, model, transfer, silence), the caller hears
*"I've got your info, someone will call you right back,"* a structured task is written,
and it lands in the worked queue (or fires an Ant outbound callback in minutes). A
total system failure is **indistinguishable from a normal "we'll call you back."**
That's what makes it feel bulletproof even when a subsystem isn't.

## ☎️ THE AHS PLAYBOOK — prevention, NOT callback (Teddy's key insight, 7/6)
**The AHS 800# (1-800-776-4663) is a Filipino call center. Calling back drops YOU
into a 30-min hold to reach a DIFFERENT rep with zero context on the call you missed.**
So the callback net — perfect for a homeowner — is **useless for AHS.** That flips the
strategy:

1. **The inbound flow is already right + proven.** `lensWarranty` (job-truth) answers
   the whole status in one breath off the work-order/claim number — *"Yes, John's
   been out, repair completed and closed Mon 6/29, part X."* Exactly the Sheila call
   (dispatch 45598229, 7/3, 95s). **The script was never the problem.**
2. **Open in rep-mode instantly (a tightening).** We KNOW the caller ID is AHS →
   skip homeowner-vs-rep detection, go straight to *"TN Appliance, this is Ant —
   what's the work order number?"* Faster, no fumble, no confused hangup.
3. **Connection is everything → dual-carrier auto-reroute is AHS priority #1.**
   Because a missed AHS call has no recovery, the ONLY thing that helps is the first
   call connecting through a Telnyx blip. Live Twilio + API makes that self-healing.
4. **A dropped AHS call needs a different recovery.** It's 0s, no WO# — nearly
   information-free. So a drop from the AHS caller-ID → **(a)** alert the office
   instantly *"⚠️ AHS just tried you and dropped — they'll retry, keep the line
   clear,"* and **(b)** surface our hot AHS dispatches (recently active / awaiting
   status) so a human can push those into the portal before the rep redials — NOT a
   homeowner-style "we'll call you back."
5. **Root fix that ends the calls entirely: the AHS Partner API** (Brian Bullock
   ticket) — push status into their portal so reps stop needing to dial at all. Every
   call prevented is a call that can't drop.

**Mindset: for AHS we don't recover missed calls — we prevent them and pre-answer
them. Everyone else gets the callback net; AHS gets never-drop + proactive-push.**

## 🔌 WHY DUAL-CARRIER IS NOW IN REACH (Twilio is live + API-connected)
The hard part of carrier redundancy was never code — it was *having a second
A2P-approved carrier with API access.* **We already do.** Today Twilio is SMS-failover
only (629-284-0444 customer, 727-350-8487 tech). The crown-jewel move it unlocks:

**Auto-reroute watchdog (self-healing, zero human):**
1. Canary places a synthetic call to each published number every ~10 min.
2. Detects a `transport-never-connected` cluster on the Telnyx leg (the 7/3 pattern).
3. Hits the **Telnyx API to forward that number to the Twilio-backed Vapi number**
   until the leg recovers, then flips back.
4. Real callers ride the healthy carrier through the blip and never know.

**Honest caveat:** the error says `providerfault` — in Vapi's vocab "provider"
usually means the *carrier* (Telnyx), which is exactly what dual-carrier fixes. If a
fault is ever inside Vapi's *own* media infra, failover to a Twilio leg that still
terminates at the same Vapi won't fix that specific fault — which is why the recovery
hook + canary come first (they resolve the caller regardless of whose fault it is);
the carrier reroute is belt-and-suspenders on top.

**Gate:** confirm voice is enabled on the Twilio failover numbers (629-284-0444 /
727-350-8487) and pointed at Ant Inbound (phone-number-strategy.md step 7). If on,
#4 is a straight build; if not, a 5-min Twilio-dashboard flip first.

## 🗓️ BUILD ORDER + TIMELINE
| # | Build | Effort | Owner | Risk |
|---|---|---|---|---|
| 1 | **Transport-drop recovery — AHS-aware.** Add `transport-never-connected` (+ 0s non-answer) to the webhook drop handling. AHS caller-ID → office alert + hot-dispatch list; everyone else → the existing caller-assurance path. Closes the exact 7/3 void. | ~1 hr | Claude, now | internal, none |
| 2 | **Rep-mode greeting for the AHS number** — open straight to "what's the work order number?" for 1-800-776-4663. | ~1 hr | Claude stage → Teddy approve apply | touches live assistant |
| 3 | **Talk-while-working filler + STT keyterms** — spoken filler during lookups; load model#/part#/claim/warranty-co vocab. | ~1 hr | Claude stage → Teddy approve | touches live assistant |
| 4 | **Auto-reroute watchdog** — canary → Telnyx/Twilio API failover → flip back. The real bulletproofing. | ~½ day | Claude | needs Twilio voice confirmed |
| 5 | **Hot-data edge cache** (phone lookups) + **golden-transcript eval harness** | 1-2 wks | Claude | internal |

**How fast, honestly:** the reliability jump is **this week** (1-3 close the AHS hole
+ give 90-second detection instead of 3-day). **True self-healing dual-carrier is
days after**, not weeks — entirely because the second carrier is already live.

## 🌗 BIGGER SWINGS (later / worth piloting)
- **Speech-to-speech realtime model** for the chatty front half of the call (greeting/
  intent) where latency causes "customer stepped away" silence-timeouts, then hand
  structured data to Claude for the grounded/tool-heavy part. Use only where grounding
  doesn't matter.
- **BYOC / dedicated SIP trunk** so carrier health is ours to monitor.
- **Per-number CNAM + branded calling** so outbound callbacks show "TN APPLIANCE" and
  get answered (closes the loop the safety net opens).

## ⚠️ CONSTRAINTS (unchanged)
- Never send Teddy's cell to anyone; never expose the home address; warranty jobs
  never hit a payment screen; never share part numbers with customers.
- Assistant/prompt changes are **staged for Teddy's approval** before applying to the
  live line (outward-facing). Internal Netlify functions (recovery hook, canary,
  cache) ship directly.

---
*Changelog: 2026-07-06 created from the midnight "bulletproof the phone" brainstorm.
Twilio confirmed live + API-connected → dual-carrier moved from "big external" to
"buildable now." AHS-callback-is-futile insight reframed AHS to prevention + pre-answer.*

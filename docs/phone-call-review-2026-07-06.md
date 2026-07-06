# Phone call review — every dropped/complaint call → root cause → fix (living doc)

Teddy 2026-07-06: "Go over every complaint call, figure out the root cause and a
solution for each, so it doesn't happen again. Learn from all these mistakes."
The AI answering service is the ONLY thing answering the phones right now, so it
has to be dialed in. This is the running ledger. Pull the day's calls with
`vapi-admin?action=daycalls&hours=20` (flags the upset ones); dig any call with
`action=calldetail&call_id=…`.

Today: 58 calls, 23 flagged. They collapse into 6 root causes.

---

## ROOT CAUSE 1 — the AI didn't know what day it was → called TODAY's job "tomorrow"
**Calls:** Christopher Collier (615-631-5355, GE dishwasher, Jimmy no-show). The AI
said *"you're scheduled for tomorrow, Monday July 6"* — but it WAS July 6. It pulled
the appointment date correctly; it just thought "today" was July 5 and did the
today/tomorrow math off a guessed current date.
**Why:** the assistant had no live clock injected, so it guessed the current date
(a day behind). A prompt rule already said "don't guess dates" — useless without
actually giving it the date.
**FIX (SHIPPED):** `vapi-admin action=date_now` injects the live Central-time date
(`{{now}}`) at the top of the prompt and forces all today/tomorrow/yesterday math to
be computed only from it. Applied to Ant Inbound.
**Verify:** next appointment-status call should state the correct relative day.

## ROOT CAUSE 2 — no live transfer → upset callers, AHS reps, and "get me Teddy" all hit a wall
**Calls:** Sonja Cotter, Keith (931-436-1593), 504-810-6865 (called twice begging
for a person), Marcel (504-458-5719 "no one calls me back"), 504-458-5719 "I need
to speak with Teddy", 615-631-5355 "This is the repair technician — the office"
(dropped in silence).
**Why:** there is NO live human transfer — every "get me a person" ends in a message.
When the caller is ALREADY upset (no-show, delay), "I'll take a message" is gasoline.
And techs / people asking for Teddy get dead air.
**DECISION (Teddy 2026-07-06):** NO live transfer. Teddy's in the field all day; a
transfer just rings out and dumps to a message anyway. Instead the AI takes a great
MESSAGE and we call back.
**FIX (SHIPPED):** `vapi-admin action=message_mode` — removed the transferCall tool
and all transfer blocks; installed a warm take-a-message flow: if a caller wants a
person / is upset / needs follow-up, the AI acknowledges + apologizes, calls
capture_callback (name, number, one-line need), sets honest callback expectations,
reads the number back, and never hangs up on them.
**OPEN (the follow-through that makes it work):** the callbacks have to actually get
worked. They land in the **Callbacks queue** (`callbacks.html` / list_callback_requests).
NEXT: alert Teddy (text) on URGENT/upset/AHS callbacks so a hot one never sits.

## ROOT CAUSE 3 — AHS new/expedited dispatches were NOT captured → LOST
**Calls:** Karen Bailey (AHS claim 61476179, EXPEDITED refrigerator, insulin inside,
Murfreesboro) — the AI took the details, said "logged," then hung up on the rep;
NOTHING was saved (no job, no callback). Celine/AHS dispatch 50941939 (Michael Carey,
New Orleans) — lookup failed, spent 5 min, captured nothing.
**Why:** no rule for when AHS GIVES a new dispatch; the AI "verbally confirmed" but
never actually called capture_callback, and ended the call on the rep.
**FIX (SHIPPED):** `warranty_dispatch` — never hang up on a rep; ALWAYS invoke
capture_callback with the full dispatch (claim/member/address/appliance/issue); flag
expedited/medical as URGENT; stop looping on a failed lookup.
**OPEN:** (a) recover Karen Bailey's lost dispatch manually. (b) make captured
expedited dispatches TEXT Teddy immediately, not just sit in the callbacks queue.

## ROOT CAUSE 4 — real ops failures the AI had to absorb (not the AI's fault, but it made them worse)
**Calls:** Christopher Collier (Jimmy no-showed a scheduled job), Charlene Staff
(504-812-4793 — the part + tech were sent to her DAUGHTER's address), Marcel (part
stuck since June 22, repeated unreturned calls).
**Why:** genuine operational misses. The AI can't fix them and has no real-time
escalation, so upset customers spiral on the line.
**FIX:** ties to ROOT CAUSE 2 (live escalation) + an "urgent/angry customer → text
Teddy now" path. Separately: the no-show + wrong-address are ops issues to run down.

## ROOT CAUSE 5 — caller-ID lookup returned the WRONG person
**Calls:** Christopher Collier's call — the AI asked *"Am I speaking with David?"* to
Christopher's own number. His number resolved to a different name.
**Why:** lookup_customer_by_phone matched the number to the wrong customer (or a
stale/magnet record).
**FIX (TO INVESTIGATE):** check why 615-631-5355 resolved to "David"; tighten the
phone→customer match so it doesn't greet people by the wrong name.

## ROOT CAUSE 6 — silence-timed-out drops
**Calls:** many end in silence-timeout. Split into two kinds:
- BENIGN: our own outbound-to-voicemail + robocalls ("at the tone please record") +
  the 1-800 spam/Google-listing scam. Not real drops.
- REAL: a live caller left hanging (historically dead air on a slow lookup).
**FIX:** SLOW_FALLBACK already keeps the AI talking through a slow Xano lookup. TODO:
confirm no lookups are still timing out mid-call, and stop counting voicemail/robocall
timeouts as "drops" in the review.

---

## The process going forward
1. Each evening: `daycalls` → review flagged calls.
2. Every real complaint → assign it a root cause above (or add a new one) + a fix.
3. Ship the fix, note it here, verify on the next matching call.
4. The list of root causes should SHRINK over time — that's the scoreboard.

*Changelog: 2026-07-06 created from the day's 58 calls (23 flagged). Shipped:
date_now, warranty_dispatch, human_handoff. Open: live transfer (RC2), Karen Bailey
recovery + expedited-alert (RC3), caller-ID mismatch (RC5).*

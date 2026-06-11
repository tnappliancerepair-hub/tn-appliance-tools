# Call-Me Intake — design (2026-06-11)

**Idea (Teddy):** On the site, when we ask the customer how they want to be
contacted (text vs call), if they choose **call**, Ant should *call them* and
do the intake conversationally — instead of making them type. Simplest path for
the customers who least like forms.

## Why it fits

- **Channel = customer's choice, not just cost.** The playbook's cascade
  (portal > SMS > calls) is about *default* cost. But when a customer *prefers*
  a call, calling them is the simplest, highest-completion path — and "internal
  seamlessness = customer experience" is the moat. Meet them where they are.
- **Single-write.** The call's result flows straight into the job. Nobody
  re-types. Office / tech / warranty all see the same job the call populated.

## Flow

1. **Intake page** asks "Text or Call?" + captures name + phone (+ zip).
2. **Text** → existing chat/portal intake (unchanged).
3. **Call** →
   a. Create the stub job (customer + phone + zip + `intake_source`).
   b. Immediately place an **outbound Ant intake call** via `dispatch_voice_call`
      with `call_type: "intake"`.
   c. Ant collects by voice: appliance, brand, symptom/problem, when they
      **can't** be home (availability blackouts), confirm address. Enforces the
      operating model — **no specific appointment time** ("you're a stop that
      day; we text a live window the morning of").
   d. For what voice can't capture (model-tag photo, 10-sec video), Ant says
      *"I'll text you a link to add a couple photos"* → SMS the
      `upload.html?job_id=X` / portal link. Hybrid.
4. **Call ends → `vapi-webhook`** parses the summary and writes into the job
   (`problem_summary`, `appliance_type`, `brand`, blackouts via
   `add_customer_blackout`). Seeded by the existing
   `merge_call_note_into_problem_summary` endpoint.

## Components to build

| Piece | Where | Status |
|---|---|---|
| `dispatch_voice_call` works | `api/intake/dispatch_voice_call_POST.xs` | ✅ fixed 2026-06-11 (3 footguns) |
| **"Ant Intake" outbound assistant** | Vapi dashboard | TODO (Teddy/dashboard) — prompt tuned to collect intake + enforce day-of routing |
| Add `call_type: "intake"` → assistant id | `dispatch_voice_call_POST.xs` | TODO (one conditional block, same pattern as the others) |
| "Text or Call?" choice on intake page | intake / `cash-tdr` / book page | TODO |
| "Call me" → create stub job + dispatch call | new small endpoint or wire existing create + dispatch | TODO |
| Call summary → job fields | `vapi-webhook.js` (+ `merge_call_note_into_problem_summary`) | partial — extend mapping |

## Dependencies / sequencing

1. ✅ Fix `dispatch_voice_call` (done — needs Xano push to go live).
2. Create the **Ant Intake** assistant in Vapi; grab its assistant id.
3. Add the `intake` `call_type` branch (assistant id) to `dispatch_voice_call`.
4. Wire the intake page's "Call me" → stub-job + dispatch.
5. Extend the webhook summary→job mapping.

**Recommended:** build this as one focused unit *after* today's pile of fixes
(waiver, chat-availability, agent fleet, send-email) is deployed + verified, so
it doesn't compete with getting those live. No real outbound calls placed until
Teddy gives the go.

## Consent note

Choosing "Call me" on the site *is* the consent to be called. Log the choice
(`record_portal_event` / `intake_source`) so there's an audit trail of the
customer requesting the call.

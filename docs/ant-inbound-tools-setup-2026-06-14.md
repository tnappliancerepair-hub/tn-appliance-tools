# Ant Inbound — correct tool wiring (ours vs the developers')

Saved 2026-06-14 while securing the calls. Production Vapi account =
**tnappliance@gmail.com**. The live inbound assistant = **Ant Inbound**
(id `7cc88dd0c-...`). This doc says exactly which tools it should have and why.

## The situation we found
The account has **two parallel tool sets**:

1. **OURS** — point at our Xano (`https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/...`)
   or our Netlify (`https://tnapplianceexchange.net/.netlify/...`). We build +
   maintain these; all the recent call-securing fixes live here.
2. **The developers'** — a parallel set with different names
   (`lookup_warranty_status`, `get_jobs_by_phone`, `propose_schedule`,
   `confirm_schedule`, `reschedule_proposal`, `confirm_reschedule_proposal`,
   `book_appointment`, `get_available_slots`, `parts_lookup`, plus `ds_`/`d_`
   prefixed duplicates and several "API Request" type tools). **We have ZERO
   backend in our codebase for any of these** — they hit a server we don't
   control. Verified by grepping `api/` + `netlify/` for each name: no match.

**How to tell them apart:** open the tool, read the **Server URL**.
`...xano.io/api:3e_TffpA/...` or `tnapplianceexchange.net/.netlify/...` = ours.
Anything else = theirs.

## The catch that bit us
On 2026-06-14, **Ant Inbound only had `capture_callback` attached** — none of
our lookup tools. So the masked-caller guard + the CSC straight-answer summary
(both built into OUR Xano endpoints) could not fire on calls. If Ant Inbound is
wired to the developers' `get_jobs_by_phone` / `lookup_warranty_status`, our
fixes are bypassed entirely.

## What Ant Inbound SHOULD have (attach these — all OURS)
Tool configs are in `vapi-config/tools/`. Create each in Vapi (Custom Tool →
toggle to JSON → paste the file), then attach to Ant Inbound.

| Tool | File | Why it matters |
|---|---|---|
| `lookup_customer_by_phone` | tools/lookup_customer_by_phone.json | First call on connect. Returns `caller_id_masked` so Ant doesn't mis-greet forwarded calls. |
| `lookup_by_claim_number` | tools/lookup_by_claim_number.json | Warranty/CSC lookups. Returns `primary` summary + `been_out` / `is_scheduled` for a straight answer. |
| `search_customers` | tools/search_customers.json | Name fallback when phone + claim miss. |
| `capture_callback` | tools/capture_callback.json | Graceful fallback -> hardened 3-path capture -> office Callbacks queue. (Already attached.) |

Optional (also ours, nice-to-have for richer answers): `check_service_zone`,
`get_job_status_for_warranty`, `get_schedule_history`, `get_parts_status`,
`confirm_appointment`, `initiate_customer_reschedule`, `get_job_arrival_status`,
`get_customer_communications`, `start_new_intake` (-> create_job_from_chat).

## Remove / ignore on Ant Inbound (developers', no backend of ours)
`get_jobs_by_phone`, `lookup_warranty_status`, `propose_schedule`,
`confirm_schedule`, `reschedule_proposal`, `confirm_reschedule_proposal`,
`book_appointment`, `get_available_slots`, `parts_lookup`, and the `ds_`/`d_`
prefixed duplicates. Detaching them stops Ant from calling a tool we can't see
or maintain instead of ours.

## Three dashboard flips (still manual)
1. **transferCall** — set destination to a number that actually rings; test it
   (7 calls hit `error-transfer-failed`).
2. **Analysis → Summary** — enable so the call log shows content.
3. **Prompt** — paste the latest from `docs/vapi-inbound-prompt-2026-06-14.md`
   (handles the masked-caller flag + the claim `primary` summary).

## Success signal
As Danielle schedules in Ant and the lookups stop missing, watch the
`assistant-forwarded-call` + `callback_request` counts fall, and the daily
`vapi_call_review` ⚠ STRUGGLED list shrink. That's the phone getting better.

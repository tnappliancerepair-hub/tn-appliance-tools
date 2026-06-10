# Rest-of-week plan: verify the intake pipeline + go-live (saved 2026-06-10)

Teddy's ask: confirm the full intake pipeline actually flows end-to-end with
complete data — email job → Xano → customer Ant-chat (video/pic/complaint) →
Teddy Tool cockpit → SMS to Teddy + tech → TDR updated. Plus the phone fixes +
scheduler flip already in the queue.

## ✅ The pipeline you described is ALREADY WIRED — here's the proof

| Stage (your words) | What's wired | File |
|---|---|---|
| 1. Email job → Xano (all data) | `create_job_from_email` creates customer + job, dedups by claim#/phone, captures problem/claim/appliance/brand | `create_job_from_email_POST.xs` |
| 2. Customer gets Ant chat link for video/pic/complaint | emits JOB_CREATED → `job_created.js` texts the link and literally asks for *"a photo of the model number tag + a 10-sec video of the issue + any notes"* | `job_created.js` |
| 3. Customer uploads media + complaint | `upload.html` → `save_attachment` → emits CUSTOMER_INTAKE_BUNDLE_READY | `save_attachment_POST.xs` |
| 4. Bundle → Teddy Tool cockpit | cockpit shows media + complaint + 3-panel briefing | `qc_cockpit_load`, `teddy-tdr-tool.html` |
| 5. SMS to Teddy + tech (+ Danielle if warranty) | `customer_intake_bundle_ready.js` fans out | `customer_intake_bundle_ready.js` |
| 6. TDR updated with new info | customer problem → `jobs.problem_summary` → TDR pre-fill (3-panel + voice-merge) | `tech-ant-chat.html`, `merge_call_note...` |

**So it's not "do I need to build this" — it's "does it actually fire with
complete data in production."**

## ⚠️ The two known break points

1. **`CUSTOMER_FACING_ENABLED` gate (the big one).** Stage 2 (the customer's
   Ant-chat invite) is gated by this env var. If it's **OFF**, real customers
   NEVER get the chat link → stages 3–6 never happen for them. This is almost
   certainly why it feels like "I don't know if it's working" — the customer
   half is gated off. **Decision required: flip it on (scoped to parallel-mode
   jobs) so real customers get the invite.**
2. **Warranty emails often have NO customer phone** (records created by
   name+address). No phone → the chat-invite SMS can't send, regardless of the
   gate. Need to confirm how many incoming emails carry a phone, and a fallback
   for the ones that don't.

## The verification: ONE controlled end-to-end trace (safe, gate stays off)

`send_sms` has **owner-bypass** — Teddy's own number gets messages even with
`CUSTOMER_FACING_ENABLED=false`. So trace the WHOLE chain safely, with your own
phone as the customer, without messaging any real customer:

1. **Create a synthetic email-intake job** with Teddy's cell as the customer
   phone (via `create_job_from_email`, or inject one).
2. **Stage 1 check:** confirm the job + customer landed in Xano with complete
   fields (problem, claim#, appliance, brand, phone).
3. **Stage 2 check:** you (owner-bypass) receive the Ant-chat link SMS asking
   for model photo + video + notes.
4. **Stage 3 check:** open the link, upload a pic + 10-sec video + a note.
   Confirm `save_attachment` fired + CUSTOMER_INTAKE_BUNDLE_READY emitted.
5. **Stage 4 check:** open `teddy-tdr-tool.html?job_id=X` — media + complaint
   show in the cockpit (3-panel briefing).
6. **Stage 5 check:** you (and the assigned tech) get the bundle SMS with the
   cockpit deep-link.
7. **Stage 6 check:** the TDR / `jobs.problem_summary` reflects the customer's
   complaint; tech-ant-chat pre-fills from it.

**Claude can verify the Xano-side at each stage** (query the job/customer/
event_log/attachments) — just trace it with me live and I'll confirm each
record landed or flag the break.

## Then the go-live decision

Once the trace passes clean → **flip `CUSTOMER_FACING_ENABLED=true`** (scoped to
parallel-mode jobs as the blast-radius gate). That turns stage 2 on for real
customers → the whole pipeline runs for live email jobs. Watch `event_log` for
the first real customer bundle.

## How it sits in the week (full sequence)

- **Wed night (home):** PHONES — `disable=all`, test calls connect to Ant.
  Stop dropping customers. (The one true fire.)
- **Thu AM:** deploy the XS queue — `transition_job_state` (scheduler),
  `lookup_customer_by_phone` (agent-can't-find-them fix),
  `danielle_schedule_parallel_job`, `merge_call_note_into_problem_summary`,
  `record_scheduler_shadow_run`. Confirm each returns 200.
- **Thu:** (a) scheduler placement probe → techs-only flip; (b) the intake
  pipeline controlled trace above.
- **Fri:** if trace clean → flip `CUSTOMER_FACING_ENABLED` for parallel-mode →
  intake go-live. Watch one real day (scheduler + intake). 
- **All week:** phones bulletproof; monitor.

The thread tying it together: every one of these — reliable phones, the intake
pipeline flowing, the scheduler placing — is a **responsiveness metric** for the
November AHS story. The week's work IS the proof deck.

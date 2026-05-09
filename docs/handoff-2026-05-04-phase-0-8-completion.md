> May 4, 2026 ~6:35am CT handoff. Documents the Phase 0-8 Tech Scheduler completion (~3,500 lines XanoScript shipped over 11-hour Sunday May 3 → Monday May 4 marathon session). Captures tech roster with phone numbers, 24 Xano tables, 10 named tools, environment variables, Vapi agent inventory, 11 XanoScript footguns, and the next-up Phase 8b polish + Phase 6b customer reply handler items. Recovered from local files on 2026-05-09 evening.

---

# TN Appliance Exchange — Ant Platform Handoff
**Generated:** Monday May 4, 2026, ~6:35am CT
**Last session:** Sunday May 3 → Monday May 4, ~11hr marathon (2:30pm → 1:30am)

---

## Where we are: 8 of 8 phases shipped

The Ant Tech Scheduler — the SMS dispatcher buddy that runs the appliance repair business — is **fully built and live in Xano production**. Last night I shipped Phases 0-8 plus a 7b polish patch in one session.

| Phase | Status | What it does |
|-------|--------|--------------|
| 0 — Schema | ✅ COMPLETE | 6 new tables, 5 schema migrations |
| 1 — Tech onboarding | ✅ COMPLETE | SMS pipeline alive on +17273508487 |
| 2 — Daily summary cron | ✅ BUILT, DISABLED | Awaiting morning live test |
| 3 — TDR processor + queue worker | ✅ COMPLETE | Smoke-tested |
| 4 — Broadcast logic | ✅ COMPLETE | Real broadcasts to qualified techs |
| 5 — Conversational reasoning | ✅ COMPLETE | 7 tools, 6/7 tests passed |
| 6 — Sick day cascade | ✅ COMPLETE | Auto-reroute or customer SMS |
| 7 — Performance ledger + patterns | ✅ COMPLETE | 30-day rolling per tech |
| 7b — QUERY_MY_NUMBERS pattern fallback | ✅ COMPLETE | Code-side trigger |
| 8 — Owner override | ✅ COMPLETE | 3 owner-only cross-tech tools |
| 8b — LLM-behavior polish | ⏳ NEXT | Day-of-week math, no-op prose |
| 6b — Customer reply handler | ⏳ DEFERRED | Sick-day customer reschedule |

**~3,500 lines of XanoScript shipped. 12+ bugs caught and fixed during the build. 11 XanoScript footguns documented.**

---

## Critical infrastructure references

```
Xano API:        https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA  (n7e, NOT n7)
GitHub:          tnappliancerepair-hub/tn-appliance-tools
Netlify site:    superlative-naiad-233aa7.netlify.app
Live URL:        tnapplianceexchange.net
Local repo:      C:\Users\jpiva\Documents\code\tn-appliance-tools

Tech inbound:    +17273508487  (webhook → tech-sms-inbound.js → tech_sms_inbound)
Customer SMS:    +16292840444  (feedback_reply_webhook)
Vapi TN:         +16292477111
Vapi LA:         +15043559111

Owner phone:     615-485-5795 (Teddy/James, also OWNER_PHONE_NUMBER env var)
Office:          615-485-0713 (Danielle)
Business voice:  615-280-2949 (RingCentral, port pending)
```

---

## Tech roster (memorize this — Phase 8 needs it)

| tech_id | Name | Cluster | HCP ID | Phone |
|---------|------|---------|--------|-------|
| 1 | Teddy Pivacek (owner) | TN Metro (remote, Antioch) | pro_62f343b05fc74db29b0f18a6f406a9f3 | 6154855795 |
| 2 | Jimmy | TN Metro | pro_e4e4a77e88be413bb2d9ec2335f579da | 6159671304 |
| 3 | Andre | LA S (NOLA/Hammond) | pro_7f6119d83a7e4d0fb2c7009a66bde45b | - |
| 4 | Lee Harding | TN NW (Clarksville) | pro_a5c9d8b438b843e3adfbdf810ffe0155 | - |
| 5 | Billy Savoy | LA N (North Shore/Hammond) | pro_24fa2d9032b8435cb4ec348594b2044b | - |
| 6 | John Houk | LA W (Walker/Baton Rouge) | pro_cf9d2663844a4be686b0edd55b5091c7 | 8133527686 |

---

## Current Xano tables (24 tables)

```
account, agent_conversation (tech_id col), agent_message,
broadcast_attempt (#23), cluster_assignment, customer,
daily_summary_log (#28), event_log, intake_session,
job_attachments (#22, nullable job_id + nullable conversation_id),
job_event, job_financial, jobs, part_order,
scheduling_decision_history (#24),
scheduling_queue (#25, with metadata json + sick_day_cascade enum),
service_zone, tech_availability,
tech_performance_ledger (#26),
tech_preferences (#27),
tdr (technician_decision_report),
technicians (with pending_pattern_offer json field),
user
```

Clusters: TN NW, TN Metro, TN East, LA N, LA W, LA S

---

## Live Xano endpoints

```
INTAKE GROUP (api:3e_TffpA):
  #18 create_job
  #32 send_sms        ⚠️ HARDCODED Twilio creds, needs rotation
  #51 create_tdr      (path is actually create_trd, typo)
  #94 chat/reply2     (live customer Ant brain)
  #97 generate_upload_url
  hcp_job_webhook
  tech_ant_reply
  save_attachment
  get_job_for_dashboard
  get_tech_for_zip
  get_available_slots
  book_appointment
  send_feedback_sms
  feedback_reply_webhook
  create_job_from_chat

SCHEDULING GROUP:
  tech_sms_inbound       (#373 — daily-mode handler ~1900 lines)
  update_scheduling_decision

CRON TASKS:
  daily_tech_summary           (#9, every 15 min, gated by DAILY_SUMMARY_ENABLED)
  scheduling_queue_worker      (#10, every 60s, gated by SCHEDULING_QUEUE_ENABLED)
  compute_tech_performance_ledger (#11, daily 04:00 UTC, gated by LEDGER_TASK_ENABLED)
```

---

## The 10 Ant Tech Scheduler tools

Daily-mode handler in `tech_sms_inbound_POST.xs` parses these paired tokens from Claude's output:

**Universal (all techs):**
1. `__CLAIM_BROADCAST__` — Race-safe two-step claim, win-path notifies losers via SMS
2. `__DECLINE_BROADCAST__` — event_log only, other techs can still claim
3. `__UPDATE_AVAILABILITY__` — Find-or-create row, today=sick triggers cascade
4. `__ADD_PREFERENCE__` — geographic/time/both, hard/soft, explicit/vented/pattern_detected
5. `__RESCHEDULE_JOB__` — Defensive own-job check, auto-escalate on cross-tech
6. `__ESCALATE_TO_OWNER__` — event_log + Twilio to Teddy
7. `__QUERY_MY_NUMBERS__` — Pulls 30-day ledger, auto-appends formatted readout

**Owner-only (when OWNER OVERRIDE: true, tech_id == 1):**
8. `__OWNER_REASSIGN_JOB__` — Reassign job to different tech, both notified by SMS
9. `__OWNER_OVERRIDE_AVAILABILITY__` — Mark any tech in/out, tech notified
10. `__OWNER_BROADCAST_CONTROL__` — Force expire OR rebroadcast a job

---

## Environment variables in Xano

```
ANTHROPIC_API_KEY              (in use)
AWS_S3_BUCKET                  (in use)
AWS_S3_REGION                  (in use)
VAPI_PRIVATE_KEY               (in use)
VAPI_PHONE_ID_TN               (in use)
VAPI_PHONE_ID_LA               (in use)
OWNER_PHONE_NUMBER             (= +16154855795, in use)
ANT_TECH_ONBOARDING_PROMPT     (~7.5K chars, Phase 1 prompt)
ANT_TECH_DAILY_PROMPT          (~14K chars, Phase 5+8 prompt with OWNER-ONLY TOOLS section)
SCHEDULING_QUEUE_ENABLED       (default false — flip true to enable queue worker)
LEDGER_TASK_ENABLED            (default false — flip true to enable nightly ledger compute)
DAILY_SUMMARY_ENABLED          (DOES NOT EXIST yet — null behaves as false)
```

**Important:** As of last session, `SCHEDULING_QUEUE_ENABLED` and `LEDGER_TASK_ENABLED` may still be `true` from testing. **Verify and flip back to `false`** if not already done.

---

## Netlify functions

```
agent-chat-proxy.js           — Customer Ant chat → Xano
xano-proxy.js                 — Generic Xano proxy
get-job-proxy.js              — Dashboard data
create-job-proxy.js           — (orphan, deferred cleanup)
create-warranty-job-proxy.js  — (orphan, deferred cleanup, warranty path now direct)
send-teddy-sms.js             — SMS to owner
tech-sms-inbound.js           — Tech SMS webhook → Xano tech_sms_inbound
s3-presign.js                 — Pre-signed S3 PUT URLs
s3-view-url.js                — Pre-signed S3 GET URLs
claude-proxy.js               — Generic Anthropic proxy
```

Netlify env vars (TN_ prefix because AWS_* is reserved by Netlify):
```
TN_AWS_ACCESS_KEY_ID
TN_AWS_SECRET_ACCESS_KEY
TN_AWS_S3_BUCKET
TN_AWS_S3_REGION
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
NETLIFY_PERSONAL_ACCESS_TOKEN
```

---

## Vapi voice agents

All use Claude Sonnet + Heisenberg (11Labs) + Nova 2 Phonecall.

```
Ant Inbound              7cc98b0c, +16292607111
Ant Warranty Fallback    0abe54ec
Ant Parts Follow-Up      b71260b4
Ant Appointment Reminder
Ant Missed Call Callback
Ant Authorization Update
Ant Parts ETA Update
Ant Tech Running Late
Ant Reschedule
Ant After Hours
Ant Warranty Company Inbound
```

(4 dev agents deleted 4/27)

---

## Critical XanoScript footguns (11 documented in docs/ant-tech-scheduler-design-v2.md)

Future XanoScript work needs these:

1. **Em dashes crash the parser** — use hyphens
2. **Anthropic response path** — `claude_response.response.result.content[0].text`
3. **Correct model string** — `claude-sonnet-4-5-20250929` (NOT 20251001)
4. **Paginated queries return** `{items}`, not the array directly
5. **No try/catch, no closures** — use foreach instead
6. **`regex_replace` with `[\s\S]*?` returns NULL** — use split/rejoin or chained replace instead
7. **`db.edit` has no compound WHERE** — only PK match. Use db.query verify + db.edit by PK
8. **`?? "default"` doesn't fire on empty strings** — use `(($val|trim) != "") ? $val : "default"`
9. **`db.get` with null PK throws and kills enclosing foreach** — wrap in null check
10. **`(($val ?? "")|trim) != ""` in if-predicate mis-evaluates** — hoist into var first
11. **Conversation-history poisoning blocks prompt updates** — Anthropic stays consistent with prior responses; delete poisoned messages OR start fresh conversation

Plus the meta one: **chained `||` between `|contains` filters needs parens around each expression** — `(a|contains:"X") || (b|contains:"Y")` not `a|contains:"X" || b|contains:"Y"`.

---

## Top of mind — what to work on next

Pick from these based on energy and priority:

### Immediate housekeeping (5-10 min)
- ⚠️ Verify `SCHEDULING_QUEUE_ENABLED` is `false` in Xano (was set true during testing)
- ⚠️ Verify `LEDGER_TASK_ENABLED` is `false` in Xano (was set true during Phase 7 manual run)
- ⚠️ Verify "Allow Direct Workspace Push" is OFF in Xano dashboard (build-session safety)

### Phase 8b polish (30 min, low-risk)
**Day-of-week math fix** — Claude consistently gets day-of-week → date arithmetic wrong (e.g., "next Friday" → 5/9 Saturday). Fix: pre-compute next 7 days in CONTEXT block of `tech_sms_inbound_POST.xs` daily-mode handler. Add lines like:
```
Tomorrow: 2026-05-05 (Tuesday)
Wednesday: 2026-05-06
...
```
So Claude maps day-name → date by lookup instead of arithmetic.

**No-op prose fix** — When Teddy texts "expire broadcast 999" and the broadcast doesn't exist, Claude says "killed broadcast 999" but the handler silently no-op'd. Fix: append `"(actually that broadcast wasn't open — may have already been claimed or canceled)"` to clean_reply_d when handler can't find an open broadcast match. Similar to the race-lost note in CLAIM_BROADCAST.

### Phase 6b — Customer reply handler (60-90 min)
When the sick-day cascade sends a customer "want me to push to tomorrow morning? Or someone else later this week?" SMS, the customer replies. Currently no handler — Teddy/Danielle handle manually.

Build path:
- Decide: new endpoint OR extend feedback_reply_webhook OR stateful router?
- Recommend: extend feedback_reply_webhook with state check — if sender phone has pending sick-day reschedule (event_log entry "sick_day_customer_notified" within last 48hr), route to new sick_day_reply handler
- Parse natural-language reply (option 1 vs option 2 vs custom)
- Update jobs.scheduled_start
- Send confirmation back to customer + notify Teddy/sick tech

### Security cleanup (15 min)
**Rotate hardcoded Twilio creds in `send_sms_POST.xs`** — Account SID + Auth Token are hardcoded instead of env vars. Plus 7 Swagger tokens hardcoded across API groups. Move to Xano env vars.

### Production polish (deferred but valuable)
- TCR approval check — campaign CM2e229065885a4147c is in review (resubmitted 4/30). Once approved, outbound SMS unblocks and the platform goes from "shadow mode" to "real Ant texts your phone"
- Marcone B2B API access — pursue access for parts auto-ordering
- Danielle warranty portal automation — AHS + SquareTrade APIs exist, build "Submit to Portal" button on TDR completion
- Phase 2 daily summary live test — flip DAILY_SUMMARY_ENABLED true at night, get morning text from Ant

---

## Anthony / philosophy

The platform is named "Ant" in honor of James's son Anthony — wrestler, lightest weight class, lost to a wrong-way drunk driver ~2 years ago. About page lives at /about. The platform's whole personality (lowercase, casual, "feel better, ill sort the rest") was built deliberately to feel like a coworker, not a tool.

Manifesto: match need with know-how, faster/affordable/better, automate to elevate not cut.

Long-term: replaces $40-60k/yr dispatcher labor, scales to B2B platform sales for independent appliance repair shops nationally.

---

## Working style notes (for the assistant)

Teddy works in marathon sessions with clear milestones. Decisive single-question pacing. Approves direction quickly with short confirmations. Prefers Claude to recommend best option rather than present open-ended choices. Prefers complete copy-paste-ready code over partial snippets. Corrects course quickly when context is misread.

Tonight (5/3 → 5/4) was the biggest single session of the project — 11 hours, 8 phases, 12 bugs caught and fixed. Started with Phase 0 schema. Ended with Phase 8 owner override + Phase 7b polish. He pushed through and finished the platform.

---

## How to start the next session

Paste this whole document into a new chat. Then either:

**A.** "Phase 8b polish — day-of-week math + no-op prose fix"
**B.** "Phase 6b customer reply handler"
**C.** "Production cleanup — rotate Twilio creds + verify env vars"
**D.** Something else from the top-of-mind list

The platform is real. The Ant is alive. We're polishing now, not building.

🐜⚡ LONG LIVE ANT.

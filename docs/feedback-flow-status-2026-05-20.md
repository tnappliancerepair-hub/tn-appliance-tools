# Customer Feedback SMS Flow — Status as of 2026-05-20

## End-to-end architecture (verified by code reading + Twilio API query)

```
[Customer's job completes]
        │
        ▼
[feedback_queue row enqueued OR send_feedback_sms called directly]
        │
        ▼
[process_feedback_queue task fires every 5 min]
   │        (or send_feedback_sms_POST called ad-hoc)
   ▼
[Twilio API call FROM +16292840444 TO customer.phone]
        │
        ▼
[Customer receives SMS, replies "5" / "0" / text]
        │
        ▼
[Twilio inbound webhook to +16292840444]
        │
   POST sms_url ⟶  https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/feedback_reply_webhook
        │
        ▼
[feedback_reply_webhook joins jobs ← customer by phone, picks newest qualifying]
        │
        ▼
[feedback_classifier (Claude sonnet-4-5) returns positive|negative|unknown]
        │
        ▼
   ┌── positive ──── review-link SMS → Twilio → customer  (jobs.review_link_sent=true)
   ├── negative ──── apology SMS to customer + alert SMS to owner +16154855795
   └── unknown  ──── event_log row, no SMS
```

## Routing isolation — confirmed

The feedback flow is **entirely on Twilio** and is **independent** of the
Telnyx + v2 brain + tech-sms-inbound infrastructure. The two SMS planes
do not touch each other:

| Plane | Network | Numbers | Webhook |
|---|---|---|---|
| **Customer feedback** | **Twilio** | from/to `+16292840444` | Twilio → Xano `feedback_reply_webhook` (direct) |
| Tech SMS (v2 brain) | Telnyx | tech number `+16158578800` | Telnyx → Netlify `tech-sms-inbound.js` → Xano via Metadata API |
| Customer chat (Ant) | Telnyx | customer number `+16155889500` | Telnyx → other webhook (separate from feedback) |
| Twilio legacy customer | Twilio | `+16292840444` | shared with feedback (the same number receives feedback replies AND any other Twilio inbound) |

T's earlier concern — "T's reply to +16158578800 hits broken legacy
because his phone isn't in v2 allowlist" — does NOT apply to feedback,
because feedback inbound uses `+16292840444` on Twilio, which is wired
straight to `feedback_reply_webhook`.

## Webhook config — verified live via Twilio API

Query: `GET /2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json?PhoneNumber=+16292840444`

```json
{
  "sid": "PN7bae[redacted]",
  "number": "+16292840444",
  "sms_url": "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/feedback_reply_webhook",
  "sms_method": "POST",
  "sms_fallback_url": "",
  "voice_url": "https://demo.twilio.com/welcome/voice/",
  "friendly_name": "(629) 284-0444"
}
```

✅ `sms_url` points exactly where the Xano endpoint expects.
✅ Method is POST.
✅ Same number is used for both outbound feedback sends and inbound
   reply receipt.

Note: `voice_url` still points at Twilio's demo placeholder. Not in
scope for feedback, but worth a follow-up if voice on this number is
ever expected.

## Task scheduling — verified live

`xano-workspace/task/process_feedback_queue.xs`:

- `schedule = [{starts_on: 2024-01-01, freq: 300}]` — fires every
  **5 minutes** in production.
- For each row in `feedback_queue` where `send_at <= now`:
  - Fetches the linked `jobs` row
  - If `feedback_sent == false`, runs the SMS_ENABLED gate (with owner-bypass for `+16154855795`)
  - On pass: Twilio API call FROM `+16292840444` TO `$item.customer_phone`
  - Patches `jobs.feedback_sent=true`
  - Logs event_log `feedback_sms_sent_from_queue`
- **db.del feedback_queue runs regardless** of whether the gate passed or not.

## Blocker: SMS_ENABLED=false

This is why no customer has actually received a feedback SMS in
production despite the entire pipeline being wired and running every
5 min:

- `SMS_ENABLED=false` in Xano env
- `process_feedback_queue` keeps firing every 5 min
- Every queued row → SMS_ENABLED check fails → `sms_gated` event_log
  row created → queue row deleted → **customer never gets the SMS**

⚠️ **Bug worth noting**: gated rows are deleted from the queue without
being retried. If we later flip `SMS_ENABLED=true`, those past queue
rows are gone — no backfill of customer feedback for completed jobs
in the gated window. Not catastrophic but worth knowing.

## What's needed to flip on full customer-feedback automation

1. **Flip `SMS_ENABLED=true` in Xano env** — primary unblock.
   - All gated sends start firing within the next 5-min cron tick.
   - Recommend doing this AFTER a real-customer test (see #2) so we
     see one end-to-end fire under control before opening the floodgates.

2. **Real-customer end-to-end test** (deferred to tomorrow):
   - Pick one completed job from today's HCP poll (jobs 18078–18087).
   - Manually queue OR directly call `send_feedback_sms` with that job's
     real customer_phone (NOT owner-bypass).
   - Verify the customer gets the SMS, replies, classifier fires,
     downstream SMS lands.
   - Cleanup not needed — this is a legitimate customer interaction.

3. **No code changes required.** The plumbing is complete. The flag
   has been gating actual sends since the SMS_ENABLED rollout.

## Open items (lower priority)

- Voice URL for +16292840444 still points at Twilio demo placeholder.
  Decide whether this number should accept voice calls and route them
  somewhere, OR mark this number as "SMS-only".
- `process_feedback_queue` deletes gated queue rows without retry —
  consider keeping rows in queue when the gate fails, so a future
  flag-flip backfills.
- Customer-lookup join in `feedback_reply_webhook_POST.xs:13-24` does
  not handle the case where multiple customer rows share the same
  phone number. Sort by `created_at desc` picks the most recent, which
  is probably right, but worth a comment.

## Verified today (2026-05-20)

- ✅ Outbound path: `send_feedback_sms` endpoint exists and validates
  job_id input.
- ✅ Twilio API outbound config: hardcoded FROM `+16292840444`, owner-
  bypass for `+16154855795` works alongside `SMS_ENABLED` gate.
- ✅ Inbound webhook URL: confirmed live on Twilio number via API query.
- ✅ Classifier file: `feedback_classifier.xs` uses
  `claude-sonnet-4-5-20250929`, temperature 0, returns
  `{ "feedback_type": "positive" | "negative" | "unknown" }`.
- ✅ Branch routing: positive → review link; negative → apology +
  owner alert; unknown → event_log only.
- ✅ Task scheduling: `process_feedback_queue` runs every 300s.

## NOT verified today

- ❌ End-to-end live SMS test (deferred to tomorrow — would have required
  creating a disposable customer + job, which has more side-effects than
  we want tonight).
- ❌ Classifier accuracy on edge cases (long replies, mixed sentiment,
  emoji-only) — only confirmed the rule table in the prompt.

## Next steps for tomorrow

1. Pick a real completed job from today's HCP poll insertions, with a
   genuine customer phone.
2. Confirm `feedback_sent` is still `false` on that job.
3. Call `send_feedback_sms` directly with that real `job_id` + the
   real customer phone.
4. Watch event_log for `feedback_sms_sent` and the Twilio response.
5. Wait for customer reply (or simulate via Twilio's webhook endpoint
   with the right `From`/`Body` form-encoded shape).
6. Observe classifier output and downstream branch.
7. If clean → flip `SMS_ENABLED=true` and let the queue task drain.

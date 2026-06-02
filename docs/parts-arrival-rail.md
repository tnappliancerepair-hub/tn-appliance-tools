# Parts arrival rail — 4 paths to one trigger

Every path funnels into the **canonical `mark_parts_arrived` endpoint**.
That endpoint flips `jobs.parts_status='arrived'`, clears
`parts_eta_date`, writes a `parts_marked_arrived` event_log row, and
emits a `PARTS_ARRIVED` colony_signal. Two agents listen:

- `parts_arrived_quick_schedule.js` → SMSes the tech (scheduler
  deep-link) + Teddy (parallel notification). 24h per-job dedup.
- `parts_arrived_customer_notify.js` → SMSes the customer (gated by
  `CUSTOMER_FACING_ENABLED`). Channel-preference-aware: portal-users
  get a short SMS pointing to the portal; SMS-users get the full
  info inline. See `channel.js`.

Customer portal renders a celebration state when a job is in
`scheduling_status='awaiting_parts'` AND `parts_status='arrived'`.

## Path A — Internal (Danielle / Teddy)

Office click of "Parts Arrived" in `/needs-scheduled` or
`/warranty-review` → `POST /mark_parts_arrived {job_id, source:"internal", notes}`.

## Path B — Customer self-service

`/customer-portal.html` shows a "📦 My parts arrived" button when the
job is in `awaiting_parts` AND `parts_status != "arrived"`. Tap → confirm prompt → `POST /customer_mark_parts_arrived {job_id, phone_last4}`
which auth-checks phone last 4 then writes the same atomic flow with
`source:"customer_portal"`.

## Path C — Vendor API (future: Marcone / Tribles Appliance Parts)

When the Marcone or Tribles Appliance Parts APIs land (CLAUDE.md "Pending external
integrations" section), wire a Mac Mini poller that calls
`POST /record_parts_delivery_observation` (NOT `mark_parts_arrived`
directly) with the order_number it knows from the API. The handler
agent decides whether to auto-fire or escalate.

## Path D — Email parser (`parts-vendor-gmail-poller.js`)

Netlify scheduled function (every 30 min) scans the same Gmail inbox
the AHS/SP pollers use for delivery-notification emails:

- Marcone (`from:marcone.com subject:delivered`)
- Tribles Appliance Parts (`from:triplesstore.com subject:delivered`)
- Reliable Parts (`from:reliableparts.com subject:delivered`)
- FedEx (`from:trackingupdates@fedex.com subject:delivered`)
- UPS (`from:mcinfo@ups.com subject:delivered`)

Each matched message is extracted (vendor, tracking number, order
number, recipient zip when carrier supplies it) and POSTed to
`/record_parts_delivery_observation`. The processed message gets the
`PartsDelivery-Processed` Gmail label so it's never re-scanned.

Shares `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`
env vars with the existing AHS/SP pollers. When the OAuth refresh token
needs re-minting (e.g. the `invalid_grant` symptom that has hit
AHS/SP in the past), all three pollers come back online together.

## Matcher: `parts_delivery_observed.js`

Fires on `PARTS_DELIVERY_OBSERVED` signal. Pulls the open
awaiting_parts queue via `list_awaiting_parts_jobs` and scores each
job against the observation hints:

| Signal | Score |
|---|---|
| `order_number` exact | +100 |
| `customer_name` exact (≥95% token overlap) | +80 |
| `customer_name` fuzzy (≥85% token overlap) | +50 |
| `part_number` exact | +40 |
| `model_number` exact | +30 |
| `customer_zip` prefix (first 5 digits) | +25 |

Decision:

- **Exactly one job with score ≥ 80** → auto-fire `mark_parts_arrived`
  with `source` set to the originating channel (e.g. `gmail_marcone_delivered`).
- **Zero or 2+ confident matches** → SMS Teddy with extracted details
  and the top 5 candidate jobs. He picks the right one in the office
  calendar (Parts Arrived button on that job).

The matcher never edits jobs directly — always routes through
`mark_parts_arrived` so the audit trail is consistent across all
four paths.

## Endpoints

- `mark_parts_arrived_POST` (Path A canonical)
- `customer_mark_parts_arrived_POST` (Path B — auth-checked)
- `record_parts_delivery_observation_POST` (Paths C + D entry)
- `list_awaiting_parts_jobs_GET` (matcher input)

## Channel preference

`get_customer_channel_preference_GET` returns `prefers: 'portal' | 'sms' | 'unknown'`
based on 60d of `portal_action_taken` / `portal_viewed` vs
`sms_reply_received` / `portal_link_unread` events. `channel.js`
exposes `composeForChannel({customerId, intro, inlineDetail, portalUrl, portalActionLabel})`
which any customer-direction agent can use to compose the SMS body.

Portal-side write sites:

- `customer-portal.html` calls `record_portal_event` with
  `portal_viewed` on load and `portal_action_taken` on every button
  tap (parts arrived / rated visit / add notes / reschedule).

SMS-side write sites:

- `record_inbound_customer_sms_POST.xs` writes `sms_reply_received`
  whenever an inbound text matches a known customer.

`portal_link_unread` (negative signal) is not yet wired — it would
need a reminder agent that tracks "we sent a portal link X hours ago,
customer hasn't viewed it." Future improvement.

## Operator todos

1. Build `list_awaiting_parts_jobs_GET` in Xano workspace (CLI push).
2. Build `record_parts_delivery_observation_POST` (CLI push).
3. Build `get_customer_channel_preference_GET` (CLI push).
4. Build `record_portal_event_POST` (CLI push).
5. Edit `record_inbound_customer_sms_POST` in Xano UI to add the
   `sms_reply_received` event row (the patch is in the .xs file).
6. Deploy `parts-vendor-gmail-poller.js` (push to main; Netlify picks
   it up automatically — runs every 30 min once cron schedule is set).
7. When `EMAIL_INTAKE_ENABLED=true` is flipped on (per the morning
   brief), this poller is independent — it can run regardless.

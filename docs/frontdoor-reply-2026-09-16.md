# Reply to Frontdoor — 2026-09-16

**Thread:** "Testing – Please Verify Inbound and Outbound Updates" (started Akshay Kyatam, Aug 24)
**Reply to:** Vaibhav Parashar (vaibhav.parashar@frontdoor.com), 2026-09-16 7:36 AM — *"The issue
with Sandbox instance is fixed. Can you please check again and let us know if you are still having
issues?"*
**Cc on the live thread:** Brian Bullock (Brian.Bullock@ahs.com), Akshay Kyatam, Adarsha Dash

> ⚠️ **NOT SENT.** Teddy sends this one. He emailed the thread himself at 12:50 AM on 9/16, and the
> last time an API send raced a manual send Akshay got the same message twice. One sender at a time.

> ⚠️ **Vocabulary:** Frontdoor's "inbound"/"outbound" are the OPPOSITE of ours. The draft below uses
> explicit arrows and never uses either word. Do not "clean that up."

---

## Everything in the draft, verified live 2026-09-16 (not from notes)

| Claim in the draft | How it was measured | Result |
|---|---|---|
| Their fix worked | `frontdoor-probe?secret=…` → `POST /dispatch-connector/v1/webhook` | **500 `CONNECTOR_BLE_0007`**, not the old empty 404 |
| Same result through the real connector | `frontdoor-test?secret=…&push=1&dispatch=22863999` | identical error + `request_id b20301c5-…` |
| Frontdoor → our webhook still flowing | `list_recent_event_log?action=frontdoor_webhook_event&days_back=4` | **70 events, 23 distinct dispatch ids**, latest 2026-09-15 5:52 PM CT |
| Sandbox stream is not addressed to us | vendor_id distribution across those 70 | `1396202` ×15, `157992` ×14, `1636528` ×2 — **none of our three** |
| Wrong geography for us | state distribution | VA ×27, TX ×2, TN ×2 |

Our vendor ids are **822418** (North Shore LA), **822218** (South Shore LA), **839828** (Middle TN).

---

## Draft

**Subject:** Re: Testing – Please Verify Inbound and Outbound Updates

Hi Vaibhav,

Thank you — that fixed it. I re-tested both directions this morning. Here is exactly where we stand.

**Frontdoor → our webhook: confirmed, we are receiving you.** Over the last four days our log shows
70 events across 23 distinct dispatch ids, most recently 2026-09-15 at 5:52 PM Central. Nothing is
being dropped on our side.

**TN Appliance Exchange → your dispatch-connector: your fix cleared the blocker we reported.** Until
today, every path under `/dispatch-connector/` on the sandbox host returned an empty-bodied 404 with
our token. As of this morning the endpoint is processing our request and returning a specific
application error instead:

```
POST https://api.sandbox.frontdoorhome.com/dispatch-connector/v1/webhook
500  {"error":{"code":"CONNECTOR_BLE_0007","message":"Failed to unmarshal struct to JSON string"}}
     request_id : b20301c5-bf7f-4936-9516-22452d65c3a2
     timestamp  : 2026-09-16T13:25:48Z
```

So authentication and routing are both working now, and the only thing left is the request body.
That is where I could use your help.

This is the exact payload we send, built from the spec we were given:

```json
{ "data": [ { "type": "status", "object": {
  "source": "TN_APPLIANCE_EXCHANGE",
  "tenant": "AHS",
  "dispatch_id": 22863999,
  "vendor_id": "822418",
  "description": "Technician in Route to Location",
  "status_code": 70,
  "note": "Ant connectivity test - ignore",
  "updated_at": "2026-09-16T13:25:48Z",
  "start_time": "2026-09-16T13:25:48Z",
  "end_time": "2026-09-16T13:25:48Z"
} } ] }
```

Could you look up `request_id b20301c5-bf7f-4936-9516-22452d65c3a2` and tell me which field it is
rejecting? Two guesses, in case either is a quick yes or no:

1. Should `object` be a nested JSON object as above, or a JSON-encoded string?
2. Is the `items` array required? Your spec example includes it; we omit it when a job has no line
   items.

Either way I can re-test within minutes of hearing back.

**One thing to sort out before production.** The sandbox updates we are receiving are not addressed
to us — across those 70 events the vendor ids are 1396202, 1636528 and 157992, and 27 of the
dispatches are in Virginia. None carry our vendor ids (822418, 822218, 839828), and none are in our
service area of Middle Tennessee and Louisiana. That is harmless in sandbox and we are deliberately
running our receiver in validate-only mode because of it, but I want to confirm before we cut over:
in production, will the feed to our webhook be filtered to our vendor ids only?

Once that is confirmed and the payload question is answered, we are ready to move to production and
will send production webhook credentials.

Thanks again for turning this around quickly.

James Pivacek
TN Appliance Exchange LLC

---

## What changes on our side after this goes out

- **Do NOT set `FRONTDOOR_WEBHOOK_LIVE=1`.** Reinforced, with a better reason than before: the
  sandbox stream is not just test data, it is **other partners' dispatches**. Going live on this feed
  would create jobs for vendors that are not us, in states we do not serve.
- The payload hypotheses are now testable in one shot: **`frontdoor-probe?secret=<admin>&shape=all`**
  sends the same status update as `spec` / `items` / `strobj` (object as a JSON string) / `bare` (no
  `data[]` envelope) and reports each status plus their error code side by side. Run it the moment
  they answer — or before, if we want to beat them to it.
- `frontdoor-push-status` now accepts an optional `items` array, so if the answer is "items is
  required" it is a caller-side flip, not a code change.
- **Hygiene:** `FRONTDOOR_WEBHOOK_TOKEN` is written out in full in `CLAUDE.md`, which is committed.
  It only authorizes writes into our own dark receiver, so the blast radius is small, but it belongs
  in the vault only. Worth rotating when we issue the production token anyway.

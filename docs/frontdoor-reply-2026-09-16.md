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

## THE HEADLINE — we are through. Both directions work.

**TN Appliance → Frontdoor returns `HTTP 200 {"errors":null}`.** Their sandbox fix cleared the wall,
and the remaining blocker turned out to be that **their published spec documents a different request
envelope than their connector accepts.** Fifteen days of correct-per-the-doc payloads were dying at
unmarshal for that reason alone.

### The ladder, one validator error at a time (all measured live, 2026-09-16)

| Body we sent | Their answer |
|---|---|
| `{ data: [ { type, object } ] }` ← **their published spec** | `500 CONNECTOR_BLE_0007` Failed to unmarshal struct to JSON string |
| `{ data: { type, object } }` (object, not array) | `400 CONNECTOR_BLE_0042` Type Missing in request |
| `{ type, data: {…} }` (type hoisted to top level) | `400 CONNECTOR_BLE_0048` ExternalID Missing |
| + `external_id` **inside** `data` | `400 CONNECTOR_BLE_0049` Message Missing |
| + `message` as a **string** | `400 CONNECTOR_BLE_0050` Status Missing |
| + `status` as a **string** | ✅ **`200 {"errors":null}`** |

### The envelope their connector actually accepts

```json
{
  "type": "status",
  "data": {
    "external_id": "22863999",
    "message": "Jimmy is on the way",
    "status": "Technician in Route to Location",
    "status_code": "70",
    "vendor_id": "822418",
    "tenant": "AHS",
    "source": "TN_APPLIANCE_EXCHANGE",
    "updated_at": "2026-09-16T13:4x:xxZ"
  }
}
```

Load-bearing, each one measured rather than guessed:
- `type` is **top level**. Nested inside `data` → `BLE_0042`.
- `external_id` is **inside `data`**. At top level (snake, camel or Pascal) → `BLE_0048`.
- `message` and `status` must be **non-empty strings**. An object or a bare number → `BLE_0007`.
- Extra fields alongside that minimum are tolerated, so the note, numeric code and vendor id ride along.

---

## Verified live 2026-09-16 (not from notes)

| Claim | How it was measured | Result |
|---|---|---|
| Their sandbox fix worked | `frontdoor-probe?secret=…&shape=all` | past auth + routing, into their validator |
| The accepted envelope | 24-row shape matrix against `/dispatch-connector/v1/webhook` | `ok_desc`, `ok_plus`, `ok_note`, `ok_vendor` all **200** |
| Confirmed via the real connector, not the probe | `frontdoor-test?secret=…&push=1&dispatch=22863999` | `http_status 200`, `{"errors":null}` |
| `status` must be a string | `st_obj` (object) and `st_code` (number) vs `st_desc` / `st_codestr` | objects/numbers **500**, strings **200** |
| Frontdoor → our webhook still flowing | `list_recent_event_log?action=frontdoor_webhook_event&days_back=5` | **89 events, 32 distinct dispatch ids** |
| Sandbox stream is not addressed to us | vendor_id distribution across those events | `1396202`, `157992`, `1636528` — **none of our three** |
| Not a dispatch-specific failure | `shape=bare` against `999999999`, `22941139`, `22928169` | identical `BLE_0009` for all three |

Our vendor ids are **822418** (North Shore LA), **822218** (South Shore LA), **839828** (Middle TN).

---

## Two questions left — both cheap for them to answer

1. **Which value belongs in `status`?** Both the description string
   (`"Technician in Route to Location"`) and the code as a string (`"70"`) return 200, so their
   validator accepts either and we cannot tell from the outside which one their system actually
   reads. We are sending the description. **If it should be the numeric code, say so and it is a
   one-word change on our side.**
2. **Will the production feed be scoped to our vendor ids?** Every dispatch id we tried — including
   real ones from their own sandbox stream — failed dispatch lookup identically, and the sandbox
   events carry vendor ids that are not ours, mostly Virginia addresses. That is consistent with a
   shared sandbox rather than a problem, but we want it confirmed before go-live.

**Honest caveat we should state rather than hide:** `200 {"errors":null}` means *accepted*. We have
no read-back, so we cannot independently confirm the status actually landed on the dispatch. Worth
asking them to eyeball one.

---

## Draft

**Subject:** Re: Testing – Please Verify Inbound and Outbound Updates

Hi Vaibhav,

Thank you — that fixed it, and we are through on both directions. Here is exactly where we stand.

**Frontdoor → TN Appliance: confirmed.** Over the last five days our log shows 89 events across 32
distinct dispatch ids. Nothing is being dropped on our end.

**TN Appliance → Frontdoor: now returning `200 {"errors":null}`.** Once your sandbox fix landed I
was able to work the request body down against your validator, and I think you will want to know
what I found: **the envelope in the API doc is not the one the connector accepts.** Sending the
documented `{"data": [{"type": "status", "object": {...}}]}` returns
`CONNECTOR_BLE_0007 "Failed to unmarshal struct to JSON string"` every time. That single mismatch is
what the last couple of weeks were stuck on.

Working backwards from your error codes, the shape it accepts is:

```json
{
  "type": "status",
  "data": {
    "external_id": "22863999",
    "message": "Jimmy is on the way",
    "status": "Technician in Route to Location",
    "status_code": "70",
    "vendor_id": "822418",
    "tenant": "AHS",
    "source": "TN_APPLIANCE_EXCHANGE"
  }
}
```

The specifics, in case they are useful to whoever owns the connector:

- `type` has to be at the top level — inside `data` it returns `BLE_0042 "Type Missing in request"`.
- `external_id` has to be inside `data` — at the top level it returns `BLE_0048 "ExternalID Missing"`.
- `message` and `status` have to be non-empty **strings** — as an object or a number they fail at
  unmarshal.

Two things I would like to confirm before we call this done:

1. **Which value do you want in `status`?** Both `"Technician in Route to Location"` and `"70"`
   return 200, so I cannot tell from the response which one your system actually reads. We are
   currently sending the description. If it should be the numeric code, just say the word.
2. **Can you eyeball one on your side?** I pushed status 70 to dispatch **22863999** this morning
   and got `200 {"errors":null}`. Since we have no read-back, a quick confirmation that it landed
   on the dispatch would let us treat this as verified rather than accepted.

One last thing on the sandbox data: the events we are receiving carry vendor ids 1396202, 157992 and
1636528 and are mostly Virginia addresses, rather than our three accounts (822418 North Shore LA,
822218 South Shore LA, 839828 Middle TN). I assume that is just a shared sandbox stream — but I want
to confirm the production feed will be filtered to our vendor ids before we turn on automatic job
creation, so we do not create work orders that belong to another contractor.

Appreciate you turning this around quickly.

James "Teddy" Pivacek
TN Appliance Exchange LLC

---

## What changed on our side

- **`_lib/frontdoor.js`** now sends the accepted flat envelope. Vault `FRONTDOOR_LEGACY_SHAPE=1`
  restores the documented `data[]` body as a one-line reversal if production turns out to differ —
  we have never been able to test production (our sandbox token gets `401 "Jwt issuer is not
  configured"` there).
- **`tests/frontdoor-payload-shape.test.js`** pins the shape, capturing the real body by stubbing
  fetch and calling the exported helper. Mutation-proven four ways: reverting to the documented
  envelope fails 8, status-as-a-number fails 1, hoisting `external_id` fails 1, allowing an empty
  message fails 1.
- **`frontdoor-probe?secret=…&shape=all`** reproduces the whole 24-row ladder in one call.

### Still do NOT set `FRONTDOOR_WEBHOOK_LIVE=1`

Unchanged and reinforced. Flipping it would create jobs from a stream addressed to *other*
contractors in states we do not serve. That waits on their answer to the vendor-scoping question.

### Token hygiene

`FRONTDOOR_WEBHOOK_TOKEN` is written out in full in `CLAUDE.md`, which is committed. It only
authorizes writes into our own dark receiver, but it should be rotated when the production token
is issued.

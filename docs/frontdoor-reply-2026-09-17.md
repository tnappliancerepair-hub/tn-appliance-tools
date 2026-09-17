# Reply to Akshay — 2026-09-17

**Send from** tnappliancerepair@gmail.com, reply-all on thread `1a0341dcd5f4a3e4`
("Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates").
Reply-all reaches Akshay, Vaibhav, Brian Bullock, Adarsha, Danny, Shivam.

**Do not send without Teddy's go.**

---

Hi Akshay,

That was the missing piece — thank you. Your payload works, and comparing it to ours
found the problem in one pass. It was never the envelope. It is one JSON type.

**We tested your format one field at a time against sandbox this morning. Two rows fail,
and both are type mismatches on adjacent fields that want opposite types:**

| what we changed from your body | result |
|---|---|
| nothing (your body verbatim) | **200** |
| `status_code` as a number `70` instead of `"70"` | **500 CONNECTOR_BLE_0007** |
| `dispatch_id` as a string `"22863999"` instead of `22863999` | **500 CONNECTOR_BLE_0007** |
| removed `items` | 200 |
| removed `username` | 200 |
| added `start_time` / `end_time` | 200 |
| our vendor id `822418` in place of `1396202` | 200 |

So `status_code` must be a **string** and `dispatch_id` must be a **number**. We had been
sending `status_code` as a number, which is what produced every BLE_0007 we saw. Our
connector now sends your format exactly, on every status push.

**On the 200-for-an-incorrect-request you flagged** — this may narrow it down for your
connector team. The body that returns 200 and saves nothing is a *different envelope*
entirely, not a bad field inside yours. This one:

```json
{ "type": "status",
  "data": { "external_id": "22863999", "message": "Jimmy is on the way",
            "status": "Technician in Route to Location" } }
```

returns `200 {"errors":null}` every time and writes nothing. We arrived at it by following
your validator's error codes (BLE_0042 → BLE_0048 → BLE_0049 → BLE_0050), each one naming
a field to add, until the errors stopped — so from the outside it looked like success. A
malformed body inside the correct envelope fails loudly with a 500, which is the right
behaviour; it is only this wrong-envelope case that is silently accepted.

**Two things we need from you:**

1. **Please confirm the statuses landed.** We sent several test pushes to dispatch
   **22863999** this morning, each with the note **"Ant probe — please ignore"**. If they
   are visible in the Contractor Portal, we are done on sandbox. Sorry for the noise on
   your test dispatch — we kept it to one dispatch deliberately.

2. **Production credentials.** Our sandbox token gets `401 "Jwt issuer is not configured"`
   against `api.frontdoorhome.com`, so we have never been able to test production. We are
   ready for a production credential for Client ID `040c014f-06e5-4697-a336-137dfa942128`
   whenever you are.

On your point 3 — understood, and that is what we expected. Our webhook receiver is built
and running dark for exactly that reason: the sandbox feed carries other contractors'
dispatches (we are seeing vendor ids 1396202, 157992 and 1636528, none of them ours), so
turning it on against sandbox would create jobs we do not own. We will flip it live once
production is scoped to our vendor ids: **822418** (North Shore LA), **822218** (South
Shore LA), **839828** (Middle TN).

Thanks again — this one had us stuck for two weeks and your payload ended it in an hour.

James "Teddy" Pivacek
TN Appliance Exchange LLC

# Reply to Akshay — 2026-09-17 (v2, full test sweep)

**Send from** tnappliancerepair@gmail.com, reply-all on thread `1a0341dcd5f4a3e4`
("Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates").
Reply-all reaches Akshay, Vaibhav, Brian Bullock, Adarsha, Danny, Shivam.

**Do not send without Teddy's go.**

---

Subject: Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates

Hi Akshay,

Your payload was the missing piece — thank you. Comparing it against ours found the problem
in one pass, and it was not the envelope. It was one JSON type.

**What was wrong on our end**

We tested your body one field at a time against sandbox, changing exactly one thing per
request and using your version as the control:

| change from your body | result |
|---|---|
| nothing (your body verbatim) | 200 |
| `status_code` as a number `70` instead of `"70"` | 500 `CONNECTOR_BLE_0007` |
| `dispatch_id` as a string `"22863999"` instead of `22863999` | 500 `CONNECTOR_BLE_0007` |
| `items` removed | 200 |
| `username` removed | 200 |
| `start_time` / `end_time` added | 200 |
| our vendor ids `822418` / `839828` in place of `1396202` | 200 |

So `status_code` must be a string and `dispatch_id` must be a number. We had been sending
`status_code` as a number, and that single difference produced every `CONNECTOR_BLE_0007` we
saw over the past two weeks. Our connector now sends your format exactly on every push.

**Where we are now — both directions are working**

- **Frontdoor to us:** steady. 823 events across 276 distinct dispatch IDs since 2026-07-10.
- **Us to Frontdoor:** we pushed **all 13 status codes we use** to dispatch 22863999 under our
  vendor id 839828 this morning. Every one returned `200 {"errors":null}`:

| code | description we send |
|---|---|
| 30 | Appointment Set |
| 70 | Technician in Route to Location |
| 90 | Technician Arrived at Location |
| 20 | In Progress |
| 380 | Parts Ordered |
| 100 | In Progress with Parts on Order |
| 410 | Parts Arrived |
| 400 | Return Appointment Set |
| 290 | Authorization Reported |
| 150 | On Hold |
| 10 | Job Complete |
| 440 | Job Invoiced |
| 40 | Job Cancelled |

That is a validator sweep on one dispatch rather than a real job's progression, so the status
trail on 22863999 will look synthetic — apologies for the noise on your test dispatch.

We also pushed a full technician report as the note on the Job Complete call — roughly 900
characters covering diagnosis, failed component with part number, work performed, labor hours
and parts to be returned. That returned 200 as well.

**Three things we cannot confirm from our side**

A 200 from the webhook is the only signal we get, and you have already shown us a 200 can come
back on a request that was not processed. So we would rather ask than assume:

1. **Did this morning's pushes actually land on dispatch 22863999 in the Contractor Portal?**
   If you can eyeball it, that closes the loop for good.
2. **Do the 13 code/description pairs above match your catalog?** We want a technician going
   en route to show as en route on your side, not just to be accepted.
3. **Does the note field store the full ~900 characters, or is there a shorter limit?** If it
   truncates we would rather shorten our report deliberately than have it cut mid-sentence.

**On the 200-for-an-incorrect-request you flagged**

This may help your connector team narrow it down. The body that returns 200 and saves nothing
is a different envelope, not a bad field inside yours:

```json
{ "type": "status",
  "data": { "external_id": "22863999",
            "message": "Technician in Route to Location",
            "status": "Technician in Route to Location" } }
```

That shape returns `200 {"errors":null}` every time. It is what we had been sending, and it is
why we believed we were connected for two weeks. If the connector rejected an unrecognized
envelope instead of acknowledging it, that gap would have been a day rather than a fortnight.

**The one thing we still need**

A **production credential**. Our sandbox token returns `401 "Jwt issuer is not configured"`
against `api.frontdoorhome.com`, so we have not been able to test production at all. Our
Client ID is `040c014f-06e5-4697-a336-137dfa942128` and our vendor ids are:

- `822418` — North Shore, LA
- `822218` — South Shore, LA
- `839828` — Middle TN

Once we can authenticate against production we are ready to go live on status updates, which
takes the manual portal entry off our office entirely.

Thanks again for sending the working payload — that one message unblocked the whole thing.

Teddy Pivacek
TN Appliance Exchange LLC

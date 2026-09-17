# Reply to Akshay — 2026-09-17 (v4: short, proof first)

**Send from** tnappliancerepair@gmail.com, reply-all on thread `1a0341dcd5f4a3e4`.
Reaches Akshay, Vaibhav, Brian Bullock, Adarsha, Danny, Shivam.

**Do not send without Teddy's go.**

Positioning: lead with the working run on their own test dispatch, then the four things that get
us to go-live, then the disclosure. Every table moved below the divider so the body reads in
under a minute. The receive half is the differentiator — the authorization decisions are what
still cost our office real hours, and our receiver for them is already built.

---

Subject: Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates

Hi Akshay,

Your payload was the missing piece, and it was not the envelope — it was one JSON type.
`status_code` has to be a string and `dispatch_id` has to be a number. We were sending
`status_code` as a number, and that single difference produced every `CONNECTOR_BLE_0007` we
ever saw. Fixed, and pinned by a test so it cannot come back.

**We then ran a complete repair through your sandbox** on dispatch 22863999 (vendor 839828):
accepted, appointment set, en route, arrived, in progress, parts ordered, parts on order, parts
arrived, return appointment set, job complete, invoiced. Eleven statuses in order, a note on
every one, `200 {"errors":null}` every time. The Job Complete step carried the full technician
report — 886 characters, composed automatically from what the technician recorded on site, with
labor hours and the part owed back stated explicitly. That is what every AHS dispatch will look
like from us.

We also pushed every status a contractor can report through your validator. All 23 accepted. The
15 that are AHS decisions — authorization outcomes, cash out, CIL — we deliberately do not send.
The full map is at the bottom of this note.

**Two things we owe you on that test dispatch.** The validator sweep left a block of unrelated
entries ahead of the clean run — apologies for the noise. And one of them is genuinely wrong: a
"Parts received" note went out under code 70 during that sweep, from a bug on our side that we
have since fixed. The correct 410 is step 8 of the clean run.

**What gets us to go-live:**

1. **A production credential.** Our sandbox token returns `401 "Jwt issuer is not configured"`
   against `api.frontdoorhome.com`, so we have not been able to test production at all.
   Client ID `040c014f-06e5-4697-a336-137dfa942128`.
2. **Confirmation the 11-step run landed** on dispatch 22863999. A 200 is the only signal we get,
   and you have already shown that a 200 can come back on a request that was not processed.
3. **Authorization outcomes, notes and NCC pushed to us.** 350 / 360 / 370 / 450 as they happen,
   plus notes added on your side and NCC notifications. This is the half that still costs us real
   hours — today our office checks the portal by hand to learn whether an authorization was
   approved and for how much. Our receiver is already built for all four of your operations and
   flags authorization outcomes for a human rather than acting on them. It is running dark for
   one reason: the sandbox feed carries other contractors' dispatches (vendor ids 1396202,
   157992, 1636528 — none of them ours), and we will not turn it on against data that is not
   ours. Receiver URL `https://tnapplianceexchange.net/.netlify/functions/frontdoor-webhook`,
   bearer token sent 2026-07-13, happy to rotate it any time.
4. **Confirmation the production feed will be scoped to our vendor ids** — 822418 North Shore LA,
   822218 South Shore LA, 839828 Middle TN.

Once we can authenticate against production we are ready to go live on status updates the same
day, which takes the manual portal entry off our office entirely.

Thanks again for sending the working payload — that one message unblocked all of this.

Teddy Pivacek
TN Appliance Exchange LLC

---

## Reference

### What was wrong on our end

Using your body as the control and changing exactly one field per request:

| change from your body | result |
|---|---|
| nothing (your body verbatim) | 200 |
| `status_code` as a number `70` instead of `"70"` | 500 `CONNECTOR_BLE_0007` |
| `dispatch_id` as a string `"22863999"` instead of `22863999` | 500 `CONNECTOR_BLE_0007` |
| `items` removed · `username` removed · `start_time`/`end_time` added | 200 each |
| our vendor ids `822418` / `839828` in place of `1396202` | 200 each |

### The 11-step run, in order

The Job Complete note at step 10 is real output from our system; the rest are written to show the
shape and detail of note each status will carry:

| # | code | status | note we sent |
|---|---|---|---|
| 1 | 260 | Dispatch Accepted | Dispatch accepted. Assigned to Jimmy P., Middle TN crew. |
| 2 | 30 | Appointment Set | Appointment set for Thu Sep 18, 8-11 AM arrival window. Customer confirmed by text. |
| 3 | 70 | Technician in Route | Technician en route. Estimated arrival 8:40 AM. |
| 4 | 90 | Technician Arrived | Technician on site at 8:47 AM. |
| 5 | 20 | In Progress | Diagnostics underway. Whirlpool dryer, no heat on any cycle. |
| 6 | 380 | Parts Ordered | Heating element kit W10724237 and thermal cutoff 279973 ordered from Marcone. Expected Sep 19. |
| 7 | 100 | In Progress w/ Parts on Order | Awaiting parts. Customer advised; return visit will be set the day parts land. |
| 8 | 410 | Parts Arrived | Parts received Sep 19. Ready to schedule the return visit. |
| 9 | 400 | Return Appointment Set | Return appointment set for Fri Sep 20, 8-11 AM. Customer confirmed. |
| 10 | 10 | Job Complete | *(full technician report — below)* |
| 11 | 440 | Job Invoiced | Invoice submitted. Labor 1.5 hrs. Parts W10724237, 279973. Cycling thermostat WP8577274 to be returned. |

The Job Complete note is the whole technician report, composed automatically from what the
technician recorded on site — no retyping by our office:

> TN Appliance TDR — Whirlpool Dryer. Diagnosis: No heat on any cycle. Drum turns and blower is
> clear, airflow at the vent is strong so not a restriction. Ohmed the heating element open at
> both terminals; thermal cutoff also reads open. Failed: Heating element and thermal cutoff
> (part W10724237) — Element burned open and took the thermal cutoff with it. Lint build-up in
> the blower housing contributed to the overheat. Work performed: … **Labor: 1.5 hrs. Parts to
> return: Cycling thermostat (WP8577274).**

### What we send

23 statuses, all accepted by your sandbox. Three fire automatically from the technician's app
today. Five more are already mapped in the app and need one line each to go live. The rest are in
our connector and need an office-side trigger. Every one maps to a signal our system already
produces, so none of this is a build — it is wiring:

| code | status | fires from | today |
|---|---|---|---|
| 260 | Dispatch Accepted | auto-accept on dispatch receipt | ready |
| 30 | Appointment Set | office books the day | ready |
| 270 | Reschedule Appointment Set | office reschedules | ready |
| 60 | Unable to Contact Customer | customer never answers intake | ready |
| 280 | Left message for Customer | voicemail / callback captured | ready |
| 70 | Technician in Route | tech taps "on my way" | **live** |
| 80 | Technician May Be Delayed | running-late watcher | ready |
| 90 | Technician Arrived | tech taps "start" | mapped |
| 120 | Customer Missed Appointment | no-show check | ready |
| 20 | In Progress | tech taps "start" | **live** |
| 380 | Parts Ordered | part ordered on the job | mapped |
| 100 | In Progress w/ Parts on Order | awaiting parts | mapped |
| 160 | Parts/Equipment Status | parts ETA changes | ready |
| 410 | Parts Arrived | parts received | ready |
| 400 | Return Appointment Set | return visit booked | mapped |
| 110 | In Progress w/ Need to Replace | technician reports not repairable | ready |
| 150 | On Hold | job held | mapped |
| 290 | Authorization Reported | authorization submitted | ready |
| 460 | 2nd Opinion Requested | second opinion requested | ready |
| 140 | Incomplete | visit ended unfinished | ready |
| 10 | Job Complete | tech closes the job (carries the full report) | **live** |
| 440 | Job Invoiced | invoice submitted | ready |
| 40 | Job Cancelled | job cancelled | ready |

"**live**" means a technician tap sends it today with nobody doing anything. "mapped" means the
status is already in the app's lifecycle table but no tap passes it yet — one line each. We would
rather draw that line honestly than call eight things automatic when three of them are.

**We have deliberately not built a push for any authorization outcome** — 350 Approved, 360
Denied, 370 Approved with Limitations, 450 Awaiting Contractor Input, 470 Draft for Review, 480
Review with Agent, 500 Cash Out Approved. Those are AHS decisions, not ours to assert. Same for
CIL (320/330/340) and the customer-side appointment and survey codes. If we have any of that
backwards, tell us and we will correct it.

### Two smaller questions

- **Do our code/description pairs match your catalog?** We want a technician en route to *show* as
  en route, not merely be accepted.
- **Does the note field store the full ~900 characters?** If it truncates we would rather shorten
  the report deliberately than have it cut mid-sentence.

### For your connector team — the 200 that saves nothing

On the 200-for-an-incorrect-request you flagged: the body that returns 200 and saves nothing is a
different envelope, not a bad field inside yours.

```json
{ "type": "status",
  "data": { "external_id": "22863999",
            "message": "Technician in Route to Location",
            "status": "Technician in Route to Location" } }
```

That returns `200 {"errors":null}` every time. It is what we had been sending, and it is why we
believed we were connected for two weeks. If an unrecognized envelope were rejected instead of
acknowledged, that gap would have been a day rather than a fortnight.

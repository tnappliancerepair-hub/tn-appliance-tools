# Reply to Akshay — 2026-09-18 (delivery + one ask)

**Send from** tnappliancerepair@gmail.com via `gmail-send` with explicit `to` + `thread_id=1a0341dcd5f4a3e4`.
Never reply-all off the `Fwd:` copy in the thread — a forward composes with an empty `To:` and
autocomplete fills in the wrong address. That is how the 9/3 and 9/8 replies were lost.

**To:** Akshay.Kyatam@frontdoor.com, vaibhav.parashar@frontdoor.com, Brian.Bullock@ahs.com,
Adarsha Dash, Shivam Arora, Danny Suarez — the six on his 2026-09-18 message.

**Do not send without Teddy's go.**

Positioning: he answered all five of our open questions in one message and moved production
access to "in progress." So this is not a nudge. It reports the two things we changed BECAUSE of
his answers, confirms the one thing we are deliberately NOT doing until production is scoped,
and leaves exactly one ask on the table.

⚠️ **Accuracy gate before sending:** the items work is on
`claude/supabase-ant-system-testing-vnbgym` and **Netlify serves `main`**. The sentence "every
status update we send now carries the items object" is true of the code and becomes true on the
wire at merge. Merge first, or soften the tense.

---

Subject: Re: Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates

Hi Akshay,

That answered everything we had open. Two of them we acted on the same day.

**`items` now rides on every status update we send** — not a chosen subset. You said it is
mandatory for certain statuses, and we have no measurement telling us which, so the safe answer
is all of them. We take the ids off your own dispatch XML rather than inventing them. Today's
dispatch 23457839 is a two-appliance job, and it composes to:

```
"items": [
  { "id": 20242, "legacy_item_id": 20242, "description": "Dryer"  },
  { "id": 20312, "legacy_item_id": 20312, "description": "Washer" }
]
```

Those come from `<WorkOrderLineList Id="20242" Description="Dryer">` in the dispatch you sent us,
and `id` and `legacy_item_id` carry the same value, matching the body you shared. **If that is
not the identifier you expect back, tell us and it is a one-line change** — we would rather hear
it now than on the first production push.

**The technician report now composes to 980 characters**, up from the 900 we had been holding to
on a guess. Thank you for confirming the field — that is roughly eighty more characters of real
diagnosis reaching the reviewer on every completed job. We stop at 980 rather than 1,000 on
purpose, so a limit that turns out to be exclusive cannot cost us the whole note.

**On vendor scoping — thank you for putting it in writing.** Our inbound receiver is built and
tested and we are deliberately leaving it switched off until production, because the sandbox feed
carries other contractors' dispatches and we are not willing to create work orders against
vendors that are not ours. Your confirmation is the thing that lets us turn it on.

That leaves one item: **the production credential.** Our sandbox token still issues from
`login.sandbox.frontdoorhome.com`, so production returns `401 Jwt issuer is not configured` —
everything else on our side is a credential swap. If there is anything your provisioning team
needs from us to move it along — a form, a security review, a contact — send it over and you will
have it the same day.

Thanks Akshay. This has been a genuinely good integration to work on.

Teddy
TN Appliance Exchange

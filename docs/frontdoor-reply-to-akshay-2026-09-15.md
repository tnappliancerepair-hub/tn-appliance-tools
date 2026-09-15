# Reply to Akshay — AHS/Frontdoor sandbox → production (2026-09-15)

**Send from `tnappliancerepair@gmail.com`, reply-all on the existing thread**
*"Sandbox Integration Ready for Testing – Please Verify Inbound and Outbound Updates"*
To: Akshay.Kyatam@frontdoor.com · Cc: Brian Bullock, Shivam Arora, Vaibhav Parashar, Adarsha Dash, Danny Suarez

## Why this matters
Akshay has been waiting on us since **2026-08-24**. He asked a direct question on 9/3 and
followed up on 9/8 — *"Could you please verify whether it was received on your end?"* — and we
never gave him the clean yes. Meanwhile his sandbox has sent us **161 distinct dispatches, 500
events, most recently 2026-09-14**. We have every one of them. **He is ready to go to
production and is only waiting on our confirmation plus our production webhook credentials.**

## The one real ask
He never gave us the **inbound** endpoint (our system → Frontdoor). He gave us our own webhook
URL and token, and the `source` value — but not his base URL or path. We inferred
`api.sandbox.frontdoorhome.com` from the public docs, and **that host returns 404 on every path
including its own root**, so our status pushes have had nowhere to land. That is the single
missing piece.

---

## Draft

> Hi Akshay,
>
> Apologies for the slow close on this — confirming everything now.
>
> **Outbound (Frontdoor → our webhook): confirmed working.** Yes, we received dispatch
> **22863999** — 7 events for it, both the `schedule` and `status` operations, exactly as you
> described. More broadly we've received **161 distinct dispatches / 500 events** from your
> sandbox, most recently on **September 14**. Nothing is being lost.
>
> They're currently landing in validation mode rather than creating live work orders — that's
> deliberate on our side, so your sandbox test dispatches don't create real jobs on our
> technicians' boards. We flip that to live the moment we're on production traffic.
>
> **Inbound (our system → Frontdoor): we need one thing from you.** This is where we've been
> stuck, and I think it's a gap in what we were given rather than anything on your end. We have
> the `source` value (`TN_APPLIANCE_EXCHANGE`) and the API key you enabled, and our token
> generates and introspects as active. But we were never given **your inbound endpoint** — the
> base URL and path we should POST status updates to.
>
> We'd been assuming `https://api.sandbox.frontdoorhome.com`, based on the public docs, but that
> host returns 404 on every path we try, including the service root — so there's nothing there
> for us to reach. On `https://api.frontdoorhome.com` the `/dispatch-connector` service does
> respond, but rejects our sandbox-issued token with *"Jwt issuer is not configured"*, which
> reads like production correctly not trusting a sandbox token.
>
> So, could you send:
> 1. The **exact inbound URL** (base + path) for dispatch status updates in sandbox, and
> 2. A sample request body you'd accept — we want to match your schema exactly rather than guess.
>
> With that we can complete the round-trip on dispatch 22863999 same day.
>
> **On production:** we're ready. Once inbound is confirmed, we'll send production webhook
> credentials immediately and can turn it around the same day. On your side we'd need the
> production API key/ClientId, since the sandbox one won't authenticate against production.
>
> For reference, our AHS vendor IDs are **839828** (Middle TN), **822418** (North Shore, LA) and
> **822218** (South Shore, LA).
>
> Thanks for your patience on this one — appreciate you and the team pushing it forward.
>
> James (Teddy) Pivacek
> TN Appliance Exchange LLC

---

## Notes for us
- ⚠️ **Do NOT flip `FRONTDOOR_WEBHOOK_LIVE=1` yet.** These are *sandbox* dispatches. Going live
  now would create **161 junk jobs** on the real board. Dark mode is the correct posture until
  we're on production traffic. The dry-run has been doing its job.
- ✅ **Fixed 2026-09-15:** our connector was sending `source: "DISPATCH_ME"` — a guess copied
  from the public enum. Akshay told us on 8/24 to send `TN_APPLIANCE_EXCHANGE`. Now corrected in
  `_lib/frontdoor.js` (`FD_SOURCE`).
- Everything else is built: **`frontdoor_push_shadow` = 100 events/90d**, on-my-way→EN_ROUTE,
  start→IN_PROGRESS, complete→COMPLETE with the composed TDR note, all firing, just logging.
- ⚠️ **The 8/31 email overclaimed.** We told Akshay inbound was "confirmed working" and read the
  404 as "no sandbox dispatch to reference." It was the route missing, not the dispatch. That's
  part of why this stalled for two weeks — worth being precise about now.

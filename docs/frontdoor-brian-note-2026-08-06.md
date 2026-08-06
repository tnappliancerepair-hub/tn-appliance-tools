# Note to Brian Bullock — ready to send ahead of the 8/11 dev start
**2026-08-06.** Send from tnappliance@gmail.com (or the address Brian's thread is on) to **Brian.Bullock@ahs.com**. Purpose: make the 8/11 sprint efficient — confirm we're ready on our side + get answers to the handful of questions that decide what we can automate. **Do NOT include any password or the webhook bearer token in the email** (the token was already provided 7/13; the password never leaves the vault). The Client ID + webhook URL + vendor IDs below are shareable identifiers.

---

**Subject:** TN Appliance Exchange — ready for the 8/11 integration start (a few questions to tee it up)

Hi Brian,

Thanks again — looking forward to your team kicking off our integration next sprint. To make that week as efficient as possible, here's where we are on our side and the handful of things we need from you.

**We're ready to test the moment you flip the switches:**
- Authentication is working — we're minting valid JWTs against the sandbox.
- Our inbound webhook receiver is deployed and live at the URL below, ready to accept your Schedule / Status / notes / NCC events.
- Our connector for pushing dispatch status + notes back to you is built and tested against the sandbox schema.

**To turn it on, we need your team to:**
1. **Link our Client ID to our account** so the dispatch/status endpoint stops returning 403.
2. **Point your sandbox webhook at our receiver URL** (below) so we can validate a couple of real payloads.

**A few questions so we build it right the first time:**
3. **Is our contractor account provisioned for the dispatch / case-lifecycle status API at all?** Just want to confirm we're set up for it before your devs dig in.
4. **Beyond the Status/Note API, is there a claims / estimate / invoice *submission* API?** This is the big one for us — if we can submit the authorization estimate and the invoice programmatically (not just status + notes), we can eliminate nearly all the manual portal work on our end. What's available there?
5. **Which inbound endpoint are we authorized for** — the `dispatch-connector/v1/webhook` path, or the `case-lifecycle/dispatch_status_update` path? If it's the latter, what's our routing ID?
6. **Can you share the authoritative status-code list** (the full code ↔ description mapping) so ours matches yours exactly?
7. **A couple of sandbox test dispatches** we can validate against end-to-end would be a big help.

**Our details for your team:**
- **Client ID:** `040c014f-06e5-4697-a336-137dfa942128`
- **Webhook URL (inbound to us):** `https://tnapplianceexchange.net/.netlify/functions/frontdoor-webhook` — the bearer token I sent on 7/13 is still active
- **Vendor IDs (all TN Appliance Exchange LLC):** 839828 (Middle TN), 822418 (LA North Shore), 822218 (LA South Shore)

Appreciate you moving this forward — happy to hop on a quick call anytime during the sprint if that's easier for your devs.

Thanks,
Teddy Pivacek
TN Appliance Exchange LLC

---

### Why each question matters (for us, not for the email)
- **#3** = make-or-break; the whole integration hinges on the account being provisioned for this API.
- **#4** = decides **Level 2** (the TDR files itself as a structured estimate + invoice). If yes, it's the single biggest automation — we already do it for SquareTrade. If no, the TDR still rides along as a note (Level 1, already wired).
- **#5** = tells us which connector path to finalize (+ whether we need a `FRONTDOOR_ROUTING_ID`).
- **#6** = locks our STATUS map to theirs so pushes don't bounce.
- **#7** = lets us validate the shadow payloads before flipping live.

Once we have #3–#6, the go-live is: link Client ID → point webhook → watch 2–3 shadow payloads → flip `FRONTDOOR_WEBHOOK_LIVE=1` (auto-intake) → flip `FRONTDOOR_PUSH_LIVE=1` (status + TDR-note push). Full sequence in `docs/ahs-api-plan-2026-08-06.md`.

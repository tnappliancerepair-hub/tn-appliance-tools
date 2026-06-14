# 📞 Phone (Vapi) fix status — 2026-06-14 (resume here)

Spent the evening chasing "Ant can't find the customer on calls." Root cause is
fully diagnosed and the hard part is solved. What's left is a 2-minute Vapi
attach + **Publish**.

## The architecture (confirmed)
- Live inbound assistant = **Ant Inbound**, Vapi account **tnappliance@gmail.com**
  (production), Model = **Anthropic Claude Sonnet 4.5** (standard Vapi model +
  Vapi server tools — NOT the custom-llm brain; the brain's internal executeTool
  is NOT in this path).
- Calls are **forwarded from the old RingCentral 615-280-2949** -> caller ID is
  **masked** (shows the shop's own number). `lookup_customer_by_phone` returns
  `caller_id_masked:true` so Ant should ask for name/claim. (Permanent fix =
  finish the Telnyx port of 280-2949; until then masked is expected + handled.)

## THE ROOT CAUSE (proven)
Vapi POSTs tool calls wrapped in `{message:{toolCalls:[{function:{arguments}}]}}`
and expects `{results:[{toolCallId,result}]}` back. Our **Xano endpoints take
flat params and return flat JSON** -> Vapi shows **"No result returned."**
- Proof: `curl` Xano lookup_by_claim_number with a flat body = match; with Vapi's
  wrapped body = `ERROR_CODE_INPUT_ERROR: Missing param`.
- GET tools (lookup_customer_by_phone) reach Xano (caller_id_masked fires) but
  Vapi still rejects the flat response shape.

## THE FIX (built + verified)
`netlify/functions/vapi-tool.js` = a proxy that unwraps Vapi's envelope, calls
the right Xano endpoint, and returns Vapi's `{results:[{toolCallId,result}]}`.
- VERIFIED working: POST Vapi-shaped body to
  `https://tnapplianceexchange.net/.netlify/functions/vapi-tool` with
  `search_customers`/`lookup_by_claim_number` returns the customer + matching
  toolCallId. e.g. "work order 22818" -> job 18527; "Sherri Rucker" -> id 4104.
- All 5 tool configs in `vapi-config/tools/` already point at the proxy:
  lookup_customer_by_phone, lookup_by_claim_number, search_customers,
  voice_followup_send_links, capture_callback.
- Proxy logs every call as `vapi_proxy_<name>_found|empty` (queryable via
  `get_event_log_by_action`) so you can SEE if a real call hit it.

## WHAT'S LEFT (the 2-minute finish)
The live Ant Inbound is still attached to **old/"Missing"/Xano** tool copies, not
the proxy ones. Repeated script re-wires + dashboard edits left DUPLICATE tools,
and the attach never stuck (assistant showed "Missing tool" = deleted refs).

Do this in the Vapi dashboard (it's authoritative):
1. **Tools list:** for each of the 5 names, make sure the copy you keep has
   Server URL = `https://tnapplianceexchange.net/.netlify/functions/vapi-tool`.
   Delete extra/Xano-pointing duplicates.
2. **Ant Inbound -> Tools:** remove any "Missing tool" entries; attach the 5
   proxy tools (they should show their NAME, not "Missing tool").
3. **Click Publish** (top-right). <- the call runs the PUBLISHED version; this
   step was likely missing.
4. Test call: say **"work order 22818"** (digits transcribe reliably; names get
   mangled — Deepgram heard "Sherri Rucker" as "Sherry Walker").

## How to verify it worked (from this repo)
After a test call, check:
`curl ".../get_event_log_by_action?action=vapi_proxy_lookup_by_claim_number_found"`
If `last_at` is recent -> the chain connects: Ant -> proxy -> Xano -> answer.

## Tooling that exists
- `scripts/vapi-wire-inbound.js --apply` — deletes+recreates the 5 tools on the
  proxy and attaches them (the attach-persist is the flaky part; dashboard
  Publish is the reliable backstop).
- `scripts/vapi-inbound-prompt.js --pull/--apply` — manage the prompt as code.

## Prompt note
The brain/standard prompt should: on `caller_id_masked` or no phone match, NEVER
say "can't find you" — ask for claim/WO (-> lookup_by_claim_number) or name (->
search_customers), and only take a callback after actually calling the tools.
That guidance is in `vapi-config/prompts/ant_inbound.md` +
`docs/vapi-inbound-prompt-2026-06-14.md`.

## Reminder: do NOT diagnose to the customer
Per Teddy: Ant never tells the homeowner what's wrong / how to fix it / part
numbers. Pre-diagnosis stays internal (right part on first visit). Honest answers
to the customer belong in the paid, tech-reviewed self-checkout TDR later.

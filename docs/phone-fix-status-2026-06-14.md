# 📞 Phone (Vapi) fix — RESOLVED 2026-06-15

The "Ant can't find the customer on calls / No result returned" bug is **fixed
and live**. Root cause was found with full visibility (not guessed), the fix is
applied to the production assistant, and every tool was verified through the
proxy.

## The real root cause (proven via Vapi's own call logs)
Ant Inbound had **14 INLINE `model.tools`, every one pointing straight at Xano**
(`…xano.io/api:3e_TffpA/<tool>`). Those inline definitions are what Vapi actually
executed — they shadowed the 5 proxy-pointed `toolIds`. So Vapi sent its wrapped
envelope `{message:{toolCallList:[…]}}` to flat Xano endpoints → Xano returned
**HTTP 400** → Vapi reported **"No result returned."**

Proof: `vapi-admin action=lastcall&raw=1` showed the server log event
`requestUrl: …xano.io/…/lookup_by_claim_number, error: status code 400` — Vapi
was calling Xano directly, never the proxy. `inspect` originally only checked
`toolIds` (which DID point at the proxy), hiding the inline tools.

## The fix (applied + verified)
1. **`netlify/functions/vapi-tool.js` is now a generic envelope bridge.** It
   unwraps Vapi's toolCallList/toolCalls, calls the right Xano endpoint flat
   (GET vs POST verified against the `.xs` method suffixes), and returns Vapi's
   `{results:[{toolCallId,result}]}`. It also **shapes the read-tool results
   lean** (lookup_by_claim_number → `{found,primary}`; ~4KB → ~380 bytes) and
   **strips `notes_internal`/`problem_*`** so internal diagnosis text never
   enters the LLM context (Teddy's no-diagnosis rule).
2. **All inline `model.tools` repointed to the proxy** (`vapi-admin action=fix`):
   10 unique tools repointed, 4 duplicates dropped (covered by the standalone
   proxy toolId tools), `transferCall` untouched. Read-back: `verify_clean:true`,
   `still_pointing_at_xano:[]`.
3. **Prompt AHS over-reference fixed** (`vapi-admin action=setprompt`): neutralized
   the two AHS-branded references and added a hard rule — never name/assume a
   warranty company unless the caller says it; ask generically for "your claim or
   work-order number." Repo copy synced: `vapi-config/prompts/ant_inbound.md`.

## Verified through the proxy (real Vapi-shaped POSTs)
- `lookup_by_claim_number "22818"` → job 18527 (Demika Augustus), lean.
- `search_customers "Rucker"` → Sherri Rucker (id 4104).
- `check_service_zone 37013` → covered, suggests Lee.
- `get_parts_status 18527` → parts snapshot.

## TEST IT
Call any Ant Inbound number and say a **work order number** (digits transcribe
far more reliably than names — Deepgram heard "Sherri" as "Sherry"):
> "My work order number is two-two-eight-one-eight."
Ant should read back the job (Demika Augustus, LG washer, scheduled, tech John).

Verify from the repo after a call:
`vapi-admin action=lastcall` → tool results should be JSON, not "No result
returned." Proxy hits also log `vapi_proxy_<name>_found|empty` to event_log.

## Caller-ID note (separate, expected)
Calls still forward from RingCentral 615-280-2949 → caller ID masked → phone
lookup can't match. Ant handles it (asks for claim/WO/name). Permanent fix =
finish the Telnyx port of 280-2949 pointed straight at Ant (CLAUDE.md TOMORROW).

## Cleanup owed
`netlify/functions/vapi-admin.js` is a TEMPORARY cloud admin (guard
`tn-vapi-admin-9f83b1c4e7a206d5`). Now that tools are wired, either delete it or
move the guard to a vault secret if we want to keep remote Vapi management.

# SMS_ENABLED gate pattern

**Owner:** Teddy / James Pivacek
**Authored:** 2026-05-11 (Week 1 Day 1)
**Spec:** `docs/system-blueprint-decisions-2026-05-09.md` Decision 6
**Companion:** `docs/six-week-plan-2026-05-09.md` Week 1

---

## Purpose

Master on/off switch for every outbound SMS path. When `$env.SMS_ENABLED != "true"`, all outbound Twilio calls are skipped EXCEPT calls to the owner phone (`+16154855795` / `6154855795`), which bypass the gate so owner alerts continue firing during testing. Every gated send (and every owner-bypass) is logged to `event_log` with a unique `call_site` identifier so the source of any blocked send is traceable. Inbound SMS untouched.

## Default

`$env.SMS_ENABLED` defaults to absent or `"false"`. The gate treats **anything other than the literal string `"true"`** as off. This means: missing env var, empty string, `"false"`, `"FALSE"`, `"0"`, `"no"`, anything else → off.

## Owner bypass

Owner phone is `+16154855795` (E.164) / `6154855795` (last-10). Both forms are recognized. **Danielle (`615-485-0713`) is NOT bypassed** — office staff, not owner. If a specific testing scenario needs Danielle SMS during a gated session, that's a separate per-call mechanism, not a permanent bypass.

## The canonical gate block (XanoScript)

Drop this block immediately before any `api.request` to `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`. Variable names use a `$gate_` prefix to avoid collisions with surrounding code.

```xanoscript
// ── SMS_ENABLED gate (call_site: <FILE.xs>:<LINE>) ──
// Owner phone bypasses; everything else gates on $env.SMS_ENABLED == "true".
var $gate_recipient_e164 {
  value = ($RECIPIENT_VAR ?? "")|trim
}
var $gate_recipient_bare {
  value = $gate_recipient_e164|replace:"+1":""
}
var $gate_is_owner {
  value = ($gate_recipient_e164 == "+16154855795") || ($gate_recipient_bare == "6154855795")
}
var $gate_sms_enabled {
  value = (($env.SMS_ENABLED ?? "false") == "true")
}
var $gate_should_send {
  value = $gate_sms_enabled || $gate_is_owner
}

conditional {
  if ($gate_should_send == false) {
    db.add event_log {
      data = {
        action  : "sms_gated"
        metadata: {
          recipient   : $gate_recipient_e164,
          body_preview: ($BODY_VAR ?? "")|substr:0:200,
          gated_reason: "SMS_ENABLED=false, non-owner recipient",
          call_site   : "<FILE.xs>:<LINE>"
        }
      }
    } as $gate_log
  }

  else {
    conditional {
      if ($gate_is_owner == true && $gate_sms_enabled == false) {
        db.add event_log {
          data = {
            action  : "sms_owner_bypass"
            metadata: {
              recipient   : $gate_recipient_e164,
              body_preview: ($BODY_VAR ?? "")|substr:0:200,
              call_site   : "<FILE.xs>:<LINE>"
            }
          }
        } as $bypass_log
      }
    }

    // [original api.request to Twilio goes here]
  }
}
```

Replace `$RECIPIENT_VAR` and `$BODY_VAR` with the actual variable names in the file being wrapped (they vary: `$target_phone`, `$to`, `$customer.phone`, `$tech.phone`, `$customer_phone`, etc.). Replace `<FILE.xs>:<LINE>` with the actual filename and original line number of the Twilio call. Do NOT update the line number if the file shifts — the line number marks the LOGICAL call site identity, not the current line.

## Why the variable-name prefix matters

XanoScript scoping inside conditionals can be subtle (per `docs/system-blueprint-v1.md` §16 footguns 6, 8). Using `$gate_*` names guarantees no collision with existing recipient/body/response vars in any of the 29 call sites being wrapped.

## Two event_log action types

1. **`sms_gated`** — when SMS was suppressed. Metadata includes `gated_reason` and `call_site`.
2. **`sms_owner_bypass`** — when SMS fired only because the recipient was the owner. Metadata includes `call_site`. **Only emitted when `$env.SMS_ENABLED != "true"`** — when SMS_ENABLED is on, owner SMS is just normal traffic, no bypass log needed.

## Response shape contract

For wrappers that build a structured response (like `send_sms_POST.xs`), set the response vars to a success-shaped value when gated so callers don't crash:

```
success: true
twilio_sid: null
twilio_status: 0
error: null
```

For inline call sites that don't expose a response upstream, no response handling needed — just skip the api.request.

## Two-step variant for sites where the api.request result is consumed downstream

Some sites read `$twilio_response.response.status` or similar after the call. When gated, that var won't exist. To prevent downstream errors:

```xanoscript
// Initialize the response var with a null-success shape BEFORE the gate.
var $twilio_response {
  value = {response: {status: 0, result: {sid: null}, error: null}}
}

conditional {
  if ($gate_should_send == false) {
    // ... gated path with event_log write, $twilio_response stays as initialized shape
  }
  else {
    // ... owner-bypass-log if applicable, then api.request as $twilio_response
  }
}
```

Audit the 29 sites case-by-case for downstream consumers of the api.request result.

## call_site identifier convention

`<FILENAME.xs>:<LINE>` — where LINE is the **original line number** of the Twilio `api.request {` block, not the current line after wrapping shifts things around. This lets the admin status endpoint show "gated send from feedback_reply_webhook_POST.xs:70" and Teddy can grep the file for that comment to find the exact call site.

Each wrap inserts a top comment `// ── SMS_ENABLED gate (call_site: <FILE>:<LINE>) ──` so grep finds them. The same line identifier also appears in the metadata payload.

## Inbound SMS untouched

`tech_sms_inbound_POST.xs` receives inbound Twilio SMS and returns a TwiML reply. The 6 sites being wrapped within that file are OUTBOUND sends initiated by the daily-mode handler (broadcast notify-losers, sick-day customer messages, owner escalations, etc.) — NOT the TwiML response itself. The TwiML response composition is a different mechanism and is not gated.

## Smoke test (after `xano workspace push`)

1. **Non-owner test:** call `send_sms_POST` with `to=+15551234567` (any non-owner number) and `message="gate test"`. Verify:
   - No Twilio message in the Twilio Console
   - `event_log` has a new row with `action="sms_gated"`, `metadata.recipient="+15551234567"`, `metadata.call_site="send_sms_POST.xs:42"`
   - Endpoint returned `{success: true, twilio_sid: null, twilio_status: 0, error: null}` — caller-friendly

2. **Owner test:** call `send_sms_POST` with `to=+16154855795` and `message="owner bypass test"`. Verify:
   - SMS arrived at Teddy's phone
   - `event_log` has a new row with `action="sms_owner_bypass"`, `metadata.call_site="send_sms_POST.xs:42"`
   - Endpoint returned `{success: true, twilio_sid: "SM…", twilio_status: 201, error: null}`

3. **Admin endpoint:** GET `/api:3e_TffpA/sms_enabled_status` (or whatever group it lands in) and confirm `sms_enabled: false`, gated count went up by 1, owner-bypass count went up by 1.

If all three pass, ship. If any fail, the gate pattern is wrong somewhere — debug before flipping `SMS_ENABLED=true`.

## When SMS_ENABLED is flipped to "true"

All paths become live. Owner bypass becomes a no-op (since `$gate_should_send` is true via `$gate_sms_enabled`). No `sms_owner_bypass` log fires when enabled. No `sms_gated` log fires when enabled. The gate code stays in place — it's just transparent.

To re-disable in an emergency: set `SMS_ENABLED="false"` in Xano. Effect is immediate on the next request (no redeploy needed; env vars are read per-invocation).

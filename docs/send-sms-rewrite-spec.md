# send_sms_POST.xs Rewrite Spec

**For:** Claude Code execution in `C:\Users\jpiva\Documents\code\tn-appliance-tools`
**Date:** 2026-05-19
**Companion to:** `docs/sms-architecture-2026-05-19.md`

---

## Goal

Refactor the existing Xano endpoint `send_sms_POST.xs` so that:

1. Telnyx is the **primary** SMS provider
2. Twilio remains a **fallback** code path, gated by the `SMS_PROVIDER` env var
3. The "from" number is chosen based on whether the recipient is a tech/internal user or a customer
4. The master kill-switch `SMS_ENABLED` short-circuits all sends when false
5. All hardcoded Twilio credentials are removed and replaced with env var references (security cleanup from genealogy)

---

## Inputs to the endpoint (assume existing signature, do not break callers)

The endpoint currently accepts something like:
- `to` (phone number, E.164 format)
- `body` (message text)
- Optional: `from_override`, `job_id`, `context_tag`

Preserve the existing input contract. Add internally what's needed for routing.

---

## Env vars to reference

```
TELNYX_API_KEY            (secret)
TELNYX_PROFILE_ID         = 40019e28-9488-4a86-aef9-764f7a8b2891
TELNYX_FROM_CUSTOMER      = +16155889500
TELNYX_FROM_TECH          = +16158578800
TELNYX_FROM_CUSTOMER_LA   (may not exist yet — handle missing gracefully)
SMS_PROVIDER              = telnyx                  # values: telnyx | twilio
SMS_ENABLED               = true                    # values: true | false

# Twilio fallback (existing, just move from hardcoded to env vars if not done)
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER        = +16292840444
```

---

## Routing pseudocode

```
function send_sms(to, body, [optional context]):

  // 1. Master kill-switch
  if env.SMS_ENABLED != "true":
    log_sms_attempt(to, body, status="skipped_disabled")
    return { success: false, reason: "SMS_ENABLED is false" }

  // 2. Determine the from number
  is_tech_or_internal = check_if_recipient_is_tech_or_office(to)
  // Check `technicians` table for to == phone_number
  // Also include known office staff numbers (Danielle 615-485-0713, owner 615-485-5795)

  if is_tech_or_internal:
    from_number = env.TELNYX_FROM_TECH
  else:
    // Customer SMS — determine TN vs LA
    customer_state = lookup_customer_state(to)  // optional, may be null
    if customer_state == "LA" and env.TELNYX_FROM_CUSTOMER_LA is not empty:
      from_number = env.TELNYX_FROM_CUSTOMER_LA
    else:
      from_number = env.TELNYX_FROM_CUSTOMER

  // 3. Provider selection
  provider = env.SMS_PROVIDER  // "telnyx" or "twilio"

  if provider == "telnyx":
    response = send_via_telnyx(to, body, from_number)
  else if provider == "twilio":
    response = send_via_twilio(to, body, env.TWILIO_FROM_NUMBER)
  else:
    log_error("unknown SMS_PROVIDER: " + provider)
    return { success: false, reason: "invalid provider" }

  // 4. Log to existing sms_log table
  log_sms_send(
    to: to,
    from: from_number,
    body: body,
    provider: provider,
    status: response.status,
    provider_message_id: response.id,
    context: context
  )

  return response
```

---

## Telnyx send function

```
function send_via_telnyx(to, body, from_number):
  // HTTP POST to https://api.telnyx.com/v2/messages
  // Headers:
  //   Authorization: Bearer {env.TELNYX_API_KEY}
  //   Content-Type: application/json
  // Body (JSON):
  //   {
  //     "from": from_number,
  //     "to": to,
  //     "text": body,
  //     "messaging_profile_id": env.TELNYX_PROFILE_ID
  //   }

  // On 200/202 response:
  //   return { success: true, id: response.data.id, status: response.data.to[0].status }
  // On error:
  //   log error code + meta, return { success: false, error: response.errors }
```

---

## Twilio send function (kept as failover)

```
function send_via_twilio(to, body, from_number):
  // Existing Twilio integration — refactor only to:
  //   1. Read TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN from env vars (not hardcoded)
  //   2. Return a normalized response shape matching send_via_telnyx
  //      { success, id, status, error }
```

---

## XanoScript rules to follow (from genealogy v1 §16 — non-negotiable)

- **No try/catch.** Use conditional checks on response status / error fields instead.
- **No em dashes** anywhere in code or strings.
- **No backtick expressions.** Use string concatenation or template patterns supported by XanoScript.
- **No closures.** Use top-level functions or inline logic.
- **Use `db.query` / `db.add` / `db.edit`** with data blocks for any DB ops.
- **Use `var.update`** for any variable mutations, never direct assignment in nested contexts.
- **Use `foreach` with the `each-as` pattern** for iteration.
- **Use XanoScript view only** to edit. Visual editor corrupts complex endpoints.
- **Logic Assistant scope must be tightly controlled** — it has wiped function stacks before. Only run it on the specific edit, not the whole endpoint.

---

## Helper: `check_if_recipient_is_tech_or_office`

```
function check_if_recipient_is_tech_or_office(phone_number):
  // 1. Query technicians table where phone == phone_number
  //    If found, return true
  // 2. Check against hardcoded office staff list:
  //    - 615-485-0713 (Danielle)
  //    - 615-485-5795 (Teddy / owner)
  //    If matched, return true
  // 3. Return false (default to customer routing)
```

Normalize phone numbers before comparison — strip non-digits, ensure E.164 format.

---

## Helper: `lookup_customer_state`

```
function lookup_customer_state(phone_number):
  // 1. Query customers table where phone == phone_number
  //    If found, return state field
  // 2. If not found, return null (caller falls back to TN customer number)
```

Optional, only used for LA routing. If the customers table lookup is expensive or unreliable, skip Phase 1 and just route everyone through TELNYX_FROM_CUSTOMER for now — Phase 2 adds LA routing when LA number is provisioned.

---

## Logging

Use the existing `sms_log` table (or whatever it's called in the workspace). Add columns if needed:

- `provider` — "telnyx" or "twilio"
- `provider_message_id` — the UUID from Telnyx or Twilio SID
- `from_number` — record which number was used
- `status` — "queued", "sent", "delivered", "failed", "skipped_disabled", etc.
- `error_code` and `error_detail` — for failures

Existing delivery-receipt webhook from Twilio should remain functional. A new `telnyx_delivery_webhook` endpoint will be needed (separate task, separate spec) to update message status from Telnyx callbacks.

---

## Testing checklist after rewrite

1. Send test SMS to owner cell (615-485-5795) — should route via tech number (615-857-8800) since owner is in the internal list. Confirm phone receives it.
2. Send test SMS to a known customer phone (use a test customer record) — should route via customer number (615-588-9500). Confirm phone receives it.
3. Set `SMS_ENABLED = false` temporarily, attempt send — confirm endpoint returns skipped and no SMS goes out.
4. Set `SMS_PROVIDER = twilio` temporarily, send — confirm Twilio path still works (this is the failover path validation).
5. Restore `SMS_PROVIDER = telnyx` and `SMS_ENABLED = true`.
6. Verify `sms_log` table has new entries with `provider = "telnyx"` and correct `provider_message_id`.

---

## What NOT to do in this rewrite

- Do not change the endpoint signature (caller-facing inputs).
- Do not remove the Twilio code path — keep it as failover.
- Do not refactor unrelated logic in the file (existing throttling, body length checks, etc., should remain).
- Do not push --force to the Xano workspace until the rewrite has been tested in the workspace UI manually first.
- Remember: `xano workspace push --force` correctly creates new tables/columns but silently fails to propagate nullability changes — verify any new columns are nullable as expected.

---

## Deliverable

A modified `send_sms_POST.xs` file in the workspace, following XanoScript rules, that implements the routing logic above. Then a test run of all six items in the testing checklist. Then deploy.

# Ant System Prompt — Consent Gate Addition

**Purpose:** force Ant to emit the `__SHOW_CONSENT_CHECKBOX__` trigger token at the right moment so the frontend renders the SMS consent gate before the phone-number step.

**Problem this fixes:** as of 2026-05-08, Ant's live system prompt does NOT mention the trigger token. The frontend gate (commit `b6673e6`) is plumbed correctly but never fires because Claude is never told to emit the token. User-testing confirmed: customer was asked for phone number with no consent card appearing. This is the exact failure mode TCR has rejected the campaign for 5 times.

**Where this lives:** Xano workspace env var `$env.SYSTEM_PROMPT`. Read by `xano-workspace/api/intake/chat/reply_2_POST.xs:103` and passed as the `system` parameter to Claude (`api.anthropic.com/v1/messages`) at line 147 of that file.

**How to deploy:** open Xano workspace → Environment Variables → edit `SYSTEM_PROMPT` → paste the section below into the existing prompt at the location described, save. No code push needed; the env var change takes effect on the next chat request.

---

## Where to insert in the existing prompt

Append the section below to the end of the existing `SYSTEM_PROMPT` content. If the existing prompt has a labeled "TOKENS" or "OUTPUT TOKENS" section that already describes `__READY_TO_SUBMIT__`, `__WARRANTY_READY__`, `__REQUEST_VIDEO__`, or `__REQUEST_MODEL_PHOTO__`, add the consent-gate token rule alongside those. Otherwise append at the end as a top-level rule block.

**Do not delete or modify any existing prompt content.** This is purely additive — a new compliance rule + a new token to emit + clarification on conversation order.

---

## Section to paste

```
═══════════════════════════════════════════════════════════════════════
SMS CONSENT GATE — STRICT ENFORCEMENT (TCR compliance, mandatory)
═══════════════════════════════════════════════════════════════════════

CONVERSATION ORDER (cash flow / Quick Check intake):

  1. Greet + ask what's broken
  2. Identify appliance, brand, symptom (gather details)
  3. Ask for / suggest a service tier ($50 Quick Check, $90 Video Call,
     $100 In-Home Visit) and confirm the customer's choice
  4. Ask for first name (or current step before phone, whatever it is)
  5. **EMIT THE CONSENT GATE TOKEN** — see below
  6. Wait for the customer to click one of two buttons
  7. Ask for phone number (only after consent decision is recorded)
  8. Continue: zip, scheduling preference, etc.
  9. Emit __READY_TO_SUBMIT__ when complete

THE CONSENT GATE TOKEN:

  Include this exact string anywhere in your reply at step 5:

      __SHOW_CONSENT_CHECKBOX__

  When this token appears in your reply, the frontend strips it from
  the displayed text and renders a full-width consent card with two
  buttons. The chat text input is hidden until the customer clicks one
  of them. The customer cannot type a phone number until they choose.

  Example reply at step 5 (after customer gave first name "Sarah"):

      "Got it, Sarah. Before I grab a phone number, I need your
      permission to text you. __SHOW_CONSENT_CHECKBOX__"

  The token can appear anywhere in the message. Plain trailing-token
  form (as above) is preferred for simplicity.

AFTER THE CUSTOMER CLICKS A BUTTON:

  You will receive ONE of these two follow-up user messages on the
  next turn:

  (A) "Yes, you can text me about my service."
      → Customer GRANTED SMS consent. Proceed normally:
        ask for the phone number.
        Acceptable continuation:
          "Perfect. What's the best phone number for confirmations
           and updates?"

  (B) "No, please do NOT text me. Voice contact only."
      → Customer DECLINED SMS consent. Acknowledge briefly and
        ask for the phone number FOR VOICE ONLY:
          "Got it — we'll only call you, never text. What's the
           best phone number to reach you for your appointment?"
        After this point, NEVER mention texting, SMS, or messaging
        in this conversation again. Phone number is for voice only.

HARD RULES (compliance — do not bend):

  • UNDER NO CIRCUMSTANCES ask for a phone number before emitting
    __SHOW_CONSENT_CHECKBOX__. This is the entire compliance fix.
    If you find yourself about to write "what's your phone" or
    "can I get your number" or similar, STOP and emit the token
    instead.

  • Emit the token exactly once per conversation. Do not re-emit
    it after the customer has already clicked a button.

  • If the customer types a phone number unprompted before consent
    has been recorded (e.g. they type "615-555-1234" instead of
    answering your question about the symptom), do NOT acknowledge
    or store the phone number. Instead reply with the consent gate:
      "Hold on — before we go further with phone, I need your
       permission to text you about your service.
       __SHOW_CONSENT_CHECKBOX__"

  • If the customer asks "why do you need consent" or "what does
    this card mean" or similar, explain briefly that we're a
    registered Tennessee LLC and TCR (the carrier compliance
    body) requires us to obtain explicit consent before texting.
    Then re-emit the token.

  • The phone number step ALWAYS comes after the consent gate.
    The consent gate ALWAYS comes after appliance/brand/symptom
    collection AND service tier selection. Order is fixed.

PRECEDENT:

  This is the same pattern as the other emit-tokens you already
  use (__READY_TO_SUBMIT__, __WARRANTY_READY__, __REQUEST_VIDEO__,
  __REQUEST_MODEL_PHOTO__). Token is silent to the customer (frontend
  strips it before display). It only triggers the UI state change.
═══════════════════════════════════════════════════════════════════════
```

---

## Verification after deployment

After saving the env var update in Xano:

1. **Trigger a fresh chat** at https://tnapplianceexchange.net (open in incognito to avoid stale conversation cache).
2. Walk through: appliance → brand → symptom → service tier acceptance → first name.
3. **Expected behavior:** the next Ant message ends the conversation with the consent card rendering. The chat text input disappears.
4. Click "Yes, text me about my service" → Ant should ask for phone number.
5. Open another fresh chat in incognito and run through the same flow, but click "No, call me only" instead. Ant should acknowledge ("we'll only call you, never text") and ask for phone number for voice only.

If the consent card does NOT appear at step 3:
- Open browser DevTools → Network tab → inspect the response from `agent-chat-proxy`. Look at the `reply` field — does it contain the literal string `__SHOW_CONSENT_CHECKBOX__`?
  - If NO: the prompt change didn't reach the live env var. Re-check the Xano dashboard.
  - If YES: there's a frontend bug stripping the token before rendering. Unlikely (we verified the listener at `index.html:1551`).

## Token placement note for future maintenance

The frontend strips the token via:

```js
text.replace(/__SHOW_CONSENT_CHECKBOX__/g, '').trim();
```

So the token can appear anywhere in Ant's reply (start, middle, end) and any number of times — it's all stripped. Trailing-token convention keeps replies readable while the frontend processes the trigger.

## What to do with this file after the prompt is deployed

Once the env var change is live and verified, this file can stay in `prompts/` as institutional record of what was added and why. Future prompt rewrites should preserve the consent-gate enforcement section verbatim or with equivalent strictness, since it's load-bearing for TCR compliance.

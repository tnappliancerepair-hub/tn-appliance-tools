# Phase 1c step 3b — `send_qc_diagnosis_to_customer` spec

**Status:** Spec only, NOT yet built. Built from Phase 1c step 3a (token signing) which shipped 2026-05-06. Build target: ~1-1.5 hours next session.

**Purpose:** When Teddy clicks "Send to Customer" in Teddy Tool after composing a TDR, this endpoint mints a signed token, sends the customer a TDR-ready SMS with a signed link, marks the TDR as sent, and transitions the job state from `prediagnosis_pending` → `diagnosis_sent`. Closes the 2-hour TDR delivery SLA window (from $50 payment → SMS sent).

---

## 1. Endpoint specification

**File:** `xano-workspace/api/cash_tdr/send_qc_diagnosis_to_customer_POST.xs`
**Method:** POST
**API group:** `cash_tdr`
**Auth:** Internal (technician identity check — see §6 open questions)

### Input

```
{
  tdr_id: int                  // required, the TDR header to send
  technician_id: int?           // optional, for audit trail (who clicked Send)
  expiry_seconds: int?          // optional, defaults to 604800 (7 days)
}
```

### Output (success)

```
{
  success: true,
  sent_to: "+1XXXXXXXXXX",     // bill_to phone (per multi-party)
  sent_at: "ISO8601",
  expires_at: "ISO8601",
  token_preview: "XXXX...XXXX"  // first/last 4 chars only, for audit display
}
```

### Output (failure)

```
{
  success: false,
  error: "human-readable error",
  reason: "missing_diagnosis" | "no_consent" | "token_mint_failed" | "sms_failed" | "tdr_not_found" | "already_sent" | "no_phone"
}
```

---

## 2. Implementation pseudocode

```
query send_qc_diagnosis_to_customer verb=POST {
  api_group = "cash_tdr"
  input { int tdr_id, int? technician_id?, int? expiry_seconds? }

  stack {
    // 1. Load TDR
    db.get technician_decision_report by id=$input.tdr_id as $tdr
    if $tdr == null: return { reason: "tdr_not_found" }

    // 2. Validate customer_facing_diagnosis is populated
    if ($tdr.customer_facing_diagnosis == null || $tdr.customer_facing_diagnosis == ""):
      return { reason: "missing_diagnosis", error: "Compose the customer-facing diagnosis before sending." }

    // 3. Idempotency check (locked policy: refuse second click)
    if $tdr.sent_to_customer_at != null:
      return { reason: "already_sent", error: "This TDR was already sent to the customer." }

    // 4. Load job and resolve bill_to customer
    db.get jobs by id=$tdr.job_id as $job
    var $bill_to_id = $job.bill_to_customer_id ?? $job.customer_id
    db.get customer by id=$bill_to_id as $bill_to

    // 5. Phone + consent check
    if $bill_to.phone == null || $bill_to.phone == "":
      return { reason: "no_phone" }
    if $bill_to.sms_consent != true:
      return { reason: "no_consent", error: "Customer has not consented to SMS. Call them instead." }

    // 6. Mint token via Netlify gateway
    api.request {
      url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/generate-qc-token"
      method = POST
      params = { job_id: $tdr.job_id, tdr_id: $tdr.id, expiry_seconds: $input.expiry_seconds ?? 604800 }
      headers = ["Content-Type: application/json", "X-Internal-Auth: " ~ $env.HCP_INTERNAL_AUTH_SECRET]
      timeout = 10
    } as $tokresp

    var $token = $tokresp.response.result.token
    var $expires_at = $tokresp.response.result.expires_at
    if $token == null || $token == "":
      return { reason: "token_mint_failed", error: "Could not generate link. Try again or contact engineering." }

    // 7. Compose SMS
    var $url = "https://tnapplianceexchange.net/cash-tdr-customer.html?token=" ~ $token
    var $first_name = $bill_to.first_name ?? "there"
    var $sms_body = "hi " ~ $first_name ~ " 🐜 — your tn appliance diagnosis is ready. here's what we found and your repair options: " ~ $url

    // 8. Send SMS
    api.request {
      url = $env.XANO_BASE ~ "/api:3e_TffpA/send_sms"
      method = POST
      params = { to: $bill_to.phone, message: $sms_body }
      ...
    } as $smsresp

    // (Note: send_sms currently returns null — see Open Question #2)

    // 9. Update TDR
    db.edit technician_decision_report id=$tdr.id with {
      sent_to_customer_at: now,
      public_view_token: $token,
      expires_at: $expires_at
    }

    // 10. Update jobs.qc_status + qc_diagnosis_sent_at
    db.edit jobs id=$tdr.job_id with {
      qc_status: "diagnosis_sent",
      qc_diagnosis_sent_at: now
    }

    // 11. Audit log
    db.add event_log with {
      action: "qc_diagnosis_sent_to_customer",
      metadata: {
        tdr_id: $tdr.id,
        job_id: $tdr.job_id,
        technician_id: $input.technician_id,
        bill_to_customer_id: $bill_to_id,
        sent_to: $bill_to.phone,
        token_preview: ($token|slice:0:4) ~ "..." ~ ($token|slice:-4)
      }
    }

    return {
      success: true,
      sent_to: $bill_to.phone,
      sent_at: now,
      expires_at: $expires_at,
      token_preview: ($token|slice:0:4) ~ "..." ~ ($token|slice:-4)
    }
  }
}
```

---

## 3. Teddy Tool UI changes (`teddy-tdr-tool.html`)

The "Send to Customer" button does NOT currently exist. Adding it:

**State machine** (current → after this change):
- Current: `submitTDR()` creates the TDR row and shows `state.submitResult`. End of flow.
- After 3b: `submitTDR()` creates the TDR row → success state shows TWO actions: (a) preview the customer view (open `cash-tdr-customer.html?token=preview` in new tab) and (b) "Send to Customer" button → calls `send_qc_diagnosis_to_customer` → success state shows "Sent at HH:MM" with link copied to clipboard option.

**New JS function:** `handleSendToCustomer()` — POSTs to `send_qc_diagnosis_to_customer` with `tdr_id` (from `state.submitResult.tdr.id`) and `technician_id` (from current Teddy session if known).

**New button** placed in the post-submit success block, visually distinct (orange primary CTA matching brand).

**Error handling in UI:**
- `missing_diagnosis` → "Add the customer-facing diagnosis first" inline error
- `no_consent` → "This customer hasn't consented to SMS. Call them at {phone}" with tap-to-call link
- `no_phone` → "No phone number on file. Update the customer record first."
- `already_sent` → show the previous send timestamp + "Already sent at HH:MM. Re-send?" (Phase 1+, defer)
- `token_mint_failed` / `sms_failed` → "Could not send. Try again, or contact engineering if it keeps happening."

---

## 4. SMS body template (LOCKED COPY proposal)

```
hi {first_name} 🐜 — your tn appliance diagnosis is ready. here's what we found and your repair options: {url}
```

Tone: lowercase, casual, hyphens (matches Customer Ant + Tech Ant template style guide). Includes brand mark 🐜 (per `ant_brand_mark_locked.md`). First name personalization. Direct URL (no link shortener; tnapplianceexchange.net is the trust signal).

Character count budget: ~150 chars typical (URL is ~100 chars due to long token). Single SMS segment for short first names; may split for longer names. Acceptable.

⚠️ The 2-hour SLA promised in Customer Ant + Stripe confirmation is NOT in this SMS body — by the time the customer receives this SMS, the SLA was already met (sending IS the SLA event). The SLA is upstream copy, not customer-facing here. (Worth confirming with Teddy.)

---

## 5. Error handling matrix

| Failure | Reason code | UI behavior | Audit log |
|---|---|---|---|
| TDR not found | `tdr_not_found` | "Could not find TDR. Refresh and try again." | `qc_send_failed` |
| customer_facing_diagnosis empty | `missing_diagnosis` | Inline error pointing to the field | `qc_send_failed` |
| Already sent | `already_sent` | Show previous send time | (no log; idempotent) |
| No phone on customer | `no_phone` | "Update customer record" | `qc_send_failed` |
| No SMS consent | `no_consent` | "Call them at {phone}" with tap-to-call | `qc_send_failed` |
| Netlify token mint fails | `token_mint_failed` | "Try again or contact engineering" | `qc_send_failed` |
| SMS send fails (e.g., TCR 30034) | `sms_failed` | "Try again. (TCR pending — see memory)" | `qc_send_failed` |

---

## 6. Open questions for Teddy review (before build)

1. **Idempotency policy.** Spec says: refuse the second click with "already_sent". Alternative: re-send same token (don't mint new), update sent_to_customer_at. Or: mint fresh token, keep most recent. Pick one. Recommendation: refuse + show "Already sent — Re-send anyway?" UI affordance for explicit override.

2. **send_sms returns null.** Current Xano `send_sms` doesn't propagate Twilio's status. So we can't actually detect "sms_failed" from Xano — we'd need to either (a) extend send_sms to return Twilio's response, (b) trust 201-queued = sent (status-201 false positive issue per memory), or (c) call Twilio directly from this endpoint instead of via send_sms. Recommendation: (a) — extend send_sms to return `{success, twilio_sid, error}`. ~10 min change.

3. **2-hour SLA in SMS body.** Currently NOT included since the SLA was about delivering the TDR, not about anything the customer reads. Confirm or override with a different SMS template.

4. **Permissions.** Spec proposes accepting `technician_id` as input for audit. No actual auth check. Two options: (a) trust Teddy Tool's session (risk: anyone hitting the endpoint with a tdr_id can fire), (b) add internal-auth header check (mirrors HCP pattern, requires Netlify gateway in front, scope creep). Recommendation: (a) for MVP since Teddy Tool is the only client today; revisit when there are more clients.

5. **TCR-blocked send during the resubmission window.** Until TCR clears, every SMS will fail with 30034. Should the endpoint mark `sent_to_customer_at` anyway (so Teddy can see his work) or only on confirmed delivery? Recommendation: mark on Twilio 201 (queued), accept the false-positive trade-off, since blocking on real delivery means the entire flow can't be tested until TCR clears.

6. **Reminder cron handoff.** Phase 1d builds `qc_choice_reminder` cron. This endpoint doesn't queue anything; the cron polls jobs by `qc_status='choice_pending' AND qc_diagnosis_sent_at < now - 24h`. No action needed in 3b.

7. **Customer view URL format.** Spec uses `https://tnapplianceexchange.net/cash-tdr-customer.html?token=...`. Confirm the canonical domain is correct (vs. the Netlify auto-assigned URL).

---

## 7. Build sequence (next session, ~1-1.5hr)

1. Extend `send_sms_POST.xs` to return `{success, twilio_sid, error}` (~10 min)
2. Write `send_qc_diagnosis_to_customer_POST.xs` (~30 min)
3. Push to Xano + smoke test with curl (~10 min)
4. Add "Send to Customer" button + flow to `teddy-tdr-tool.html` (~30 min)
5. End-to-end test: open Teddy Tool, load a job, fill TDR, submit, click Send → verify SMS body in Twilio dashboard (or wait for real delivery if TCR has cleared) (~10 min)
6. Commit Teddy Tool changes to git (Xano changes follow repo convention, no commit)

---

## 8. What this unlocks

Once 3b ships, the cash flow is end-to-end testable from Teddy's perspective:
1. Teddy fills TDR
2. Clicks Send to Customer
3. Customer gets SMS, taps link, sees the signed customer page
4. Customer makes selections, clicks Confirm and Pay
5. Phase 1c step 3c (Stripe Checkout) handles payment
6. Phase 1d reminder crons close the loop on incomplete decisions

3b is the bridge from "Phase 1a/1b infrastructure exists" to "real customers can flow through end-to-end."

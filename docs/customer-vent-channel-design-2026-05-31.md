# Customer Vent Channel (Low-Rating Capture) — Design

**Date:** 2026-05-31
**Status:** Design (not implemented)
**Trigger:** Customer rates 1-2 stars on post-job feedback SMS

---

## 1 · Why this is missing

Today's flow:
1. Customer rates 1-2 stars via `feedback_reply_webhook`
2. `customer_feedback_received.js` agent fires URGENT internal SMS to Teddy + Danielle
3. **No customer-facing redirect.** The customer who's frustrated has no in-system place to vent.

This is a problem because:
- The customer's next move is often a Google review where they vent publicly (bad for the business)
- They could also call/email, but most don't — they sit on the frustration
- We have no captured detail on WHAT went wrong, only the rating
- The cooling-off chance (typing it out → realizing it's not that bad) is lost

**Goal:** intercept low-rating customers with a "tell us what went wrong" link instead of letting them go straight to Google. We learn what happened, they feel heard, business protects its public rep.

---

## 2 · Scope

**In scope:**
- Customer-facing page at `/vent?customer_token=XYZ` (no PIN — token-gated)
- Optional fields: detail textarea, contact-callback request checkbox
- Submission → internal alert + audit row
- Acknowledgement screen + optional commitment to follow up
- Per-customer dedup (only one vent submission per job)

**Out of scope (Phase 1):**
- AI-powered customer reply (Phase 2 — `sms_response_complaint` agent could generate empathetic reply once vented)
- Multi-language support (English-only for now)
- Public review monitoring on Google / Yelp (separate workstream)

---

## 3 · Flow

```
24h post-completion:
  customer receives SMS "How'd we do? Rate 1-5."

Customer replies "1" or "2"
        │
        ▼
feedback_reply_webhook captures rating
        │
        ▼
customer_feedback_received.js:
  - fires URGENT internal SMS (existing) ✅
  - NEW: replies to customer SMS with vent-link
    "Sorry to hear that — we want to make this right. Tell us what
     happened: tnapplianceexchange.net/vent?t=XYZ
     - Teddy"
        │
        ▼
Customer taps link, lands on /vent
        │
        ▼
Page reads token, loads job + customer context (read-only display)
"Hi {first_name} — what happened on your {appliance} repair on {date}?"
        │
        ├── textarea (problem description, optional)
        │
        ├── checkbox: "Have Teddy call me about this" (default checked)
        │
        ├── submit button
        │
        ▼
POST /record_customer_vent → audit row + URGENT SMS to Teddy + Danielle
        │
        ▼
Acknowledgement page:
"Thanks {first_name}. We hear you. Teddy will personally call you within
24 hours to make this right.
- TN Appliance Exchange"
```

---

## 4 · Token format

`vent_<job_id>_<customer_id>_<random8>` — same pattern as existing customer portal tokens.

Stored in `event_log` with action="vent_token_issued" so the verifier can look it up.

---

## 5 · New endpoints

### 5.1 `get_vent_context_GET.xs`

**Input:** `{ token }`

**Flow:**
1. Look up vent_token_issued event_log row
2. Verify token not expired (7 days from rating receipt)
3. Verify not already submitted (no vent_submitted event_log for this token)
4. Return minimal-PII context: `{ first_name, appliance, job_date, tech_first_name }`

**Response:** `{ ok, context }` or `{ ok: false, error: 'expired' | 'already_submitted' | 'invalid_token' }`

### 5.2 `record_customer_vent_POST.xs`

**Input:** `{ token, description?, request_callback }`

**Flow:**
1. Verify token (same as 5.1)
2. Insert event_log row action="customer_vent_submitted" with metadata: `{ token, job_id, customer_id, description, request_callback }`
3. Emit `CUSTOMER_VENT_RECEIVED` colony signal with high strength
4. Return `{ ok, ack_message: "Thanks {first}, we'll be in touch within 24h." }`

---

## 6 · New page — `vent.html`

Minimal page, mobile-first:

```html
<header>
  Hi {first_name} — we're sorry your {appliance} repair didn't meet
  your expectations. Tell us what happened.
</header>

<textarea placeholder="What went wrong?" rows="6"></textarea>

<label>
  <input type="checkbox" checked> Have Teddy personally call me within 24h
</label>

<button>Submit</button>
```

After submit:
```
Thanks {first_name}.
Teddy will be in touch within 24 hours to make this right.
This stays between us — we won't ask you to update the review.
```

Aesthetics: light, calming, NOT branded heavily. Focus on the listener pose, not the brand.

---

## 7 · New agent — `customer_vent_received.js`

Consumes `CUSTOMER_VENT_RECEIVED`:
1. Load job + customer + vent details
2. Fire URGENT SMS to Teddy: `"[ant] CUSTOMER VENT — {first} {last} on job #X, {appliance}. Rating 1/2. Wants callback: {yes/no}. Detail: {first 200 chars}."`
3. Fire same to Danielle
4. Optionally: emit follow-up signal that triggers Teddy callback reminder if not done in 24h
5. Audit row: `customer_vent_handled`

---

## 8 · `customer_feedback_received.js` update

When rating = 1 or 2:
1. Existing URGENT internal SMS to Teddy + Danielle ✅
2. **NEW**: generate vent token (random 8 chars), store in event_log action="vent_token_issued", and **send customer SMS with vent link** (gated by CUSTOMER_FACING_ENABLED).
3. Existing: do NOT send Google review request (already skipped per current logic)

---

## 9 · Business rules

1. **Token expires in 7 days.** After that, vent link returns "this link has expired — call us at {phone}".
2. **One vent per job.** Re-submission attempts return "already received — Teddy will be in touch".
3. **High-rating chain is unchanged.** Vent only fires on 1-2 ratings.
4. **No public surface.** Vent page is not linked from anywhere except the SMS. No SEO.
5. **Recovery commitment:** acknowledgement page promises callback within 24h. Teddy's responsibility to fulfill or delegate. If it slides, that's worse than no vent channel.

---

## 10 · Effort estimate

- 2 endpoints: 1h
- 1 agent: 30 min
- 1 page: 1h
- Update existing agent: 15 min
- Smoke test: 30 min

**Total: ~3-4 hours.** Ship Wednesday 6/3 per the activation plan.

---

## 11 · Open questions

1. **Do we offer a discount on next visit?** As a goodwill gesture. Could be auto-added to next job invoice via `customer.vent_credit` column. **Recommend: not in Phase 1. Teddy decides per-case on the callback.**
2. **Should the vent SMS arrive immediately on 1-2 reply, or after a 30-min cooling period?** Immediate = more capture; delayed = lets customer cool off first. **Recommend: immediate.** A frustrated customer who's still on their phone is the highest-capture moment.
3. **What if the customer DOESN'T tap the link?** Internal alert still fires. Teddy reaches out cold. The vent link is a courtesy, not the only escape valve.

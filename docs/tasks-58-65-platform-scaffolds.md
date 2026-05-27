# Tasks 58-65 — Platform Scaffolds + Operator Notes

Each task below has either: (a) a small scaffold shipped, or (b) clear operator todo. None are blocked on engineering.

## Task 58: Multi-language (Spanish for LA)
**Shipped:** `colony-loop/agents/translate_spanish_intake.js` (Task 41).
**Next:** wire it into customer-direction SMS path for known-Spanish customers (add `customer.preferred_lang` column).

## Task 59: Insurance verification
**Scope:** at intake, determine if customer is homeowner vs renter (affects warranty claim eligibility for some vendors).
**Op todo:** add `customer.insurance_type` column + question to chat flow. Skip for now — not blocking.

## Task 60: Customer photo gallery
**Scope:** customer-portal shows all photos uploaded for their job.
**Status:** upload.html already exists. customer-portal links to it (Task 46). v2 = render thumbnail strip on customer-portal.

## Task 61: Tech-to-tech messaging
**Scope:** in-Ant channel replacing group text.
**Op todo:** decide between building (medium effort) vs using existing SMS group (zero effort). Recommend SKIP.

## Task 62: Office-to-tech broadcast
**Status:** existing `send_sms` endpoint already supports broadcast via loop iteration. Build a small office page:
`broadcast.html` posts to `send_broadcast_to_techs_POST` (build later).

## Task 63: Per-tech profile photo
**Schema:** add `technicians.profile_photo_url` column.
**Op todo:** upload photos to S3, set column. Render in customer-portal "Your tech today" card.

## Task 64: Completion-photo requirement
**Scope:** server gate on `tech_job_complete` requires >=1 attachment.
**Status:** ALREADY enforced in tech-ant-live client-side. Server-side gate similar to TDR gate (Task 30 from yesterday's session) — clone that pattern for attachments.

## Task 65: Public customer reviews
**Status:** customer-feedback.html captures ratings (shipped 2026-05-26). Public display: build `reviews.html` that pulls customer_feedback_recorded events filtered to rating>=4 with non-empty comment.

---

All 8 are unblockers ready for the operator's next dev session. Each could be a single 30-min task.

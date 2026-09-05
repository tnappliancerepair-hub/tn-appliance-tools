-- 052_intake_tee.sql — full-fidelity intake tee (Xano → ANT Platforms), run in the
-- ANT Platforms project AFTER 007_intake.sql + 033_schema_reconcile.sql.
--
-- Purpose: platform-tn-intake-tee copies every customer intake asset from the legacy
-- Xano system onto the platform in parallel (video · photos · availability · waiver) so
-- the new system is a real backup. Availability already rides the mirror
-- (customer_preference_text -> job.availability). Video/photos land in job_media. This
-- migration adds the two waiver fields the platform lacked (so the FULL waiver — the
-- signature image + exactly what the customer agreed/declined — is preserved), and a
-- unique index on job_media so the tee can upsert media idempotently.

-- Full waiver fidelity on the job (007 already added waiver_name + waiver_signed_at).
alter table public.job add column if not exists waiver_signature_ref text;   -- R2 key of the drawn signature image
alter table public.job add column if not exists waiver_ack           jsonb;  -- structured agreed/declined record (release, hoses, leak-kit…)

-- Idempotency for the tee: a media ref (cfstream uid or R2 object key) is unique per
-- shop, so re-runs upsert-in-place instead of duplicating. Existing intake rows carry
-- unique refs (random storage paths / distinct uids) so this never collides with them.
create unique index if not exists job_media_company_ref_uidx on public.job_media (company_id, ref);

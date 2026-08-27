-- 013_tdr_part_status — the part disposition on a TDR, matching TN's proven set:
-- please_order (office needs to order it) · truck (came off the tech's truck stock) ·
-- used (installed) · return (old/unused part to send back) · missing (not here / discrepancy).
-- Idempotent; run in the ANT Platforms Supabase project.
alter table public.job_tdr add column if not exists part_status text;

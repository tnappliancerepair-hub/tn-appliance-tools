-- 018_job_status_times.sql — timestamps for the tech's status tiles. Run in the ANT
-- Platforms project. The cockpit's big On-my-way / Start-Pause / Complete row records these
-- so it can show "On way 11:29am · Started 11:45am · Done 12:40pm". Optional: the cockpit
-- works without them (the tiles just won't show the times), so this is safe to run anytime.
alter table public.job add column if not exists en_route_at   timestamptz;
alter table public.job add column if not exists started_at    timestamptz;
alter table public.job add column if not exists completed_at   timestamptz;

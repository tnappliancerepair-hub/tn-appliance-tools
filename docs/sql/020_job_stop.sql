-- 020_job_stop.sql — multi-machine at ONE stop. Run in the ANT Platforms project.
-- Some visits cover more than one machine (a washer AND a dryer on the same trip, an AHS
-- multi-item claim). Each machine stays its OWN job (its own report / parts / status) but
-- they're linked by a shared stop_id so the cockpit shows a machine switcher + "＋ Add
-- machine". The FIRST job of the stop is the anchor: its stop_id = its own id; siblings
-- created with "Add machine" copy that stop_id. Null stop_id = a normal single-machine job.
alter table public.job add column if not exists stop_id uuid;
create index if not exists job_stop_idx on public.job (stop_id);

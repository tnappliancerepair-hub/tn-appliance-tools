-- 031_first_stop_auto.sql — make FIRST-VISIT-FIX real for every shop. Run in ANT Platforms.
--
-- job.first_stop drives the leaderboard "First-Stop King" crown + the owner's first-visit-fix
-- rate, but nothing set it for a normal tenant (only the TN mirror did). This trigger sets it
-- honestly from the job's own lifecycle, server-side, so BOTH the tech app and the office
-- board get it for free:
--   • entering 'awaiting_parts'  => this job needed a return trip  => first_stop = false
--   • reaching 'completed' while first_stop is still unset => fixed on the first visit => true
-- Sticky once set: a job that went awaiting_parts (false) then later completes stays false
-- (it took two trips). Idempotent.

create or replace function public.job_first_stop_touch()
returns trigger language plpgsql as $$
begin
  if new.status = 'awaiting_parts' and (old.status is distinct from 'awaiting_parts') and new.first_stop is null then
    new.first_stop := false;
  end if;
  if new.status = 'completed' and (old.status is distinct from 'completed') and new.first_stop is null then
    new.first_stop := true;
  end if;
  return new;
end $$;

drop trigger if exists job_first_stop on public.job;
create trigger job_first_stop before update on public.job
  for each row execute function public.job_first_stop_touch();

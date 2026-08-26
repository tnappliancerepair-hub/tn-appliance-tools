-- Phase 0 Part B — per-job read mirror.
-- Stores the FULL get_job_for_dashboard payload per job so the tech app can open a
-- job INSTANTLY even when Xano is slow/down. job-view-fast tries Xano first (short
-- time-box, for freshness) and falls back to this mirror when Xano can't answer, so a
-- read never hangs on a bad Xano. Populated opportunistically (every healthy read
-- through job-view-fast upserts here) + pre-warmed by job-mirror-sync-cron for today's
-- active jobs. Run in the ANT OPS Supabase project (same one as board_mirror /
-- tdr_pending).

create table if not exists job_mirror (
  job_id      bigint primary key,
  payload     jsonb not null,        -- exact get_job_for_dashboard response ({success,job,tech,customer,appliance,all_tdrs,...})
  updated_at  timestamptz not null default now()
);

-- staleness-ordered pre-warm (cron refreshes the oldest first)
create index if not exists job_mirror_updated on job_mirror (updated_at);

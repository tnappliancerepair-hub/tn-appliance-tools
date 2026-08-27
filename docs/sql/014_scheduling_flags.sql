-- 014_scheduling_flags.sql — tech-flagged scheduling hints. Run in the ANT Platforms project.
-- The tech taps these on-site in the cockpit; the office sees the flags on the board so it can
-- block the right slot next time — a wider window for a long job, or a second tech for a
-- two-man job. RLS on public.job already covers these columns (tenant-scoped).
alter table public.job add column if not exists needs_two_techs boolean not null default false;
alter table public.job add column if not exists long_job        boolean not null default false;

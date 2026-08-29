-- 046_call_score.sql — per-tenant phone-AI accuracy history (the Phase 5 flywheel).
--
-- Each run audits the shop's ACTIVE jobs through the real call brain and grades whether Ann
-- would answer correctly (right day, right tech / "your technician", never an invented clock
-- time). Storing a row per run gives the owner a trend — the "measurably better every day"
-- signal. Populated by platform-call-score-cron (daily) + on-demand runs.

create table if not exists public.call_score (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  ran_at      timestamptz not null default now(),
  sampled     int not null default 0,            -- active jobs audited
  correct     int not null default 0,            -- answered cleanly (all applicable checks pass)
  pct         int not null default 0,            -- correct/sampled * 100 (100 when nothing to audit)
  no_time_ok  int not null default 0,            -- answers with no invented clock time
  day_ok      int not null default 0,            -- scheduled jobs whose answer names the right day
  tech_ok     int not null default 0,            -- names the tech, or "your technician" when none
  gaps        int not null default 0,            -- scheduled-but-no-day data gaps Ann had to hedge
  detail      jsonb not null default '{}'::jsonb -- sample mismatches / gap job ids
);

create index if not exists call_score_company_idx on public.call_score (company_id, ran_at desc);

alter table public.call_score enable row level security;
drop policy if exists call_score_sel on public.call_score;
create policy call_score_sel on public.call_score
  for select using (company_id = public.current_company_id());
-- no client insert/update — written server-side (service key) only.

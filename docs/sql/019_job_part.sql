-- 019_job_part.sql — per-job PARTS tracker (the chargeback shield). Run in the ANT Platforms
-- project. A job can need several parts; each is its own row the tech works from the cockpit:
--   order_status : to_order  (put it on the office parts queue)
--                  claim_only (just record the part # for the claim — not ordered)
--                  ordered   (office marked it ordered)
--   disposition  : used | return | not_here   (once it arrives + he installs it)
-- 'return' parts are what must ship back or the shop eats a chargeback — the cockpit counts them.
-- RLS scopes every row to the shop; the tech's own session does the reads/writes.
create table if not exists public.job_part (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  job_id        uuid not null references public.job(id) on delete cascade,
  name          text,
  number        text,
  order_status  text check (order_status in ('to_order','claim_only','ordered')),
  disposition   text check (disposition in ('used','return','not_here')),
  photo_ref     text,
  created_at    timestamptz not null default now()
);
create index if not exists job_part_job_idx on public.job_part (job_id);
create index if not exists job_part_company_idx on public.job_part (company_id);

alter table public.job_part enable row level security;
drop policy if exists job_part_tenant on public.job_part;
create policy job_part_tenant on public.job_part
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.job_part to authenticated;

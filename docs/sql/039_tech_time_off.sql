-- 039_tech_time_off.sql — scheduling smarts, part 1: day-off / PTO. A tech (self-serve) or the
-- office marks days a tech isn't working; the dispatch board zero-caps + greys those tech-days so
-- nobody gets booked when they're off. Tenant-scoped RLS (a shop's own staff manage their own).
-- Run in ANT Platforms.
create table if not exists public.tech_time_off (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  technician_id uuid not null references public.technician(id) on delete cascade,
  day           date not null,
  reason        text,
  created_at    timestamptz not null default now(),
  unique (technician_id, day)
);
create index if not exists tech_time_off_company_idx on public.tech_time_off (company_id, day);

alter table public.tech_time_off enable row level security;
drop policy if exists tech_time_off_tenant on public.tech_time_off;
create policy tech_time_off_tenant on public.tech_time_off
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.tech_time_off to authenticated;

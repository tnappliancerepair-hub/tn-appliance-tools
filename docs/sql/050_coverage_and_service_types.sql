-- 050_coverage_and_service_types.sql — scheduling smarts, part 4: RANKED per-area coverage +
-- per-tech service types. Run in ANT Platforms. Idempotent.
--
-- Two additions the dispatch board + future auto-scheduler consume:
--   • coverage        — the per-AREA ranked backup chain. For each ZIP (or 3-digit prefix) a shop
--                       serves, an ordered list of techs (rank 1 = first choice, up to 5). Guys go
--                       on vacation → the office/CSR sets 1st/2nd/3rd so the scheduler has fallbacks.
--                       Isolated from pay (its own table) so a CSR can own it WITHOUT any access to
--                       the commission-bearing technician table → csr is in ALL of its write policies.
--   • technician.service_types — CSV of what a tech services (washer,dryer,stove,dishwasher,
--                       microwave,fridge,sealed). Blank = does everything. Set with the tech
--                       (owner/office), so it rides the existing technician write policy (030).
-- The legacy technician.service_area (040) stays as the backstop: a ZIP with no coverage rows falls
-- back to service_area, so shops that haven't built a chain keep exactly today's behavior.

-- ── per-tech service types ───────────────────────────────────────────────────────────────────────
alter table public.technician add column if not exists service_types text;

-- company_roster feeds the dispatch board — return service_types too. Drop first (return-type change).
drop function if exists public.company_roster();
create or replace function public.company_roster()
returns table(id uuid, name text, active boolean, max_stops integer, service_area text, service_types text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.active, t.max_stops, t.service_area, t.service_types
  from public.technician t
  where t.company_id = public.current_company_id()
  order by t.name
$$;
revoke all on function public.company_roster() from public;
grant execute on function public.company_roster() to authenticated;

-- ── ranked per-area coverage chain ───────────────────────────────────────────────────────────────
create table if not exists public.coverage (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  zip         text not null,                                             -- full ZIP or 3-digit prefix
  tech_id     uuid not null references public.technician(id) on delete cascade,
  rank        integer not null default 1,                               -- 1 = first choice … up to 5
  created_at  timestamptz not null default now(),
  unique (company_id, zip, rank),                                        -- one tech per rank per area
  unique (company_id, zip, tech_id)                                      -- a tech appears once per area
);
create index if not exists coverage_company_zip_idx on public.coverage (company_id, zip);
create index if not exists coverage_tech_idx        on public.coverage (tech_id);

alter table public.coverage enable row level security;

drop policy if exists coverage_read on public.coverage;
drop policy if exists coverage_ins  on public.coverage;
drop policy if exists coverage_upd  on public.coverage;
drop policy if exists coverage_del  on public.coverage;

-- Coverage is not sensitive like pay → csr is included in every write policy so the CSR can manage
-- the ranked chain. All ops are company-scoped. (Reads open to the whole shop incl. techs.)
create policy coverage_read on public.coverage for select using (
  company_id = public.current_company_id()
);
create policy coverage_ins on public.coverage for insert with check (
  company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin','csr')
);
create policy coverage_upd on public.coverage for update
  using      (company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin','csr'))
  with check (company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin','csr'));
create policy coverage_del on public.coverage for delete using (
  company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin','csr')
);

-- 036_tech_capacity.sql — per-tech daily capacity so the dispatch board stops using one
-- hardcoded "6 stops for everyone." An owner sets each tech's stops/day; dispatch shows real
-- open/low/full availability per tech. Defaults to 6 when unset (no behavior change until set).
-- Run in ANT Platforms.

alter table public.technician add column if not exists max_stops integer;

-- company_roster feeds the dispatch board + crew UI — return max_stops too (name-only, still
-- no commission, per 030's pay-privacy rule). Drop first: can't change a function's return type
-- with create-or-replace.
drop function if exists public.company_roster();
create or replace function public.company_roster()
returns table(id uuid, name text, active boolean, max_stops integer)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.active, t.max_stops
  from public.technician t
  where t.company_id = public.current_company_id()
  order by t.name
$$;
grant execute on function public.company_roster() to authenticated;

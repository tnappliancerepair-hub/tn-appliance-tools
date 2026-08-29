-- 040_tech_service_area.sql — scheduling smarts, part 2: service zones. Each tech gets a service
-- area (comma-separated ZIP prefixes or full ZIPs, e.g. "370,371,384"). The dispatch board matches
-- a job's ZIP to the techs who cover it — covering techs sort first + get a ⭐, and assigning a job
-- to a tech outside their area warns first. Empty area = covers everywhere (no change). Run in ANT Platforms.
alter table public.technician add column if not exists service_area text;

-- company_roster feeds the dispatch board — return service_area too. Drop first (return type change).
drop function if exists public.company_roster();
create or replace function public.company_roster()
returns table(id uuid, name text, active boolean, max_stops integer, service_area text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.active, t.max_stops, t.service_area
  from public.technician t
  where t.company_id = public.current_company_id()
  order by t.name
$$;
grant execute on function public.company_roster() to authenticated;

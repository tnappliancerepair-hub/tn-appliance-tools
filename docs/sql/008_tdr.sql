-- 008_tdr.sql — the TECHNICIAN DECISION REPORT (completion capture) + the cross-shop
-- BRAIN. Run AFTER 004 in the ANT Platforms project. THE MOAT: every shop's completions
-- (and failed completions) become training data no competitor can replicate.
--
-- A tech completes a job → structured TDR (brand/model/symptom → failed component + part +
-- outcome). Failed completions (a fix that didn't hold) are captured via held=false /
-- outcome='return_needed' — negative signal is half the intelligence. Then brain_lookup()
-- reads ACROSS ALL shops (anonymized) to tell any tech "what usually fixes this," which is
-- smart on day one for a brand-new shop and only gets smarter as more shops join.

create table if not exists public.job_tdr (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.company(id) on delete cascade,
  job_id           uuid not null references public.job(id) on delete cascade,
  -- denormalized brain keys (confirmed by the tech on site — clean data)
  appliance        text,
  brand            text,
  model            text,
  symptom          text,
  -- the outcome
  failed_component text,
  part_number      text,
  root_cause       text,
  outcome          text not null default 'fixed' check (outcome in ('fixed','return_needed','not_fixable')),
  held             boolean not null default true,     -- did the fix hold? false = came back (failed completion)
  reopened_at      timestamptz,
  notes            text,
  tech             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id)
);
create index if not exists job_tdr_company_idx on public.job_tdr (company_id);
create index if not exists job_tdr_brain_idx on public.job_tdr (brand, model);
drop trigger if exists job_tdr_touch on public.job_tdr;
create trigger job_tdr_touch before update on public.job_tdr for each row execute function public.set_updated_at();

-- staff read/write their own tenant's TDRs (RLS)
alter table public.job_tdr enable row level security;
drop policy if exists job_tdr_tenant on public.job_tdr;
create policy job_tdr_tenant on public.job_tdr
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.job_tdr to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════
-- THE BRAIN — cross-shop aggregate. SECURITY DEFINER so it reads every shop's TDRs, but
-- returns ONLY anonymized failure stats (no customer, no shop identity beyond a count).
-- Any shop calls it and benefits from the collective data — the network-effect moat.
-- ════════════════════════════════════════════════════════════════════════════════════
create or replace function public.brain_lookup(p_brand text, p_model text default null, p_symptom text default null)
returns table(failed_component text, part_number text, fixes bigint, comebacks bigint, held_rate numeric, shops bigint)
language sql stable security definer set search_path = public as $$
  select failed_component, part_number,
         count(*) filter (where outcome = 'fixed' and held) as fixes,
         count(*) filter (where outcome = 'return_needed' or not held) as comebacks,
         round(avg(case when held then 1 else 0 end)::numeric, 2) as held_rate,
         count(distinct company_id) as shops
  from public.job_tdr
  where failed_component is not null and failed_component <> ''
    and (p_brand   is null or p_brand   = '' or lower(brand) = lower(p_brand))
    and (p_model   is null or p_model   = '' or lower(model) = lower(p_model))
    and (p_symptom is null or p_symptom = '' or symptom ilike '%' || p_symptom || '%')
  group by failed_component, part_number
  order by fixes desc, comebacks asc
  limit 8
$$;
grant execute on function public.brain_lookup(text,text,text) to authenticated, anon;

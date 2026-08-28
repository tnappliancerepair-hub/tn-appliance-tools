-- brain_outcome: the SHARED, de-identified repair-knowledge corpus. Lives in ANT OPS
-- (no tenant operational data here). Every closed job across every tenant contributes
-- ONE de-identified row: model -> symptom -> failed component -> part -> did-it-fix.
-- NO customer PII, NO price, NO shop identity is ever exposed to a reading tenant.
-- contributed_by/quality/quarantined are INTERNAL-ONLY (quality control), never returned
-- by an aggregate read. No RLS needed: there is nothing person-identifying to protect.
create table if not exists public.brain_outcome (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  source           text,                 -- 'tn' | 'platform' | ...
  contributed_by   text,                 -- internal tenant key (company_id/slug); NEVER exposed
  appliance        text,
  brand            text,
  model            text,                 -- raw model as entered
  platform_family  text,                 -- derived family key (WTW5000DW <- WTW5000DW1)
  symptom          text,                 -- scrubbed complaint (de-identified)
  failed_component text,
  part_number      text,
  fault_code       text,
  fixed_first_trip boolean,              -- the grade / outcome
  fixed            boolean,              -- fixed at all (broader)
  quality          numeric not null default 1,     -- internal weight (down-weight bad contributors)
  quarantined      boolean not null default false, -- internal kill switch
  dedup_key        text unique           -- source|job -> one contribution per job
);
create index if not exists brain_outcome_family_idx on public.brain_outcome (platform_family);
create index if not exists brain_outcome_model_idx  on public.brain_outcome (model);
create index if not exists brain_outcome_ba_idx     on public.brain_outcome (brand, appliance);
create index if not exists brain_outcome_created_idx on public.brain_outcome (created_at);

-- ---- aggregate read functions (the ONLY egress from the corpus) ----
-- Aggregate-only reads over brain_outcome. These are the ONLY egress from the corpus.
-- They return ranked knowledge (component -> part -> confidence) pooled across ALL
-- contributing shops, grade-weighted by whether the repair actually fixed the machine.
-- They NEVER return a raw row, a shop identity, a price, or a customer. The only
-- shop-level fact returned is contributor_count (how many DISTINCT shops observed it),
-- so the caller can enforce a "needs >= N shops before we surface it" threshold.

-- common failures for a platform family (preferred) or brand+appliance (fallback).
create or replace function public.brain_common_failures(
  p_family text default null,
  p_brand  text default null,
  p_appliance text default null
) returns table (
  failed_component text,
  part_number      text,
  observations     bigint,
  contributor_count bigint,
  fix_rate         numeric,
  first_trip_rate  numeric,
  score            numeric
) language sql stable as $$
  with pool as (
    select o.* from public.brain_outcome o
    where o.quarantined = false
      and (
        (p_family is not null and o.platform_family is not null
           and upper(o.platform_family) = upper(p_family))
        or (p_family is null and p_brand is not null and p_appliance is not null
           and upper(coalesce(o.brand,'')) = upper(p_brand)
           and upper(coalesce(o.appliance,'')) = upper(p_appliance))
      )
      and coalesce(o.failed_component,'') <> ''
  )
  select
    failed_component,
    coalesce(nullif(part_number,''),'(no part #)') as part_number,
    count(*) as observations,
    count(distinct contributed_by) as contributor_count,
    round(avg(case when fixed then 1 else 0 end)::numeric, 3) as fix_rate,
    round(avg(case when fixed_first_trip then 1 else 0 end)::numeric, 3) as first_trip_rate,
    -- grade-weighted: a first-trip fix counts 2, an eventual fix 1, a non-fix 0.25,
    -- each scaled by the contributor's internal quality weight.
    round(sum(quality * (case when fixed_first_trip then 2.0
                              when fixed then 1.0 else 0.25 end))::numeric, 2) as score
  from pool
  group by failed_component, coalesce(nullif(part_number,''),'(no part #)')
  order by score desc, observations desc
  limit 25;
$$;

-- predict the single most likely part for a machine+symptom, family-first then brand+appliance.
create or replace function public.brain_predict_part(
  p_family text default null,
  p_brand  text default null,
  p_appliance text default null,
  p_symptom text default null
) returns table (
  part_number text,
  failed_component text,
  observations bigint,
  contributor_count bigint,
  fix_rate numeric,
  score numeric
) language sql stable as $$
  with pool as (
    select o.* from public.brain_outcome o
    where o.quarantined = false
      and coalesce(nullif(o.part_number,''),'') <> ''
      and (
        (p_family is not null and upper(coalesce(o.platform_family,'')) = upper(p_family))
        or (p_family is null and p_brand is not null and p_appliance is not null
            and upper(coalesce(o.brand,'')) = upper(p_brand)
            and upper(coalesce(o.appliance,'')) = upper(p_appliance))
      )
      and (p_symptom is null or p_symptom = ''
           or o.symptom ilike '%' || p_symptom || '%'
           or o.failed_component ilike '%' || p_symptom || '%')
  )
  select
    part_number,
    (array_agg(failed_component order by (case when fixed_first_trip then 2 when fixed then 1 else 0 end) desc))[1] as failed_component,
    count(*) as observations,
    count(distinct contributed_by) as contributor_count,
    round(avg(case when fixed then 1 else 0 end)::numeric,3) as fix_rate,
    round(sum(quality * (case when fixed_first_trip then 2.0 when fixed then 1.0 else 0.25 end))::numeric,2) as score
  from pool
  group by part_number
  order by score desc, observations desc
  limit 10;
$$;

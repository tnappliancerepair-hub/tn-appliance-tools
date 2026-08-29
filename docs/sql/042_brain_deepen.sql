-- 042_brain_deepen.sql — DEEPEN THE BRAIN (the #1 north star, platform edition). The old
-- brain_lookup read only job_tdr with an exact brand+model match — starved (few TDRs) and brittle.
-- This rebuilds it as a grounded, TIERED, trade-aware, cross-shop flywheel over the LIVE tables:
--   pool = every completed job's TDR (component→part→outcome) UNION every USED part logged
--          (a part installed on a completed job IS knowledge, even without a formal TDR),
--          joined job→unit (brand/model/kind) + company (trade).
-- It picks the BEST tier that has data — this exact model → model family → brand → unit type →
-- your whole trade — so a shop with thin history still gets grounded answers from same-trade peers.
-- De-identified: returns ONLY component/part/counts/distinct-shop-count/tier/confidence. No
-- customer, no shop identity, no price. SECURITY DEFINER = it pools across shops (the moat) while
-- the caller only ever sees anonymized aggregates. Run in ANT Platforms.

-- generic model-family key: strip a trailing revision run of digits that follows a letter
-- (WTW5000DW1 -> WTW5000DW). Non-appliance models simply don't match the family tier (they fall
-- back to brand/type), so this is safe cross-trade.
create or replace function public.brain_family(m text)
returns text language sql immutable as $$
  select case when m is null or length(btrim(m)) < 4 then null
              else upper(regexp_replace(btrim(m), '([A-Za-z])[0-9]+$', '\1')) end
$$;

drop function if exists public.brain_lookup(text, text, text);
create or replace function public.brain_lookup(
  p_brand text default '', p_model text default '', p_symptom text default '',
  p_unit_kind text default '', p_trade text default ''
) returns table(
  failed_component text, part_number text,
  fixes bigint, comebacks bigint, observations bigint, shops bigint,
  tier text, confidence text
) language sql stable security definer set search_path = public as $$
  with pool as (
    -- (a) completion reports
    select j.company_id,
           coalesce(nullif(t.brand,''), u.attributes->>'brand', '')  as brand,
           coalesce(nullif(t.model,''), u.attributes->>'model', '')  as model,
           coalesce(nullif(u.kind,''), nullif(u.label,''), t.appliance, '') as kind,
           coalesce(c.trade,'') as trade,
           coalesce(nullif(t.symptom,''), j.problem, '') as symptom,
           nullif(btrim(t.failed_component),'') as failed_component,
           nullif(btrim(t.part_number),'') as part_number,
           (coalesce(t.outcome,'fixed') <> 'return_needed') as fixed,
           (coalesce(t.outcome,'') = 'fixed' and coalesce(t.held,false)) as first_trip
    from public.job_tdr t
    join public.job j on j.id = t.job_id
    left join public.unit u on u.id = j.unit_id
    join public.company c on c.id = j.company_id
    where nullif(btrim(t.failed_component),'') is not null
    union all
    -- (b) parts actually used on completed jobs (knowledge even without a TDR)
    select j.company_id,
           coalesce(u.attributes->>'brand','') as brand,
           coalesce(u.attributes->>'model','') as model,
           coalesce(nullif(u.kind,''), nullif(u.label,''), '') as kind,
           coalesce(c.trade,'') as trade,
           coalesce(j.problem,'') as symptom,
           coalesce(nullif(btrim(p.name),''), 'part used') as failed_component,
           nullif(btrim(p.number),'') as part_number,
           true as fixed, false as first_trip
    from public.job_part p
    join public.job j on j.id = p.job_id
    left join public.unit u on u.id = j.unit_id
    join public.company c on c.id = j.company_id
    where j.status = 'completed'
      and nullif(btrim(p.number),'') is not null
      and coalesce(p.disposition,'') in ('used','')
  ),
  scored as (
    select pool.*, case
        when p_model<>''     and upper(model)=upper(p_model) then 4
        when p_model<>''     and model<>'' and public.brain_family(model)=public.brain_family(p_model) then 3
        when p_brand<>''     and upper(brand)=upper(p_brand) then 2
        when p_unit_kind<>'' and upper(kind)=upper(p_unit_kind) then 1
        when p_trade<>''     and upper(trade)=upper(p_trade) then 0
        else -1 end as tiernum
      from pool
  ),
  maxt as (select max(tiernum) as t from scored where tiernum >= 0),
  tierrows as (select s.* from scored s, maxt where maxt.t is not null and s.tiernum = maxt.t),
  symmatch as (select exists(select 1 from tierrows where p_symptom<>'' and symptom ilike '%'||p_symptom||'%') as has),
  use_rows as (
    select tr.* from tierrows tr, symmatch sm
    where (not sm.has) or (tr.symptom ilike '%'||p_symptom||'%')
  )
  select
    failed_component,
    coalesce(part_number,'') as part_number,
    count(*) filter (where fixed) as fixes,
    count(*) filter (where not fixed) as comebacks,
    count(*) as observations,
    count(distinct company_id) as shops,
    (select case (select t from maxt)
       when 4 then 'this exact model' when 3 then 'this model family'
       when 2 then 'this brand' when 1 then 'this type' when 0 then 'your trade' else '' end) as tier,
    case when count(distinct company_id) >= 3 and count(*) >= 5 then 'high'
         when count(*) >= 3 then 'medium' else 'building' end as confidence
  from use_rows
  group by failed_component, coalesce(part_number,'')
  order by sum(case when first_trip then 2.0 when fixed then 1.0 else 0.25 end) desc, count(*) desc
  limit 6
$$;
grant execute on function public.brain_family(text) to anon, authenticated;
grant execute on function public.brain_lookup(text, text, text, text, text) to anon, authenticated;

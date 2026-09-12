-- 071_brain_hygiene.sql — stop the troubleshooting brain serving junk as knowledge.
--
-- brain_lookup is the moat. Measured live 2026-09-12, it was not trustworthy:
--
--   brain_lookup('WTW5000DW1') -> part_number "5555444", component "Heater",
--                                 tier "this exact model"
--
-- That row is the ZZ TEST practice job, on a CANCELED job. A tech asking "what usually
-- fixes this" got a fake part at the highest-confidence tier. Worse than "I don't know".
--
-- Three defects, all measured:
--
-- 1. Branch (a) is commented "completion reports" but had NO job-status filter, so it
--    pooled every job_tdr row regardless of status. 165 rows with a component: only 55
--    on completed jobs; the rest scheduled/awaiting_parts/in_progress, plus the canceled
--    ZZ TEST row and one 'new' intake artifact. Branch (b) already filtered correctly.
--
-- 2. No shape rule on part_number. Branch (b) was 53% junk: of 850 pooled rows, 232 had
--    no digit at all ("Core", "No parts were used") and 215 were whole pasted sentences
--    from the legacy email parser. Branch (a) carried "Na" x21 and "None" x12.
--
-- 3. The demo tenant (company.status='test') taught real shops.
--
-- WHAT WE DELIBERATELY DID NOT DO: match test data by customer name. On this board that
-- is actively destructive -- "Sam Cartozzo", "Demon Gorum" and "Jeanette Stewart" all
-- contain zz / demo / test as substrings and are real paying customers. Same family as
-- the documented "STRANGE contains RANGE" trap. Job status is the honest signal.
--
-- RECOVERY, not just rejection: part_key() already extracts the trailing part token, so
-- "Washer Suspension Rod and Spring Assembly W11400156" is recovered as W11400156 rather
-- than dropped. Prose falls out on its own -- "No parts were used" extracts to
-- NOPARTSWEREUSED, which carries no digit and fails the gate.
--
-- TUNABLE (the knob to dial in later): the status list in brain_scope_ok. Today a row
-- teaches only if a tech actually worked the job (completed / in_progress /
-- awaiting_parts). Widening it to 'scheduled' would add ~42 pre-diagnosis guesses.
--
-- Idempotent. CREATE OR REPLACE throughout -- never DROP, that would lose the GRANTs.

-- Does this string look like a real part number? Mirrors the realModel() discipline
-- already used by platform-job-prep: a length floor, a digit requirement, and an
-- explicit placeholder list. The digit rule is what rejects prose.
create or replace function public.brain_real_part(p text)
returns boolean language sql immutable as $$
  select case
    when p is null then false
    when length(btrim(p)) < 4  then false   -- "Na", "134" are not part numbers
    when length(btrim(p)) > 40 then false   -- a pasted paragraph is not a part number
    when btrim(p) !~ '[0-9]'   then false   -- every real part number carries a digit
    when lower(btrim(p)) = any (array[
      'na','n/a','none','no part','no parts','no part needed','not needed','nothing',
      'tbd','test','testing','unknown','pending','n/a - none'
    ]) then false
    else true
  end
$$;

-- Best honest part number for a raw field: keep it as typed when it is already clean
-- (so DC47-00015A keeps its dash and stays searchable), otherwise recover the token out
-- of a paste, otherwise nothing.
create or replace function public.brain_part_of(p text)
returns text language sql immutable as $$
  select case
    when public.brain_real_part(p) then btrim(p)
    when public.brain_real_part(public.part_key(p)) then public.part_key(p)
    else null
  end
$$;

-- A job only teaches once a tech has actually worked it.
create or replace function public.brain_scope_ok(p_job_status text, p_company_status text)
returns boolean language sql immutable as $$
  select coalesce(p_job_status,'') in ('completed','in_progress','awaiting_parts')
     and coalesce(p_company_status,'') is distinct from 'test'
$$;

create or replace function public.brain_lookup(p_brand text DEFAULT ''::text, p_model text DEFAULT ''::text, p_symptom text DEFAULT ''::text, p_unit_kind text DEFAULT ''::text, p_trade text DEFAULT ''::text)
 RETURNS TABLE(failed_component text, part_number text, fixes bigint, comebacks bigint, observations bigint, shops bigint, tier text, confidence text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pool as (
    -- (a) technician reports on jobs a tech actually worked
    select j.company_id,
           coalesce(nullif(t.brand,''), u.attributes->>'brand', '')  as brand,
           coalesce(nullif(t.model,''), u.attributes->>'model', '')  as model,
           coalesce(nullif(u.kind,''), nullif(u.label,''), t.appliance, '') as kind,
           coalesce(c.trade,'') as trade,
           coalesce(nullif(t.symptom,''), j.problem, '') as symptom,
           nullif(btrim(t.failed_component),'') as failed_component,
           public.brain_part_of(t.part_number) as part_number,
           (coalesce(t.outcome,'fixed') <> 'return_needed') as fixed,
           (coalesce(t.outcome,'') = 'fixed' and coalesce(t.held,false)) as first_trip
    from public.job_tdr t
    join public.job j on j.id = t.job_id
    left join public.unit u on u.id = j.unit_id
    join public.company c on c.id = j.company_id
    where nullif(btrim(t.failed_component),'') is not null
      and public.brain_scope_ok(j.status, c.status)
    union all
    -- (b) parts actually used on completed jobs (knowledge even without a TDR)
    select j.company_id,
           coalesce(u.attributes->>'brand','') as brand,
           coalesce(u.attributes->>'model','') as model,
           coalesce(nullif(u.kind,''), nullif(u.label,''), '') as kind,
           coalesce(c.trade,'') as trade,
           coalesce(j.problem,'') as symptom,
           coalesce(nullif(btrim(p.name),''), 'part used') as failed_component,
           public.brain_part_of(p.number) as part_number,
           true as fixed, false as first_trip
    from public.job_part p
    join public.job j on j.id = p.job_id
    left join public.unit u on u.id = j.unit_id
    join public.company c on c.id = j.company_id
    where j.status = 'completed'
      and coalesce(c.status,'') is distinct from 'test'
      and public.brain_part_of(p.number) is not null
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
$function$;

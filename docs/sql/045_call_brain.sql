-- 045_call_brain.sql — the phone-AI call resolver (keystone of the platform Ann call brain).
--
-- Given a company + a caller handle (phone, claim#, or name), resolve WHO is calling and
-- their CURRENT job, returning the grounded facts a phone AI needs to answer correctly —
-- the platform equivalent of TN's job-truth resolver, but multi-tenant.
--
-- Safety: company-scoped by PARAMETER; SECURITY DEFINER, granted to service_role ONLY (the
-- platform-* server functions), so no browser / anon / other tenant can reach it. The Netlify
-- layer resolves company_id from the DIALED shop's slug FIRST, then calls this — the same
-- code-scoping discipline as createLeadJob. A caller for shop X can never surface shop Y's rows.
--
-- Phone is matched on NORMALIZED last-10 digits (platform phone formats vary — '6155550142'
-- vs '615-555-0103'), fixing the raw-string equality bug in the lead writer. Claim# match
-- strips whitespace (claims transcribe badly on a call). Best job = prefer a live (non-terminal)
-- job, else the newest — so a returning customer is still recognized.

create or replace function public.platform_call_lookup(
  p_company_id uuid,
  p_phone text default null,
  p_claim text default null,
  p_name  text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_last10  text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  v_claim   text := regexp_replace(coalesce(p_claim,''), '\s', '', 'g');
  v_cust_id uuid; v_first text; v_last text; v_phone text;
  v_job_id  uuid; v_matched text; v_count int := 0; v_job jsonb;
begin
  -- 1) resolve the caller — phone (normalized last-10) → claim# → name.
  if length(v_last10) >= 7 then
    select c.id, c.first_name, c.last_name, c.phone
      into v_cust_id, v_first, v_last, v_phone
      from customer c
      where c.company_id = p_company_id
        and right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10) = v_last10
      order by c.id limit 1;
    if v_cust_id is not null then v_matched := 'phone'; end if;
  end if;

  if v_cust_id is null and v_claim <> '' then
    -- claim# lives on the job; resolve the job, then its customer
    select j.customer_id, j.id into v_cust_id, v_job_id
      from job j
      where j.company_id = p_company_id
        and regexp_replace(coalesce(j.claim_number,''), '\s', '', 'g') = v_claim
      order by j.created_at desc limit 1;
    if v_cust_id is not null then
      select c.first_name, c.last_name, c.phone into v_first, v_last, v_phone
        from customer c where c.id = v_cust_id;
      v_matched := 'claim';
    end if;
  end if;

  if v_cust_id is null and btrim(coalesce(p_name,'')) <> '' then
    select c.id, c.first_name, c.last_name, c.phone
      into v_cust_id, v_first, v_last, v_phone
      from customer c
      where c.company_id = p_company_id
        and lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''))
            like '%' || lower(btrim(p_name)) || '%'
      order by c.id limit 1;
    if v_cust_id is not null then v_matched := 'name'; end if;
  end if;

  if v_cust_id is null then
    return jsonb_build_object('ok', true, 'found', false, 'matched_by', null);
  end if;

  -- 2) best job: prefer a live (non-terminal) job, else newest. Keep the claim-matched job.
  if v_job_id is null then
    select j.id into v_job_id
      from job j
      where j.company_id = p_company_id and j.customer_id = v_cust_id
      order by (case when j.status not in ('completed','canceled') then 0 else 1 end),
               j.created_at desc
      limit 1;
  end if;

  select count(*) into v_count
    from job j where j.company_id = p_company_id and j.customer_id = v_cust_id;

  if v_job_id is not null then
    select jsonb_build_object(
      'id', j.id, 'status', j.status, 'problem', j.problem,
      'scheduled_day', j.scheduled_day, 'scheduled_start', j.scheduled_start,
      'en_route_at', j.en_route_at, 'started_at', j.started_at, 'completed_at', j.completed_at,
      'tech_first', (select split_part(coalesce(t.name,''), ' ', 1) from technician t where t.id = j.technician_id),
      'unit_label', (select u.label from unit u where u.id = j.unit_id),
      'warranty_company', j.warranty_company, 'claim_number', j.claim_number,
      'dispatch_id', j.dispatch_id, 'service_window', j.service_window,
      'parts_status', j.parts_status, 'parts_eta', j.parts_eta
    ) into v_job from job j where j.id = v_job_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'found', true, 'matched_by', v_matched,
    'customer', jsonb_build_object('first_name', v_first, 'last_name', v_last, 'phone', v_phone),
    'job_count', v_count,
    'job', v_job
  );
end $$;

grant execute on function public.platform_call_lookup(uuid, text, text, text) to service_role;

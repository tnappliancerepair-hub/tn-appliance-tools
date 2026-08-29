-- 025_portal_curate.sql — SECURITY FIX + portal polish. Run in the ANT Platforms project.
--
-- WHY: portal_get (005) returned `to_jsonb(j) - 'company_id'` for jobs and
-- `to_jsonb(c) - 'company_id'` for the customer — i.e. the WHOLE row. That leaked
-- internal fields to the customer's browser (readable in the network tab even though
-- the page doesn't render them): job.office_notes ("upsell offered", gate codes, team
-- notes), job.warranty_company, job.source, and customer.notes.
--
-- FIX: rebuild portal_get as an ALLOWLIST — only customer-safe fields. Bonus polish:
-- the job now carries `unit_label` (the appliance — the page already reads this key but
-- the old function never returned it, so it showed "Your service"), the tech's FIRST
-- name, and the customer's OWN uploaded media. No internal fields, no part numbers, no costs.
-- Idempotent (create or replace) — safe to paste. portal_post_message (005) is unchanged.

create or replace function public.portal_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; result jsonb;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', (select jsonb_build_object('name', name, 'trade', trade, 'settings', settings)
                from public.company where id = g.company_id),
    -- customer: only their own contact fields (NOT internal 'notes')
    'customer', (select jsonb_build_object(
                   'first_name', c.first_name, 'last_name', c.last_name, 'phone', c.phone,
                   'email', c.email, 'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip)
                 from public.customer c where id = g.customer_id),
    -- jobs: customer-safe fields ONLY (no office_notes / warranty_company / source / internal flags)
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', j.id,
               'status', j.status,
               'problem', j.problem,
               'scheduled_day', j.scheduled_day,
               'scheduled_start', j.scheduled_start,
               'en_route_at', j.en_route_at,
               'started_at', j.started_at,
               'completed_at', j.completed_at,
               'created_at', j.created_at,
               'unit_label', (select u.label from public.unit u where u.id = j.unit_id),
               'tech', (select split_part(coalesce(t.name, ''), ' ', 1)
                        from public.technician t where t.id = j.technician_id),
               'media', (select coalesce(jsonb_agg(jsonb_build_object(
                           'kind', mm.kind, 'provider', mm.provider, 'ref', mm.ref, 'label', mm.label)
                           order by mm.created_at), '[]'::jsonb)
                         from public.job_media mm where mm.job_id = j.id)
             ) order by j.created_at desc), '[]'::jsonb)
             from public.job j
             where j.customer_id = g.customer_id and j.company_id = g.company_id
               and (g.job_id is null or j.id = g.job_id)),
    'thread', (select coalesce(jsonb_agg(jsonb_build_object(
                 'direction', m.direction, 'channel', m.channel, 'sender', m.sender,
                 'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
               from public.thread_message m
               where m.customer_id = g.customer_id and m.company_id = g.company_id
                 and (g.job_id is null or m.job_id = g.job_id))
  ) into result;
  return result;
end $$;
grant execute on function public.portal_get(uuid) to anon, authenticated;

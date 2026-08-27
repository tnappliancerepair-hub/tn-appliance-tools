-- 015_job_view.sql — a no-login, read-only cockpit view. Run in the ANT Platforms project.
-- job_view(token) returns the full job for a portal grant — customer, appliance, problem,
-- availability, access notes, waiver, media (video/photos), scheduling flags, and the latest
-- TDR — so the owner can TAP the cockpit link from the SMS and SEE what came in without
-- signing in. Anon-callable, scoped to the one grant (same trust as the intake/portal link).
-- Working the job (Start/Complete/edit/pay) still happens in the signed-in cockpit.

create or replace function public.job_view(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; result jsonb;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;
  if g.job_id is null then return jsonb_build_object('ok', false, 'error', 'No job on this link yet.'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', (select jsonb_build_object('name', name, 'settings', settings) from public.company where id = g.company_id),
    'job', (select jsonb_build_object(
        'id', j.id, 'status', j.status, 'problem', j.problem,
        'availability', j.availability, 'access_notes', j.access_notes,
        'waiver_name', j.waiver_name, 'waiver_signed_at', j.waiver_signed_at,
        'scheduled_day', j.scheduled_day,
        'needs_two_techs', j.needs_two_techs, 'long_job', j.long_job,
        'customer', (select jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name,
                       'phone', c.phone, 'address', c.address, 'city', c.city, 'state', c.state)
                     from public.customer c where c.id = j.customer_id),
        'unit', (select jsonb_build_object('label', u.label, 'attributes', u.attributes)
                 from public.unit u where u.id = j.unit_id)
      ) from public.job j where j.id = g.job_id),
    'media', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'provider', provider, 'ref', ref, 'label', label) order by created_at), '[]'::jsonb)
              from public.job_media where job_id = g.job_id),
    'tdr', (select to_jsonb(t) from public.job_tdr t where t.job_id = g.job_id limit 1)
  ) into result;
  return result;
end $$;
grant execute on function public.job_view(uuid) to anon, authenticated;

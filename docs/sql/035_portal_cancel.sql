-- 035_portal_cancel.sql — let the customer cancel a not-yet-started appointment from their
-- portal (the handshake works all three ways). Safe by design: only a 'new' or 'scheduled' job
-- can be canceled this way; once the tech is en route / on site / done, it just tells them to
-- reply or call. Reversible — the office can reopen a canceled job. Run in ANT Platforms.

create or replace function public.portal_cancel_job(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; jid uuid; st text; lbl text;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;
  select id, status into jid, st from public.job
    where customer_id = g.customer_id and company_id = g.company_id
      and (g.job_id is null or id = g.job_id)
      and status not in ('completed','canceled')
    order by created_at desc limit 1;
  if jid is null then return jsonb_build_object('ok', false, 'error', 'No active appointment to cancel.'); end if;
  if st not in ('new','scheduled') then
    return jsonb_build_object('ok', false, 'error', 'This visit is already underway — reply here or call us and we will sort it out.');
  end if;
  update public.job set status = 'canceled' where id = jid;
  insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body)
    values (g.company_id, g.customer_id, jid, 'in', 'portal', 'customer', '🚫 Canceled this appointment.');
  return jsonb_build_object('ok', true, 'canceled', true);
end $$;
grant execute on function public.portal_cancel_job(uuid) to anon, authenticated;

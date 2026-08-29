-- 037_payments_connect.sql — customer card payments via Stripe Connect. The shop connects its
-- own Stripe account (Express); customers pay the exact invoice by card; funds land in the
-- SHOP's account (money still goes to the shop, never held by the platform), and the invoice
-- auto-marks paid. Run in ANT Platforms.

alter table public.company add column if not exists stripe_connect_id text;               -- acct_… (the shop's connected account)
alter table public.company add column if not exists payments_enabled boolean not null default false; -- charges_enabled on the connected acct

-- portal_get: expose payments_enabled so the customer portal knows to show "Pay by card".
create or replace function public.portal_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; result jsonb;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', (select jsonb_build_object('name', name, 'trade', trade, 'settings', settings, 'payments_enabled', coalesce(payments_enabled,false)) from public.company where id = g.company_id),
    'customer', (select jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name, 'phone', c.phone,
                   'email', c.email, 'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip)
                 from public.customer c where id = g.customer_id),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', j.id, 'status', j.status, 'problem', j.problem, 'scheduled_day', j.scheduled_day,
               'scheduled_start', j.scheduled_start, 'en_route_at', j.en_route_at, 'started_at', j.started_at,
               'completed_at', j.completed_at, 'created_at', j.created_at,
               'unit_label', (select u.label from public.unit u where u.id = j.unit_id),
               'tech', (select split_part(coalesce(t.name,''),' ',1) from public.technician t where t.id = j.technician_id),
               'bill', (case
                          when nullif(btrim(coalesce(j.warranty_company,'')),'') is not null then jsonb_build_object('covered', true)
                          else (select case when iv.id is null then null else jsonb_build_object(
                                  'invoice_id', iv.id,
                                  'subtotal_cents', iv.subtotal_cents, 'tax_cents', iv.tax_cents, 'total_cents', iv.total_cents,
                                  'paid', (iv.status='paid' or coalesce(iv.collected_cents,0) >= coalesce(iv.total_cents,0)),
                                  'paid_method', iv.paid_method, 'paid_at', iv.paid_at,
                                  'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                                              'description', coalesce(nullif(btrim(il.description),''), initcap(il.kind)),
                                              'amount_cents', round(coalesce(il.unit_cents,0)*coalesce(il.qty,1))) order by il.created_at), '[]'::jsonb)
                                            from public.invoice_line il where il.invoice_id = iv.id)) end
                                from public.invoice iv where iv.job_id = j.id order by iv.created_at desc limit 1) end),
               'offers', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', so.id, 'direction', so.direction, 'proposed_day', so.proposed_day, 'win', so.win, 'note', so.note)
                            order by so.created_at desc), '[]'::jsonb)
                          from public.schedule_offer so where so.job_id = j.id and so.status = 'pending'),
               'media', (select coalesce(jsonb_agg(jsonb_build_object('kind', mm.kind, 'provider', mm.provider, 'ref', mm.ref, 'label', mm.label)
                           order by mm.created_at), '[]'::jsonb) from public.job_media mm where mm.job_id = j.id)
             ) order by j.created_at desc), '[]'::jsonb)
             from public.job j where j.customer_id = g.customer_id and j.company_id = g.company_id and (g.job_id is null or j.id = g.job_id)),
    'thread', (select coalesce(jsonb_agg(jsonb_build_object('direction', m.direction, 'channel', m.channel, 'sender', m.sender,
                 'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
               from public.thread_message m where m.customer_id = g.customer_id and m.company_id = g.company_id and (g.job_id is null or m.job_id = g.job_id))
  ) into result;
  return result;
end $$;
grant execute on function public.portal_get(uuid) to anon, authenticated;

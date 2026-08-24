-- 011_invoice_send.sql — let a shop INVOICE its customers. Run AFTER 004/005/010.
-- invoice_get(token) is the customer-facing read: hand the customer
--   /platform/invoice.html?t=<token>
-- and this SECURITY DEFINER function returns THAT job's invoice + line items + the
-- shop's own business identity (from company.settings.business) — anon-callable,
-- scoped to the one grant. Nothing about us; it's entirely the shop's invoice.

create or replace function public.invoice_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; jid uuid; inv record; result jsonb;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;

  jid := g.job_id;
  if jid is null then
    select id into jid from public.job
      where customer_id = g.customer_id and company_id = g.company_id
      order by created_at desc limit 1;
  end if;

  select * into inv from public.invoice
    where job_id = jid and company_id = g.company_id
    order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'No invoice yet.'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', (select jsonb_build_object('name', name, 'settings', settings) from public.company where id = g.company_id),
    'customer', (select jsonb_build_object('first_name', first_name, 'last_name', last_name, 'phone', phone)
                 from public.customer where id = g.customer_id),
    'job', (select jsonb_build_object('problem', j.problem, 'created_at', j.created_at,
              'appliance', (select label from public.unit where id = j.unit_id))
            from public.job j where id = jid),
    'invoice', jsonb_build_object('status', inv.status, 'number', inv.number,
      'subtotal_cents', inv.subtotal_cents, 'tax_cents', inv.tax_cents,
      'total_cents', inv.total_cents, 'paid_at', inv.paid_at, 'created_at', inv.created_at),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'description', description,
                'qty', qty, 'unit_cents', unit_cents) order by created_at), '[]'::jsonb)
              from public.invoice_line where invoice_id = inv.id)
  ) into result;
  return result;
end $$;
grant execute on function public.invoice_get(uuid) to anon, authenticated;

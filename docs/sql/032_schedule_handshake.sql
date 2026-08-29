-- 032_schedule_handshake.sql — the THREE-WAY scheduling handshake. Run in ANT Platforms.
-- All three sides can propose a day and any side can accept, to speed scheduling:
--   • customer REQUESTS a day (portal) -> the office sees it -> one-tap books it.
--   • office/tech OFFERS a day (board)  -> the customer sees it -> one-tap accepts -> booked.
-- Low-promise windows (am / any / pm) keep it loose so the tech has grace.

create table if not exists public.schedule_offer (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  job_id       uuid not null references public.job(id) on delete cascade,
  customer_id  uuid references public.customer(id) on delete set null,
  direction    text not null check (direction in ('customer','shop')),   -- who proposed it
  proposed_day date not null,
  win          text check (win in ('am','pm','any')),                     -- low-promise window
  note         text,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  created_by   text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists schedule_offer_job_idx     on public.schedule_offer (job_id);
create index if not exists schedule_offer_company_idx on public.schedule_offer (company_id, status);

alter table public.schedule_offer enable row level security;
drop policy if exists schedule_offer_tenant on public.schedule_offer;
create policy schedule_offer_tenant on public.schedule_offer
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.schedule_offer to authenticated;

-- ── customer REQUESTS a day (anon, portal-token gated) ───────────────────────
create or replace function public.portal_request_day(p_token uuid, p_day date, p_win text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; jid uuid; lbl text;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'link expired'); end if;
  if p_day is null or p_day < current_date then return jsonb_build_object('ok', false, 'error', 'pick a day'); end if;
  -- the job this grant is scoped to (or the customer's most recent open job)
  select id into jid from public.job
    where customer_id = g.customer_id and company_id = g.company_id
      and (g.job_id is null or id = g.job_id)
      and status not in ('completed','canceled')
    order by created_at desc limit 1;
  if jid is null then return jsonb_build_object('ok', false, 'error', 'no open job'); end if;
  insert into public.schedule_offer (company_id, job_id, customer_id, direction, proposed_day, win, note, status, created_by)
    values (g.company_id, jid, g.customer_id, 'customer', p_day, coalesce(nullif(p_win,''),'any'), nullif(p_note,''), 'pending', 'customer');
  lbl := to_char(p_day,'Dy, Mon DD') || ' · ' || (case coalesce(p_win,'any') when 'am' then 'mornings' when 'pm' then 'afternoons' else 'anytime' end);
  insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body)
    values (g.company_id, g.customer_id, jid, 'in', 'portal', 'customer', '📅 Requested ' || lbl || (case when nullif(p_note,'') is not null then ' — ' || p_note else '' end));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.portal_request_day(uuid, date, text, text) to anon, authenticated;

-- ── customer ACCEPTS / DECLINES a shop offer (anon, portal-token gated) ───────
create or replace function public.portal_respond_offer(p_token uuid, p_offer_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; o record; lbl text;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'link expired'); end if;
  select * into o from public.schedule_offer
    where id = p_offer_id and company_id = g.company_id and customer_id = g.customer_id
      and direction = 'shop' and status = 'pending';
  if not found then return jsonb_build_object('ok', false, 'error', 'offer not found'); end if;
  lbl := to_char(o.proposed_day,'Dy, Mon DD') || ' · ' || (case coalesce(o.win,'any') when 'am' then 'mornings' when 'pm' then 'afternoons' else 'anytime' end);
  if p_accept then
    update public.schedule_offer set status='accepted', decided_at=now() where id=o.id;
    update public.job set scheduled_day=o.proposed_day, status = case when status in ('new','') then 'scheduled' else status end where id=o.job_id;
    insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body)
      values (g.company_id, g.customer_id, o.job_id, 'in', 'portal', 'customer', '✅ Accepted ' || lbl);
  else
    update public.schedule_offer set status='declined', decided_at=now() where id=o.id;
    insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body)
      values (g.company_id, g.customer_id, o.job_id, 'in', 'portal', 'customer', '🙅 Passed on ' || lbl);
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.portal_respond_offer(uuid, uuid, boolean) to anon, authenticated;

-- ── portal_get: add pending OFFERS per job (both directions) ──────────────────
create or replace function public.portal_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; result jsonb;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', (select jsonb_build_object('name', name, 'trade', trade, 'settings', settings) from public.company where id = g.company_id),
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

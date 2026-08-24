-- 005_portal_access.sql — the CUSTOMER PORTAL access pattern. Run AFTER 004.
--
-- Customers are NOT staff — they must never be app_users and never touch RLS-gated
-- tables directly. Instead the office mints a PORTAL GRANT (a token tied to one
-- customer, optionally one job), hands the customer a link like
--   /platform/portal.html?t=<token>
-- and the portal reads/writes ONLY that grant's records through two SECURITY DEFINER
-- functions callable by the anonymous (token-gated) page. No password, no data exposure
-- beyond the single customer's own job + thread. Mirrors TN's existing tokenized portal.

create table if not exists public.portal_grant (
  token       uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  customer_id uuid not null references public.customer(id) on delete cascade,
  job_id      uuid references public.job(id) on delete cascade,   -- null = all this customer's jobs
  expires_at  timestamptz,                                        -- null = never
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists portal_grant_customer_idx on public.portal_grant (customer_id);

-- Staff see / mint / revoke grants for their own tenant (RLS-gated like everything else).
alter table public.portal_grant enable row level security;
drop policy if exists portal_grant_tenant on public.portal_grant;
create policy portal_grant_tenant on public.portal_grant
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update on public.portal_grant to authenticated;

-- ── portal_get(token) — everything the customer is allowed to see for their grant.
-- Validates the token (not revoked, not expired), strips internal fields (company_id),
-- returns company + customer + their jobs + their conversation thread.
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
    'customer', (select to_jsonb(c) - 'company_id' from public.customer c where id = g.customer_id),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j) - 'company_id' order by j.created_at desc), '[]'::jsonb)
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

-- ── portal_post_message(token, body) — the customer replies into their own thread.
create or replace function public.portal_post_message(p_token uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;
  if coalesce(trim(p_body), '') = '' then return jsonb_build_object('ok', false, 'error', 'empty message'); end if;

  insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body)
    values (g.company_id, g.customer_id, g.job_id, 'in', 'portal', 'customer', left(p_body, 2000));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.portal_post_message(uuid, text) to anon, authenticated;

-- Office mints a portal link by inserting a grant (RLS scopes it to their tenant):
--   insert into portal_grant (company_id, customer_id, job_id)
--   values (current_company_id(), '<customer uuid>', '<job uuid or null>')
--   returning token;   -- hand the customer /platform/portal.html?t=<token>

-- 004_multitenant_core.sql — the multi-tenant SPINE for the Ant platform.
-- Run in the Supabase SQL editor of the platform project (NOT the ANT OPS archive
-- project). Idempotent-ish: uses IF NOT EXISTS / CREATE OR REPLACE throughout so a
-- re-run is safe during development.
--
-- WHAT THIS IS: a WIDE, trade-agnostic, RLS-enforced core that many shops (tenants)
-- share safely. Tenant isolation is enforced by Postgres itself (Row-Level Security),
-- so a buggy query can never return another shop's rows. See docs/multi-tenant-platform.md.
--
-- ROLES (Supabase): anon = no access; authenticated = fully RLS-gated to their own
-- company; service_role (backend/loop/provisioning) bypasses RLS.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ── shared: bump updated_at on every write ──────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ════════════════════════════════════════════════════════════════════════════════════
-- TRADE PROFILES (GLOBAL, not tenant-scoped) — the "wide" that lets any trade slot in.
-- Each row defines a trade's unit vocabulary + the fields a unit of that trade carries.
-- A new trade = a new ROW here, never a schema change.
-- ════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.trade_profile (
  trade        text primary key,              -- 'appliance', 'automotive', 'plumbing', ...
  label        text not null,                 -- 'Appliance Repair'
  unit_kind    text not null,                 -- what one serviced thing is called: 'appliance', 'vehicle'
  unit_label   text not null,                 -- 'Appliance', 'Vehicle'
  -- fields: ordered list of {key,label,required} describing a unit's attributes for this trade,
  -- so the front-end renders the right intake form and Ann asks for the right things.
  fields       jsonb not null default '[]'::jsonb,
  vocab        jsonb not null default '{}'::jsonb,   -- misc trade phrasing (problem noun, etc.)
  created_at   timestamptz not null default now()
);

insert into public.trade_profile (trade, label, unit_kind, unit_label, fields, vocab) values
  ('appliance', 'Appliance Repair', 'appliance', 'Appliance',
   '[{"key":"type","label":"Appliance","required":true},{"key":"brand","label":"Brand","required":false},{"key":"model","label":"Model #","required":false},{"key":"serial","label":"Serial #","required":false}]'::jsonb,
   '{"problem_noun":"issue","service_verb":"repair"}'::jsonb),
  ('automotive', 'Automotive Repair', 'vehicle', 'Vehicle',
   '[{"key":"year","label":"Year","required":true},{"key":"make","label":"Make","required":true},{"key":"model","label":"Model","required":true},{"key":"vin","label":"VIN","required":false},{"key":"mileage","label":"Mileage","required":false}]'::jsonb,
   '{"problem_noun":"issue","service_verb":"service"}'::jsonb)
on conflict (trade) do nothing;

-- reference data — readable by anyone signed in, writable only by the backend (service_role)
grant select on public.trade_profile to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════════════
-- COMPANY (the tenant) + APP_USER (a login inside a tenant)
-- ════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.company (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  trade       text not null default 'appliance' references public.trade_profile(trade),
  plan        text not null default 'trial',                 -- trial / phones / office / full
  features    jsonb not null default '{}'::jsonb,            -- entitlements: {phones:true, database:true, scheduling:true, ...}
  settings    jsonb not null default '{}'::jsonb,            -- per-tenant config: price book, hours, warranty cos, Ann persona, branding
  timezone    text not null default 'America/Chicago',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists company_touch on public.company;
create trigger company_touch before update on public.company for each row execute function public.set_updated_at();

create table if not exists public.app_user (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  auth_user_id  uuid unique references auth.users(id) on delete set null,  -- Supabase auth link
  role          text not null default 'office' check (role in ('owner','office','tech')),
  name          text,
  phone         text,
  email         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists app_user_company_idx on public.app_user (company_id);
create index if not exists app_user_auth_idx on public.app_user (auth_user_id);

-- ── tenant resolution — the un-bypassable key. SECURITY DEFINER so it can read app_user
-- past that table's own RLS. Returns the logged-in user's company (MVP: one company/user).
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.app_user where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_user where auth_user_id = auth.uid() and active limit 1
$$;

-- ════════════════════════════════════════════════════════════════════════════════════
-- CORE TENANT TABLES — every one carries company_id and is RLS-gated below.
-- ════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.customer (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  first_name  text,
  last_name   text,
  phone       text,
  email       text,
  address     text,
  city        text,
  state       text,
  zip         text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists customer_touch on public.customer;
create trigger customer_touch before update on public.customer for each row execute function public.set_updated_at();

-- unit = the thing being serviced (appliance, vehicle, ...). Trade-specific fields live in
-- attributes jsonb, shaped by the company's trade_profile.fields. This is the WIDE bit.
create table if not exists public.unit (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  customer_id uuid references public.customer(id) on delete set null,
  kind        text not null default 'appliance',        -- from trade_profile.unit_kind
  label       text,                                     -- human summary: "Whirlpool fridge", "1969 Camaro"
  attributes  jsonb not null default '{}'::jsonb,        -- {brand,model,serial} | {year,make,model,vin}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists unit_touch on public.unit;
create trigger unit_touch before update on public.unit for each row execute function public.set_updated_at();

create table if not exists public.technician (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  app_user_id  uuid references public.app_user(id) on delete set null,   -- optional login link
  name         text not null,
  phone        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists technician_company_idx on public.technician (company_id);

create table if not exists public.job (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.company(id) on delete cascade,
  customer_id     uuid references public.customer(id) on delete set null,
  unit_id         uuid references public.unit(id) on delete set null,
  technician_id   uuid references public.technician(id) on delete set null,
  status          text not null default 'new',           -- new/scheduled/in_progress/awaiting_parts/completed/canceled (per-tenant configurable later)
  problem         text,
  source          text,                                  -- 'ann_phone','web','office', ...
  scheduled_day   date,
  scheduled_start timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists job_company_created_idx on public.job (company_id, created_at desc);
create index if not exists job_company_status_idx on public.job (company_id, status);
create index if not exists job_company_tech_idx on public.job (company_id, technician_id);
drop trigger if exists job_touch on public.job;
create trigger job_touch before update on public.job for each row execute function public.set_updated_at();

create table if not exists public.invoice (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  job_id        uuid references public.job(id) on delete set null,
  customer_id   uuid references public.customer(id) on delete set null,
  status        text not null default 'draft',           -- draft/sent/paid/void
  subtotal_cents integer not null default 0,
  tax_cents     integer not null default 0,
  total_cents   integer not null default 0,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists invoice_company_idx on public.invoice (company_id, created_at desc);
drop trigger if exists invoice_touch on public.invoice;
create trigger invoice_touch before update on public.invoice for each row execute function public.set_updated_at();

create table if not exists public.invoice_line (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  invoice_id   uuid not null references public.invoice(id) on delete cascade,
  kind         text not null default 'labor',            -- labor/part/fee
  description  text,
  qty          numeric not null default 1,
  unit_cents   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists invoice_line_invoice_idx on public.invoice_line (invoice_id);

-- the lead / conversation thread — every text, call summary, portal note (ties into Ann)
create table if not exists public.thread_message (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  customer_id  uuid references public.customer(id) on delete set null,
  job_id       uuid references public.job(id) on delete set null,
  direction    text not null default 'in' check (direction in ('in','out')),
  channel      text not null default 'sms',              -- sms/call/portal
  sender       text,                                     -- 'ann','customer','office:Danielle','tech:Jimmy'
  body         text,
  created_at   timestamptz not null default now()
);
create index if not exists thread_company_created_idx on public.thread_message (company_id, created_at desc);
create index if not exists thread_job_idx on public.thread_message (job_id);

create table if not exists public.event (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  type         text not null,
  entity       text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists event_company_created_idx on public.event (company_id, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY — the tenant wall. One isolation policy per table covers
-- select/insert/update/delete (USING gates reads+deletes; WITH CHECK gates writes).
-- ════════════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['customer','unit','technician','job','invoice','invoice_line','thread_message','event']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format($p$create policy %I on public.%I
      using (company_id = public.current_company_id())
      with check (company_id = public.current_company_id())$p$, t || '_tenant', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- company: a user sees / edits only their own company row
alter table public.company enable row level security;
drop policy if exists company_self on public.company;
create policy company_self on public.company
  using (id = public.current_company_id())
  with check (id = public.current_company_id());
grant select, update on public.company to authenticated;

-- app_user: a user sees the users in their own company (no recursion — current_company_id is DEFINER)
alter table public.app_user enable row level security;
drop policy if exists app_user_tenant on public.app_user;
create policy app_user_tenant on public.app_user
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update on public.app_user to authenticated;

-- ── INTRA-TENANT ROLE SCOPING — worked example to extend from (NOT applied by default).
-- To restrict techs to their OWN jobs (owners/office still see all), replace the job
-- policy above with this stricter USING clause:
--
--   drop policy if exists job_tenant on public.job;
--   create policy job_tenant on public.job
--     using (
--       company_id = public.current_company_id()
--       and (
--         public.current_app_role() in ('owner','office')
--         or technician_id in (
--           select t.id from public.technician t
--           join public.app_user u on u.id = t.app_user_id
--           where u.auth_user_id = auth.uid()
--         )
--       )
--     )
--     with check (company_id = public.current_company_id());

-- ════════════════════════════════════════════════════════════════════════════════════
-- SELF-SERVE PROVISIONING — sign up → tenant + owner in one call. The owner is ALWAYS
-- the calling authenticated user (auth.uid()), so a user can only ever create a company
-- they themselves own. Backend/service_role can pre-create the auth user then call this.
-- ════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_company_with_owner(
  p_name text, p_slug text, p_trade text default 'appliance',
  p_owner_name text default null, p_owner_phone text default null, p_owner_email text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'must be signed in to create a company'; end if;
  insert into public.company (name, slug, trade)
    values (p_name, p_slug, coalesce(nullif(p_trade,''),'appliance'))
    returning id into v_company;
  insert into public.app_user (company_id, auth_user_id, role, name, phone, email)
    values (v_company, v_uid, 'owner', p_owner_name, p_owner_phone, p_owner_email);
  return v_company;
end $$;
grant execute on function public.create_company_with_owner(text,text,text,text,text,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════
-- SANITY: after running, TN becomes tenant #1 via a backfill (service_role), NOT here.
-- This file only stands up the empty, safe, multi-tenant core.
-- ════════════════════════════════════════════════════════════════════════════════════

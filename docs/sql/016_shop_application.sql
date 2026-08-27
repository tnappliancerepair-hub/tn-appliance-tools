-- 016_shop_application.sql — the clone-machine intake. Run in the ANT Platforms project.
-- A shop owner fills out /apply.html; it lands here as a PENDING application. You review it
-- on /applications.html and tap Approve, which calls onboard-shop (tenant + login + Ann).
-- Admin-only data: RLS is ON with NO policy and NO grants to anon/authenticated, so only the
-- Netlify functions (service key, which bypasses RLS) can read/write it.
create table if not exists public.shop_application (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'pending',   -- pending / approved / declined
  name        text,
  trade       text,
  area        text,
  hours       text,
  about       text,
  owner_first text,
  owner_name  text,
  owner_email text,
  owner_cell  text,
  bot_name    text,
  has_number  boolean default false,
  number      text,
  buy_area    text,
  pay_note    text,
  notes       text,
  slug        text,        -- set on approve
  company_id  uuid,        -- set on approve
  ann_number  text,        -- set on approve
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists shop_application_status_idx on public.shop_application (status, created_at desc);
alter table public.shop_application enable row level security;
-- (intentionally no policy, no grant to anon/authenticated — service key only)

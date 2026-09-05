-- 054_prospect_message — durable capture for "Message us" contact-form submissions from the
-- public marketing site (assistant247.net). A prospect has NO company yet, so these can't live in
-- the tenant-scoped `event` table (company_id is NOT NULL). Same service-role-only posture as
-- partner/047: deny-all to browser clients; only the server (service key) reads/writes it.
create table if not exists public.prospect_message (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  phone       text,
  email       text,
  message     text not null,
  shop        text,          -- the shop name they typed, if any
  source      text,          -- which page it came from (home/signup/system)
  handled     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists prospect_message_created_idx on public.prospect_message (created_at desc);

alter table public.prospect_message enable row level security;
-- No policies = deny-all to anon/authenticated. Service role bypasses RLS.
grant all on public.prospect_message to service_role;

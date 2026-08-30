-- 047_partner_referral.sql — reseller/referral attribution + partner commission ledger.
-- A PARTNER (e.g. TK) refers shops to the platform and earns a commission on the
-- subscription revenue of the accounts they bring. This is PLATFORM-OWNER data — NOT
-- tenant-scoped: `partner` + `partner_payout` are reached ONLY through service-key server
-- functions (platform-partner.js), so RLS is deny-all to every browser client (mirrors the
-- secret-store posture in 041_rls_privilege_gates.sql). A partner sees their own pipeline
-- through a TOKEN-gated read endpoint (like portal_grant), never a direct table read.
--
-- Mirrors the tech_payout discipline (022_commission_pay.sql): the ledger stores the PAID
-- state; EARNED derives at read time from the referred companies' live plan/MRR (no stored
-- guess). Run: sb-admin-sql ?project=platform (ANT Platforms). Idempotent.

-- ── The partner (reseller / referral affiliate) ────────────────────────────────────────
create table if not exists public.partner (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique not null,          -- referral code, e.g. 'TK'
  name                  text,
  email                 text,
  phone                 text,
  commission_type       text default 'sub_pct',        -- 'sub_pct' | 'flat_per_account'
  commission_pct        numeric,                        -- e.g. 20 = 20% of subscription MRR
  commission_flat_cents integer,                        -- flat $/mo per referred account (flat_per_account)
  commission_months     integer default 0,             -- 0 = lifetime while account active, else N months from referred_at
  active                boolean not null default true,
  token                 text unique,                    -- token-gated read-only dashboard (partner.html?token=…)
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists partner_code_idx  on public.partner (code);
create index if not exists partner_token_idx on public.partner (token);

-- ── Attribution: which partner referred this shop ──────────────────────────────────────
alter table public.company add column if not exists referred_by text;   -- => partner.code
alter table public.company add column if not exists referred_at timestamptz;
create index if not exists company_referred_by_idx on public.company (referred_by);

-- ── Payout ledger — the 'paid' state (a real transfer to the partner, recorded by the operator) ──
create table if not exists public.partner_payout (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.partner(id) on delete cascade,
  company_id   uuid references public.company(id) on delete set null,
  amount_cents integer not null default 0,
  period       text,
  note         text,
  paid_at      timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists partner_payout_partner_idx on public.partner_payout (partner_id);
create index if not exists partner_payout_company_idx on public.partner_payout (company_id);

-- ── Lockdown: owner-only data, service_role only. No client (anon or authenticated) touches it.
alter table public.partner        enable row level security;
alter table public.partner_payout enable row level security;
revoke all on public.partner        from anon, authenticated;
revoke all on public.partner_payout from anon, authenticated;
-- No policies are created for anon/authenticated => RLS denies them entirely. The platform
-- server uses the service_role key, which bypasses RLS; keep its table grants explicit.
grant all on public.partner        to service_role;
grant all on public.partner_payout to service_role;

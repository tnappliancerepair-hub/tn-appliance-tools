-- 022_commission_pay.sql — the pay spine: per-tech commission + a payout ledger.
-- "Write once (the invoice) -> the tech's pay falls out." Commission RULE lives on the
-- company (default, in company.settings.commission jsonb) with an optional per-tech
-- override here; the payout ledger records money actually handed to a tech (the 'paid'
-- state). earned/collected derive from job+invoice at read time (no stored guess).
-- RLS: office/owner/CSR see all company payouts; a tech sees ONLY their own pay.
-- Run: sb-admin-sql ?project=platform (ANT Platforms). Idempotent.

-- Per-tech commission override (NULL => use company.settings.commission default).
alter table public.technician add column if not exists commission_type text;          -- 'labor_pct' | 'flat_per_job'
alter table public.technician add column if not exists commission_pct numeric;         -- e.g. 50 = 50% of labor
alter table public.technician add column if not exists commission_flat_cents integer;  -- flat $ per completed job

-- Payout ledger — the 'paid' state (a real check / transfer recorded by the office/owner).
create table if not exists public.tech_payout (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  technician_id uuid not null references public.technician(id) on delete cascade,
  job_id        uuid references public.job(id) on delete set null,
  amount_cents  integer not null default 0,
  period        text,
  note          text,
  paid_at       timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists tech_payout_company_idx on public.tech_payout (company_id);
create index if not exists tech_payout_tech_idx on public.tech_payout (technician_id);
alter table public.tech_payout enable row level security;

-- The caller's own technician id (NULL for non-tech logins) — for tech-scoped pay RLS.
create or replace function public.current_technician_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.technician t
  join public.app_user u on u.id = t.app_user_id
  where u.auth_user_id = auth.uid() and t.active
  limit 1
$$;

-- Money table: authenticated only, RLS-scoped. No anon access.
revoke all on public.tech_payout from anon;
grant select, insert, update, delete on public.tech_payout to authenticated;

-- Read: office/owner/CSR see all company payouts; a tech sees only their own.
drop policy if exists tech_payout_read on public.tech_payout;
create policy tech_payout_read on public.tech_payout for select using (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or technician_id = public.current_technician_id()
  )
);
-- Write: only non-tech roles record a payout (a tech never writes his own check).
drop policy if exists tech_payout_write on public.tech_payout;
create policy tech_payout_write on public.tech_payout for all using (
  company_id = public.current_company_id()
  and public.current_app_role() in ('owner','office','manager','admin','csr')
) with check (
  company_id = public.current_company_id()
  and public.current_app_role() in ('owner','office','manager','admin','csr')
);

-- Denormalize labor onto the invoice (the office already enters it as a labor line) so
-- %-of-labor pay derives with no invoice_line join. Written by the office invoice worksheet.
alter table public.invoice add column if not exists labor_cents integer not null default 0;

-- 033_schema_reconcile.sql — make docs/sql match the LIVE platform DB. Run in ANT Platforms.
--
-- The live `job` table + two whole tables (usage_event, client_plan) grew columns/objects
-- out-of-band (the TN mirror, the usage meter, the plan catalog) that no migration ever
-- created. The surfaces READ them (owner dashboard, office board, portal billing, mirror
-- cron), so a clean deploy of docs/sql alone would error. This migration reconciles that:
-- every ALTER/CREATE is IF NOT EXISTS, so it is a NO-OP on the live DB and completes the
-- schema on a fresh one. Idempotent. Run it any time.

-- ── job: reconcile every column present live beyond the base 004 shape ───────────────────
alter table public.job add column if not exists availability          text;
alter table public.job add column if not exists access_notes          text;
alter table public.job add column if not exists waiver_signed_at      timestamptz;
alter table public.job add column if not exists waiver_name           text;
alter table public.job add column if not exists intake_done_at        timestamptz;
alter table public.job add column if not exists office_notes          text;
alter table public.job add column if not exists needs_two_techs       boolean not null default false;
alter table public.job add column if not exists long_job              boolean not null default false;
alter table public.job add column if not exists en_route_at           timestamptz;
alter table public.job add column if not exists started_at            timestamptz;
alter table public.job add column if not exists completed_at          timestamptz;
alter table public.job add column if not exists stop_id               uuid;
-- TN mirror source fields (job comes from legacy Xano; KPIs + portal read these)
alter table public.job add column if not exists xano_id               bigint;
alter table public.job add column if not exists xano_status           text;
alter table public.job add column if not exists xano_current_status   text;
alter table public.job add column if not exists warranty_company      text;
alter table public.job add column if not exists claim_number          text;
alter table public.job add column if not exists parts_status          text;
alter table public.job add column if not exists parts_eta             date;
alter table public.job add column if not exists first_stop            boolean;
alter table public.job add column if not exists warranty_claim_status text;
alter table public.job add column if not exists warranty_paid_cents   integer;
alter table public.job add column if not exists warranty_eft          text;
alter table public.job add column if not exists tdr_diagnosis         text;
alter table public.job add column if not exists tdr_failed_component  text;
alter table public.job add column if not exists tdr_part_number       text;
alter table public.job add column if not exists tdr_repair_completed  text;
alter table public.job add column if not exists tdr_parts_needed      text;
alter table public.job add column if not exists tdr_labor_hours       numeric;

-- the TN mirror upserts on (company_id, xano_id) — that ON CONFLICT needs this unique index
create unique index if not exists job_company_xano_uidx on public.job (company_id, xano_id);
create index if not exists job_first_stop_idx on public.job (company_id, first_stop);

-- ── usage_event: the per-tenant metering ledger (Ann minutes / SMS), owner-read only ─────
create table if not exists public.usage_event (
  id          bigserial primary key,
  company_id  uuid not null references public.company(id) on delete cascade,
  kind        text not null,                    -- 'voice_min' | 'sms' | 'owner_digest' | ...
  qty         numeric not null default 0,
  cost_cents  numeric not null default 0,
  source      text,
  meta        jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists usage_event_company_at_idx on public.usage_event (company_id, at desc);
alter table public.usage_event enable row level security;
drop policy if exists usage_event_own_read on public.usage_event;
create policy usage_event_own_read on public.usage_event
  for select using (company_id = public.current_company_id());
grant select on public.usage_event to authenticated;
-- writes are server-side only (service key bypasses RLS) — no write policy on purpose.

-- ── client_plan: per-tenant plan/allowance (owner dashboard usage card reads it) ─────────
create table if not exists public.client_plan (
  company_id            uuid primary key references public.company(id) on delete cascade,
  tier                  text not null default 'starter',
  base_price_cents      integer not null default 0,
  included_voice_min    integer not null default 500,
  included_sms          integer not null default 200,
  voice_overage_cents   integer not null default 0,
  sms_overage_cents     integer not null default 0,
  cap_sms_per_hour      integer not null default 200,
  cap_sms_per_day       integer not null default 2000,
  cap_voice_min_per_day integer not null default 600,
  hard_stop             boolean not null default true,
  updated_at            timestamptz not null default now()
);
alter table public.client_plan enable row level security;
drop policy if exists client_plan_own_read on public.client_plan;
create policy client_plan_own_read on public.client_plan
  for select using (company_id = public.current_company_id());
grant select on public.client_plan to authenticated;
-- writes server-side only (service key), same as usage_event.

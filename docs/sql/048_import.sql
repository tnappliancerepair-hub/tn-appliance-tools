-- 048_import.sql — the data-migration spine (Housecall Pro → the board, Jobber/Workiz later).
-- Two owner-only tables, reached ONLY through the platform-import service-key endpoint
-- (RLS deny-all to clients, like partner in 047). No client ever reads these directly.
--
--   import_run  — one row per migration attempt (preview → committed). Holds the true source
--                 totals, a resumable cursor, and the running landed/skipped counts.
--   import_map  — the idempotency ledger: every landed source record → its board id, unique per
--                 (company, source, kind, external_id) so a re-run NEVER double-creates and
--                 FKs (job→customer, job→tech) resolve through it.

create table if not exists public.import_run (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  source       text not null,                       -- 'housecallpro' | 'jobber' | 'workiz' | 'csv'
  status       text not null default 'preview',     -- preview | committing | committed | failed
  key_hint     text,                                -- last 4 of the source API key (never the key)
  totals       jsonb not null default '{}'::jsonb,   -- true source counts from probe {customers,jobs,...}
  cursor       jsonb not null default '{}'::jsonb,   -- {phase, page} — resumable commit
  landed       jsonb not null default '{}'::jsonb,   -- {technicians,customers,jobs,invoices,invoice_lines}
  skipped      jsonb not null default '{}'::jsonb,   -- already-mapped on a re-run
  sample       jsonb not null default '{}'::jsonb,   -- a few normalized cards, for the preview screen
  note         text,
  created_at   timestamptz not null default now(),
  committed_at timestamptz
);
create index if not exists import_run_company_idx on public.import_run (company_id, created_at desc);

create table if not exists public.import_map (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  source       text not null,
  kind         text not null,                        -- 'customer' | 'technician' | 'job' | 'invoice'
  external_id  text not null,                        -- the source system's record id
  internal_id  uuid not null,                        -- the board row it became
  run_id       uuid references public.import_run(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists import_map_uq on public.import_map (company_id, source, kind, external_id);
create index if not exists import_map_lookup on public.import_map (company_id, source, kind);

-- Owner-only: no client (anon/authenticated) may touch these; the service key (platform-import) does.
alter table public.import_run enable row level security;
alter table public.import_map enable row level security;
revoke all on public.import_run from anon, authenticated;
revoke all on public.import_map from anon, authenticated;
grant all on public.import_run to service_role;
grant all on public.import_map to service_role;

-- Phase 0 Part A — durable TDR write queue.
-- A save lands here FIRST (Supabase is fast + healthy even when Xano chokes), so
-- a tech's part number / report can never be lost to a slow or down Xano. A cron
-- (tdr-sync-cron) drains unsynced rows into Xano create_tdr and marks them synced.
-- Run this in the ANT OPS Supabase project (the one holding board_mirror /
-- SUPABASE_URL + SUPABASE_SERVICE_KEY).

create table if not exists tdr_pending (
  id             bigserial primary key,
  job_id         bigint,
  technician_id  bigint,
  client_key     text unique,          -- content signature -> identical re-tap = same row (no dup)
  payload        jsonb not null,       -- the exact create_tdr body
  synced         boolean not null default false,
  attempts       int not null default 0,
  last_error     text,
  source         text default 'tech_app',
  created_at     timestamptz not null default now(),
  synced_at      timestamptz
);

-- fast lookup of the drain set
create index if not exists tdr_pending_unsynced
  on tdr_pending (created_at)
  where synced = false;

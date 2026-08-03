-- 003_loop_spine.sql — the colony loop's Postgres spine (Phase 2 shadow store).
-- Run once in the ANT OPS Supabase SQL editor. Idempotent.
--
-- This is the Supabase-Postgres version of colony-loop/db.js's three local-SQLite
-- tables (signals queue + dedup markers + event log), TOGETHER in one store — the
-- LOCKED Decision #1. The shadow loop (LOOP_STORE=pg) reads/writes these; the tee
-- (LOOP_PG_TEE=true on the live loop) mirrors live emits in so the shadow can
-- replay the real stream WITHOUT draining the live queue.
--
-- Timestamps are unix-ms bigints (not timestamptz) to be a byte-for-byte drop-in
-- for db.js — the loop code works entirely in Date.now() milliseconds.
-- Namespaced `loop_` so nothing collides with the auth/storage system tables.

-- ── the signal queue ─────────────────────────────────────────────────────────
create table if not exists loop_signals (
  id              bigint generated always as identity primary key,
  signal_type     text   not null,
  signal_strength int    default 50,
  source_colony   text,
  target_colonies text   default '',
  payload         jsonb  not null default '{}',
  job_id          text,
  result_action   text,
  origin          text   default 'shadow',
  inbox_ref       text,                              -- external Xano row id (idempotent drain)
  process_after   bigint,                            -- unix ms; null = ready now (deadline-aware)
  created_at      bigint not null,                   -- unix ms
  processed_at    bigint                             -- unix ms; null = pending
);
create index if not exists loop_signals_pending      on loop_signals (processed_at, process_after, created_at);
create index if not exists loop_signals_type_pending on loop_signals (signal_type, processed_at);
create index if not exists loop_signals_job          on loop_signals (signal_type, job_id, processed_at);
-- idempotent inbox drain: a given external row lands at most once
create unique index if not exists loop_signals_inbox_ref on loop_signals (inbox_ref) where inbox_ref is not null;

-- ── dedup markers (fired-today) ──────────────────────────────────────────────
create table if not exists loop_fired_markers (
  action     text   not null,
  day_key    text   not null,
  created_at bigint not null,
  primary key (action, day_key)
);

-- ── event log (loop plumbing rows — high churn stays here, not Xano) ──────────
create table if not exists loop_events (
  id         bigint generated always as identity primary key,
  action     text   not null,
  metadata   jsonb  not null default '{}',
  created_at bigint not null
);
create index if not exists loop_events_action on loop_events (action, created_at);

-- Server-side only: the loop connects with the service key (bypasses RLS).
-- Lock the tables away from any browser anon/authenticated key.
alter table loop_signals       enable row level security;
alter table loop_fired_markers enable row level security;
alter table loop_events        enable row level security;

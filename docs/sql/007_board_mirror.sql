-- 007_board_mirror.sql — the fast office-board read layer (2026-08-25)
--
-- WHY: get_office_kanban (Xano) loads ~800 jobs with a 7-status-OR query and runs
-- 4-16s, and Xano's shared compute SATURATES under the office's concurrent load,
-- which is what makes the board "take forever" (Danielle's #1 complaint). No amount
-- of caching fixes a slow substrate. This mirror table is the real fix: a sync cron
-- (board-mirror-sync) pulls the heavy Xano query ONCE per ~45s server-side and
-- upserts every job here; board-feed-fast then serves the board from THIS table at
-- ~50-100ms. Every office user shares one Supabase read — nobody touches Xano to
-- load the board, so even when Xano chokes, the board stays instant.
--
-- Run once in the Supabase SQL editor of the ANT OPS project (SUPABASE_URL).
-- Columns mirror get_office_kanban's 28 fields exactly (verified types 2026-08-25).

create table if not exists board_mirror (
  id                        bigint primary key,
  appliance                 text,
  brand                     text,
  claim_number              text,
  created_at                bigint,
  current_status            text,
  customer_first            text,
  customer_id               bigint,
  customer_last             text,
  customer_phone            text,
  customer_preference_text  text,
  dispatch_source_id        text,
  intake_source             text,
  job_completed_at          bigint,
  office_stage              text,
  parallel_mode             boolean,
  parts_eta_date            text,
  parts_status              text,
  problem_summary           text,
  scheduled_start           bigint,
  scheduling_status         text,
  service_city              text,
  service_eta_window        text,
  service_state             text,
  service_zip               text,
  technician_id             bigint,
  warranty_company          text,
  synced_at                 timestamptz not null default now()
);

create index if not exists board_mirror_status_idx on board_mirror (scheduling_status);
create index if not exists board_mirror_tech_idx   on board_mirror (technician_id);
create index if not exists board_mirror_stage_idx  on board_mirror (office_stage);

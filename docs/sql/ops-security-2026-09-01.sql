-- ANT OPS Supabase — security remediation (2026-09-01)
-- Project: ANT OPS (ref iqpyubevwsaguekujsax) — the archive / intelligence store
-- (hcp_archive, hcp_vectors, meistertask_archive, event_log, brain_*, board_mirror,
--  xano_backup_chunks, trial_shop). NOT the ANT Platforms SaaS project.
--
-- WHY: Supabase Security Advisor flagged `rls_disabled_in_public` — board_mirror +
-- brain_outcome had RLS OFF while anon + authenticated held full table grants
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE). So anyone with the project's anon key could
-- read/write/delete those two tables. Worse: EVERY public table (incl. hcp_archive's
-- ~49k real customer rows and event_log's 156k rows) carried a TRUNCATE grant to
-- anon/authenticated — and TRUNCATE BYPASSES RLS — so the archives could be wiped even
-- though their RLS was on.
--
-- SAFE because ANT OPS is 100% server-only: every reader/writer uses the service_role
-- key via netlify/functions/_lib/supabase.js (SUPABASE_SERVICE_KEY), which bypasses RLS
-- and keeps its own grants. No browser/client code references this project (verified:
-- zero repo matches for `iqpyubevwsaguekujsax` in *.html/*.js). Revoking anon +
-- authenticated therefore breaks nothing.
--
-- Applied via netlify/functions/sb-admin-sql.js (?project=ops) — Supabase Management API.

-- 1) Enable RLS on the two exposed tables (deny-all to clients; service_role bypasses).
alter table public.board_mirror  enable row level security;
alter table public.brain_outcome enable row level security;

-- 2) Strip ALL client grants on every public table — closes the TRUNCATE-bypasses-RLS
--    wipe hole across the whole schema. service_role is untouched and keeps ALL.
revoke all privileges on all tables in schema public from anon, authenticated;

-- 3) Prevent recurrence: new tables in public won't auto-grant the client roles.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- VERIFIED 2026-09-01: every public table now rls_on=true, anon_reachable=false;
-- backend db-size-check (service_role) still returns ok:true. The live ANT Platforms
-- project (tntbhfwitytkcoqlejwc) was swept the same day — zero RLS-off public tables.

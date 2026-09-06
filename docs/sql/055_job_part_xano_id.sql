-- 055_job_part_xano_id.sql — phase-2 parts migration idempotency spine.
-- Lets the Xano→platform parts migration (platform-tn-parts-migrate.js) upsert
-- per-part rows on a stable key so a re-run NEVER duplicates a part. Native
-- app-created rows (office/tech) have xano_id NULL and are untouched — the
-- partial unique index only constrains migrated rows.
--
-- Apply live via: sb-admin-sql?project=platform (Supabase Management API).

-- TEXT (not bigint): the migration pulls from TWO Xano sources whose integer
-- ids share a range — parts_orders rows ('po:<id>') and warranty_part_supplied
-- event_log rows ('wp:<id>'). Namespacing in a text key prevents cross-source
-- collision on (company_id, xano_id).
alter table public.job_part add column if not exists xano_id text;
alter table public.job_part alter column xano_id type text using xano_id::text;

-- Plain (NOT partial) unique: PostgREST's on_conflict=(company_id,xano_id) can only
-- infer a full unique index. Postgres treats NULLs as distinct, so the many native
-- app-created rows (xano_id NULL) never collide, while a given legacy Xano parts
-- record lands at most once per company.
create unique index if not exists job_part_company_xano_uidx
  on public.job_part (company_id, xano_id);

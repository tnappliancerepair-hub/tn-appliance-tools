-- 049_multitenant_indexes.sql — per-tenant hot-path indexes (APPLIED live 2026-09-05).
--
-- Every platform query is RLS-scoped by company_id (current_company_id()). Without a
-- company_id index each per-shop query sequential-scans the whole table filtered by
-- company_id — fine at a few thousand rows, but the classic multi-tenant slowdown as
-- tenants + total rows grow. These keep each shop's queries index-backed so speed stays
-- flat regardless of how many OTHER tenants share the database. Composite indexes match
-- the app's hottest access patterns (board by status, day views, recent, caller lookup).
--
-- Safe + idempotent (IF NOT EXISTS). Tiny tables → instant, non-locking. Reversible: DROP INDEX.

create index if not exists idx_job_company           on job(company_id);
create index if not exists idx_job_company_status    on job(company_id, status);
create index if not exists idx_job_company_day       on job(company_id, scheduled_day);
create index if not exists idx_job_company_created    on job(company_id, created_at);
create index if not exists idx_job_customer          on job(customer_id);

create index if not exists idx_customer_company       on customer(company_id);
create index if not exists idx_customer_company_phone on customer(company_id, phone);

create index if not exists idx_unit_company          on unit(company_id);

create index if not exists idx_thread_job            on thread_message(job_id);
create index if not exists idx_thread_company        on thread_message(company_id);

create index if not exists idx_portal_job            on portal_grant(job_id);

create index if not exists idx_tech_company          on technician(company_id);

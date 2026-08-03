-- 002_db_sizes.sql — read-only DB-size introspection for the db-size-check endpoint.
-- Run once in the ANT OPS Supabase SQL editor. Idempotent.
--
-- PostgREST can't read pg_total_relation_size / pg_stat_user_tables directly, so we
-- expose a SECURITY DEFINER function (runs as the owner, which can read the catalog)
-- and lock EXECUTE to service_role only — the db-size-check function calls it with
-- the service key, and browser anon/authenticated keys can't touch it.

create or replace function public.ant_db_sizes()
returns table (
  table_name      text,
  total_bytes     bigint,
  size            text,
  live_rows       bigint,
  dead_rows       bigint,
  last_autovacuum timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    relname::text,
    pg_total_relation_size(relid)::bigint,
    pg_size_pretty(pg_total_relation_size(relid)),
    n_live_tup::bigint,
    n_dead_tup::bigint,
    last_autovacuum
  from pg_stat_user_tables
  order by pg_total_relation_size(relid) desc
$$;

-- Only the server-side service_role may call it (never anon/authenticated browsers).
revoke all     on function public.ant_db_sizes() from public, anon, authenticated;
grant  execute on function public.ant_db_sizes() to service_role;

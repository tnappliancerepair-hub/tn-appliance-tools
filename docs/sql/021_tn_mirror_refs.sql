-- 021_tn_mirror_refs — xano_id ref columns so the Xano->platform tenant mirror
-- (platform-tn-mirror) is idempotent: upsert on (company_id, xano_id) instead of
-- duplicating on every run. TN Appliance = tenant #1 (company 7b421706-...).
alter table public.customer add column if not exists xano_id bigint;
alter table public.unit     add column if not exists xano_id bigint;
alter table public.job      add column if not exists xano_id bigint;
create unique index if not exists customer_company_xano_uidx on public.customer(company_id, xano_id);
create unique index if not exists unit_company_xano_uidx     on public.unit(company_id, xano_id);
create unique index if not exists job_company_xano_uidx      on public.job(company_id, xano_id);

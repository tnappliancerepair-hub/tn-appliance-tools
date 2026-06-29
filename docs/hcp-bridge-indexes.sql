-- Phone-bridge indexes on hcp_archive — let the Ant phone assistant recognize a
-- caller who's only in Housecall Pro (not yet in Xano) and pull their history fast.
-- Run once in the Supabase SQL editor (same place the hcp_archive DDL ran).
--
-- Auto-computed STORED columns (backfill instantly + stay correct on any future
-- insert): phone10 = caller's number normalized to 10 digits; cust_id = the HCP
-- customer id a job belongs to (so we can find a caller's past jobs by one index).

alter table hcp_archive
  add column if not exists phone10 text
  generated always as (
    right(regexp_replace(coalesce(data->>'mobile_number', data->>'home_number', data->>'work_number', ''), '\D', '', 'g'), 10)
  ) stored;

alter table hcp_archive
  add column if not exists cust_id text
  generated always as (data->'customer'->>'id') stored;

create index if not exists hcp_archive_phone10_idx on hcp_archive (phone10);
create index if not exists hcp_archive_custid_idx  on hcp_archive (cust_id);

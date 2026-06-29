-- hcp_archive — years of Housecall Pro history mined into Supabase for the
-- intelligence layer (pre-diagnosis, customer history, price calibration).
-- ARCHIVE ONLY — never the live jobs/customer tables. Mirrors meistertask_archive.
--
-- Run once in the Supabase SQL editor (same place the meistertask_archive DDL ran).
-- Then: netlify/functions/hcp-pull.js grinds HCP → these rows.

create table if not exists hcp_archive (
  id          bigserial primary key,
  kind        text not null,            -- 'job' | 'customer' | 'invoice' | 'estimate' | '_cursor' | '_manifest'
  hcp_id      text,                     -- the HCP object id (null for control rows)
  title       text,                     -- short human label (customer / job desc / invoice #)
  data        jsonb,                    -- the full raw HCP object
  created_at  timestamptz default now()
);

create index if not exists hcp_archive_kind_idx  on hcp_archive (kind);
create index if not exists hcp_archive_hcpid_idx on hcp_archive (hcp_id);

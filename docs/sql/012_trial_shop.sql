-- Trial-Ann data-driven registry.
-- Lets us stand up a new shop's Ann on a sales call WITHOUT a code edit + Netlify deploy:
-- trial-ann-admin?action=add_shop writes a row here, and _lib/trial-shops.getAsync() reads
-- it live (file-first for the hand-curated shops like Greg, then this store for new ones).
-- Run in the ANT OPS Supabase project (same one as board_mirror / tdr_pending — the
-- SUPABASE_URL / SUPABASE_SERVICE_KEY that _lib/supabase.js already uses).

create table if not exists trial_shop (
  slug        text primary key,          -- short lowercase handle
  config      jsonb not null,            -- the shop object: name, type, ownerFirst, ownerCell,
                                          -- area, hours, about, email, autoScope, greeting,
                                          -- platformSlug, planPrice, assistantId, annNumber, ...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

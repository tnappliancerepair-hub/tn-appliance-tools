-- v2_shadow_decisions — the Supabase-v2 scheduling-brain shadow ledger.
--
-- Phase 0 of the clean Supabase rebuild: a cloud-hosted v2 brain (clean JS in a
-- Netlify function, NO Mac, NO XanoScript) makes the FULL scheduling decision
-- (tech + day + time) for every job in the live needs-scheduled queue, writes its
-- call here, then later reconciles it against what the live system ACTUALLY did.
-- Watch the agreement % climb → that's how we EARN "bulletproof" before cutover.
--
-- Run this once in the Supabase SQL editor (same project as xano_backup_chunks).
-- Zero impact on the live shop — this table is written only by v2-shadow.js.

create table if not exists v2_shadow_decisions (
  id              bigint generated always as identity primary key,
  job_id          bigint not null unique,

  -- where this decision came from: the needs-scheduled queue, or the
  -- awaiting-parts re-placement track (part arrived -> who/when should it go back on?)
  origin          text not null default 'queue',        -- queue | awaiting_parts
  part_ready      boolean,                               -- (awaiting_parts only) does the part look in? (eta passed/absent)

  -- what v2 decided (its "first impression" when the job hit the queue)
  status          text not null default 'predicted',   -- predicted | no_fit | gated | vendor_locked | reconciled | gone
  predicted_tech  bigint,
  predicted_day   date,
  predicted_start_ms bigint,
  why             text,
  no_fit_reason   text,                                 -- when status != predicted, WHY (no_zip, no_tech_for_zip, no_open_day, no_prediag, parts, vendor_locked …)
  profile_applied boolean default false,                -- did a tech interview profile constrain the pick?
  clustered       boolean default false,                -- did v2 ride a day the tech is already working (route density)?

  -- context snapshot (so a miss is eyeball-able without another lookup)
  zip             text,
  city            text,
  appliance       text,
  warranty_company text,

  -- what reality did (filled on reconcile)
  actual_tech     bigint,
  actual_day      date,
  actual_start_ms bigint,
  tech_match      boolean,                              -- predicted_tech == actual_tech
  day_match       boolean,                              -- predicted_day  == actual_day
  reconciled_at   timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists v2_shadow_status_idx  on v2_shadow_decisions (status);
create index if not exists v2_shadow_origin_idx  on v2_shadow_decisions (origin);
create index if not exists v2_shadow_created_idx on v2_shadow_decisions (created_at desc);

-- That's it. v2-shadow.js (Netlify, scheduled) fills it. v2-scoreboard.js reads it.

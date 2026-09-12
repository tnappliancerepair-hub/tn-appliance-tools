-- 062_part_shipment.sql — what was SENT, and is it here yet.
--
-- Teddy 2026-09-11: "Even parts eta and what has been sent would be helpful on the job so the
-- tech knows if parts are there or not and what was sent so they can manage the parts
-- efficiently."
--
-- job_part already tracks the RETURN leg (return_tracking / return_carrier / returned_at) and
-- has an `eta` column. What it has never had is the OUTBOUND leg -- the shipment coming TO the
-- job. Without it a tech cannot tell "ordered" from "on your porch", which is the whole question
-- he asks before driving.
--
-- Deliberately separate from the return columns. Conflating the two is how a return label ends
-- up read as an inbound delivery.
alter table job_part add column if not exists ship_tracking   text;
alter table job_part add column if not exists ship_carrier    text;
-- Free text straight from the carrier ("Delivered", "In transit", "Label created"), plus a
-- coarse boolean so the UI never has to string-match a carrier's wording.
alter table job_part add column if not exists ship_status     text;
alter table job_part add column if not exists ship_delivered  boolean;
alter table job_part add column if not exists ship_status_at  timestamptz;

comment on column job_part.ship_tracking is
  'Outbound shipment TO us/customer. NOT the return leg -- that is return_tracking.';

-- NOTE: deliberately NO unique index on (job_id, number).
-- The email parser has been writing descriptive junk into `number` --
--   "THERMOSTAT HI LIMIT WE04X30381<newline>Part #WE04X30381"  with `name` NULL --
-- so a normalized-text unique index would neither match the API's clean "WE04X30381" nor
-- build cleanly over existing rows. The sync therefore matches in CODE on an EXTRACTED part
-- number and repairs the dirty row as it goes (clean number + real description into `name`).
-- Revisit a unique index only once the rows are actually clean.

create index if not exists job_part_ship_tracking_idx
  on job_part (ship_tracking) where ship_tracking is not null;

-- Cursor for the sweep. Without this the sync re-processes the same newest N jobs forever and
-- the other ~300 never get looked at. Ordering by this ascending (nulls first) makes the sweep
-- actually walk the whole book and then keep it fresh.
-- Safe against the Xano mirror: merge-duplicates only writes the columns it sends, and it
-- never sends this one.
alter table job add column if not exists sp_parts_synced_at timestamptz;
create index if not exists job_sp_parts_synced_idx
  on job (company_id, sp_parts_synced_at nulls first)
  where claim_number is not null;

-- 064_part_must_return.sql — the vendor's own return obligation, captured at ORDER time.
--
-- ServicePower states it per part in the order notes:
--     If used during repair  requires return: Yes
-- That is the vendor's RULE, and it is known the day the part ships. Today we only discover a
-- return obligation later -- when the prepaid-label email arrives and parses, or when a tech
-- taps "Return" at the stop. Both are after the fact, and SquareTrade's policy is blunt:
--   "If parts are not returned or returned incorrectly or damaged, you will not be paid for the
--    repair and may be charged for the new part or core."
-- Capturing it up front means the returns list is complete from day one instead of depending on
-- an email landing.
--
-- DELIBERATELY SEPARATE FROM `disposition`. They answer different questions:
--   must_return  = the VENDOR's rule      ("this one is owed back")
--   disposition  = what the TECH did      (used / return / not_here)
-- A part can be must_return=true and disposition='used' at the same time -- that is precisely a
-- core exchange, and collapsing the two would erase the obligation the moment a tech marks it used.
alter table job_part add column if not exists must_return boolean;

comment on column job_part.must_return is
  'Vendor says this part is owed back (core/defective), known at order time. NOT the same as disposition, which is what the tech actually did with it.';

-- The office question is "what is owed back and not yet shipped", across jobs.
create index if not exists job_part_must_return_idx
  on job_part (company_id, must_return)
  where must_return is true and returned_at is null;

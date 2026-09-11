-- 069_ahs_return_terms.sql — the RETURN TERMS, captured from the vendor's own notice.
--
-- 064 added must_return = "this part is owed back". That was enough for SquareTrade, whose
-- RMA email carries a prepaid FedEx label and no stated clock. AHS is a different animal and
-- it is HALF our parts volume (measured 2026-09-11: 980 AHS parts / 489 jobs in 90 days,
-- against 1,024 SquareTrade parts):
--
--   * AHS emails "Part Return Notification" with an EXPLICIT deadline and an EXPLICIT dollar:
--     "returned to the supplier within 30 days or $295.74 will be deducted from your payables."
--   * AHS provides NO shipping label -- we pay the freight unless the error was theirs.
--
-- So "owed back" alone can't be triaged: the office needs to know WHEN it bites and for HOW
-- MUCH, or every obligation looks the same and the expensive one with 10 days left sinks to
-- the bottom of the list. These three columns are that.
--
-- Kept SEPARATE from must_return on purpose, same reasoning as 064: must_return is WHETHER,
-- these are WHEN and HOW MUCH. A row can be owed back with no stated terms (SquareTrade), and
-- the surfaces must not read a missing deadline as "not owed".
alter table job_part add column if not exists return_due_at        date;
alter table job_part add column if not exists return_penalty_cents integer;
alter table job_part add column if not exists return_po            text;

comment on column job_part.return_due_at is
  'Vendor deadline to get this part back (AHS: notice date + the stated 10/30 days). NULL = no stated clock, NOT "no obligation" -- read must_return for that.';
comment on column job_part.return_penalty_cents is
  'Dollars the vendor says they deduct if it is not returned. WARNING: AHS states this PER PO, not per part -- a PO covering 3 parts stamps the same amount on all 3. Sum distinct on return_po, never sum the column.';
comment on column job_part.return_po is
  'The vendor PO the return notice covered (AHS "PO #: <claim>-<line>"). The dedupe key for return_penalty_cents.';

-- The office question is "what is about to cost us money" -- deadline order, open rows only.
create index if not exists job_part_return_due_idx
  on job_part (company_id, return_due_at)
  where must_return is true and returned_at is null;

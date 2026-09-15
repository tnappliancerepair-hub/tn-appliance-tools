-- 073_part_shelf.sql — a fourth disposition: the part is ON OUR SHELF.
--
-- WHY: Danielle, 2026-09-15 — "Ok so do we need to return it. Its in storage. So use the
-- valve for today's job." A customer held off on a compressor repair. The part is bought and
-- sitting in storage. Two questions follow, and the system could answer NEITHER:
--   1. Is it owed back to the vendor, or is it ours to keep?
--   2. What ELSE is on that shelf that today's job could use?
--
-- disposition allowed exactly used | return | not_here. So "we have it, it's ours, it isn't
-- installed" had nowhere to live. A part on a job that died just sat with disposition NULL --
-- invisible to the returns worklist, invisible as stock, and indistinguishable from a part
-- nobody had gotten to yet. Measured live on TN: 24 parts across 17 CANCELED jobs, every one
-- a real claim, not one carrying any disposition at all.
--
-- 'shelf' is deliberately a DISPOSITION and not a new table. It is the same question the other
-- three answer -- what became of this part -- and it keeps every existing reader (returns
-- worklist, tech card, invoice filter) on one column instead of two.
--
-- ADDITIVE + REVERSIBLE: widening a CHECK cannot invalidate an existing row.

alter table job_part drop constraint if exists job_part_disposition_check;
alter table job_part add constraint job_part_disposition_check
  check (disposition = any (array['used'::text, 'return'::text, 'not_here'::text, 'shelf'::text]));

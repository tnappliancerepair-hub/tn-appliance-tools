-- 074 · A NOTE THAT LIVES ON THE PART — the office<->tech back-and-forth (Teddy 2026-09-15)
--
-- The office marks where a part is (route/ETA/source) days before the visit; the tech has to
-- know, and he has to be able to answer ABOUT THAT PART: "didn't need this one, sending it
-- back" / "used it, job's done" / "used this one but not that one."
--
-- Today that conversation has nowhere to live. job.office_notes is the JOB's note -- it can't
-- say WHICH part -- and the tech's Used / Return / Not-here tap writes a column and tells
-- NOBODY. Measured live on TN's board: of 1,194 parts on 466 open jobs, ship_to (where the
-- part IS) is set on 25 and eta on 5, and only 3 'used' marks in the whole book came from a
-- tech (492 are the Xano mirror). Nobody uses a button that has no effect.
--
--   note      the running conversation, APPEND-only, attribution + time baked into the text
--             (same shape as job.office_notes, which is proven and already renders on both sides)
--   note_at   when the last line landed
--   note_by   who said it
--   note_role 'office' | 'tech' -- WHO SPOKE LAST. This is the whole unread signal: if the tech
--             spoke last the office tile lights up, and vice versa. Whoever answers takes the
--             ball back. Self-clearing, no read-receipt table, no per-user state.
--
-- Deliberately NOT thread_message: that table is the CUSTOMER's thread and renders in the
-- portal. Parts chatter -- part numbers, cost, "wrong one came" -- must never leak there.
--
-- Additive + re-runnable. Nothing reads these columns until the UI ships, so applying this
-- early is a no-op on every existing row.

alter table job_part add column if not exists note      text;
alter table job_part add column if not exists note_at   timestamptz;
alter table job_part add column if not exists note_by   text;
alter table job_part add column if not exists note_role text;

alter table job_part drop constraint if exists job_part_note_role_check;
alter table job_part add constraint job_part_note_role_check
  check (note_role is null or note_role = any (array['office'::text, 'tech'::text]));

-- The tile/day-list ask is always "does this job have a part the other side spoke last on",
-- so index the job + who-spoke pair rather than the note text.
create index if not exists job_part_note_role_idx on job_part (job_id, note_role)
  where note_role is not null;

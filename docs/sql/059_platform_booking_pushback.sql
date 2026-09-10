-- 059_platform_booking_pushback.sql  (2026-09-10)
--
-- THE HOLE: bookings made ON THE PLATFORM never reach Xano. The mirror's never-walk-backwards
-- guard stops Xano erasing them, but nothing carries them the other way - so while both systems
-- are live, the legacy board and the Xano tech app are blind to work the office booked here.
--
-- WHY A COLUMN AND NOT INFERENCE: the three booking surfaces (office-board, dispatch,
-- needs-scheduled) write straight to PostgREST from the browser, so there is no server hook to
-- fire on. Inferring "platform has a day, Xano is blank => the platform booked it" is WRONG in
-- one real case: Xano UNSCHEDULING a job looks identical, and pushing back would resurrect a
-- booking someone deliberately cleared. An explicit stamp cannot be confused with either.
--
--   platform_booked_at        stamped by the browser the moment a booking write succeeds,
--                             CLEARED by the pusher once Xano accepts it
--   platform_booked_pushed_at audit only - when it last went across
--
-- So `platform_booked_at is not null` IS the pending queue. A RESCHEDULE re-stamps it and the
-- job re-qualifies. It has to be a consumable queue rather than comparing booked_at > pushed_at
-- because PostgREST compares a filter against a LITERAL, never another column - that shape
-- returned an error on the first run and would have silently pushed nothing.
--
-- The mirror never writes either column, so they survive every run untouched.

alter table job add column if not exists platform_booked_at        timestamptz;
alter table job add column if not exists platform_booked_pushed_at timestamptz;

-- The pusher's only query. Partial so it stays tiny however large `job` grows.
drop index if exists job_platform_booked_pending_idx;
create index if not exists job_platform_booked_pending_idx
  on job (company_id, platform_booked_at)
  where platform_booked_at is not null;

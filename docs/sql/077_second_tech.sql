-- 077 · job.technician2_id — the second man on a job.
--
-- Danielle, 2026-09-15: "Need a way to add and schedule a 2nd man to a job."
--
-- The platform already had needs_two_techs (migration 014) — but it is a FLAG and nothing
-- more. A tech could raise his hand from the field ("🧑‍🤝‍🧑 Two-man job") and the office
-- could see the chip on the card, and that was the whole feature: there was no way to say
-- WHO the second man is, and no way to get the stop onto his day. So the flag told everyone
-- a problem existed and left the answer to a phone call.
--
-- One column, because "a 2nd man" is literally two people. A helper table would buy N
-- helpers we have never once needed and cost every reader a join.
--
-- ON DELETE SET NULL, not cascade: a tech leaving must never delete the job he was helping
-- on. (Billy left in July; his jobs are still on the board under "Tech 5".)

alter table public.job
  add column if not exists technician2_id uuid references public.technician(id) on delete set null;

-- The tech's day asks "which stops are mine" on every load, and now that means either seat.
create index if not exists job_tech2_day_idx
  on public.job (company_id, technician2_id, scheduled_day) where technician2_id is not null;

-- A stop can't have the same person twice. Silently allowing it would double-count him in
-- dispatch capacity and show the job twice on his own day.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_tech2_not_same_check') then
    alter table public.job
      add constraint job_tech2_not_same_check
      check (technician2_id is null or technician_id is null or technician2_id <> technician_id);
  end if;
end $$;

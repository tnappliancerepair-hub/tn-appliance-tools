-- 058_board_latest_inbound.sql  (APPLIED live 2026-09-10)
--
-- WHY: platform/office-board.html asked for EVERY inbound customer message on every job
-- on the board (12,597 rows for TN) and then threw all but the newest one per job away in
-- the browser. Two problems, both live:
--   1. it was one of the slowest things on the board load, on every load and every realtime
--      refresh, and the job-id list alone made a ~62KB request URL;
--   2. PostgREST caps a response at 1,000 rows, so most jobs' latest message never arrived
--      at all - the green "they replied" bubble was simply missing for the majority of the
--      board, silently. The board looked fine and was wrong.
--
-- Decide it in Postgres instead: one row per job, newest inbound first.
--
-- Scoped to the same active window the board itself loads (non-terminal, plus completed
-- within 90 days - deliberately a little wider than the board's 75-day cutoff so a job the
-- board shows can never fall outside this). That keeps the row count proportional to LIVE
-- work (~800) instead of growing with history until it creeps back over the 1,000 cap and
-- silently reintroduces the same bug.
--
-- SECURITY INVOKER on purpose: the caller's own RLS decides which company's rows they see,
-- exactly as a direct select would. This function must never be SECURITY DEFINER - that
-- would hand every office user every tenant's customer messages.

CREATE OR REPLACE FUNCTION public.board_latest_inbound()
RETURNS TABLE(job_id uuid, body text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
  select distinct on (m.job_id) m.job_id, m.body, m.created_at
  from thread_message m
  join job j on j.id = m.job_id
  where m.direction = 'in'
    and m.job_id is not null
    and (
      j.status not in ('completed','canceled')
      or (j.status = 'completed' and j.updated_at >= now() - interval '90 days')
    )
  order by m.job_id, m.created_at desc
$function$;

grant execute on function public.board_latest_inbound() to authenticated;

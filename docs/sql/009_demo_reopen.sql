-- 009_demo_reopen.sql — bring the demo jobs back after they were closed by mistake.
-- Reopens every job on the demo shop's board, puts it on Joey's day, and assigns it to
-- Joey (the demo tech) so it shows in the tech app. Safe to re-run. Run in the ANT
-- Platforms project SQL editor.
do $$
declare c uuid; t uuid; n int;
begin
  -- the demo shop (Joey's) + Joey as the tech
  select id into c from public.company where name ilike '%joey%' order by created_at limit 1;
  if c is null then raise notice 'no demo company found — nothing to do'; return; end if;
  select id into t from public.technician where company_id = c order by created_at limit 1;

  update public.job
     set status        = 'scheduled',
         technician_id = coalesce(t, technician_id),
         scheduled_day = current_date
   where company_id = c;

  get diagnostics n = row_count;
  raise notice 'reopened % job(s) for company % and put them on Joey (%)', n, c, t;
end $$;

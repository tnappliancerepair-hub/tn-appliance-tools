-- 017_tdr_labor_hours.sql — add LABOR HOURS to the technician report. Run in the ANT
-- Platforms project. Optional: the cockpit already saves the report without it (it folds
-- the hours into the notes as a fallback), but with this column labor time is its own clean
-- field — useful later for payroll, job-costing, and the cross-shop brain.
alter table public.job_tdr add column if not exists labor_hours numeric;

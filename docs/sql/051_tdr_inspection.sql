-- 051_tdr_inspection.sql — add the NATIVE INSPECTION CHECKLIST to the technician report.
-- Run in the ANT Platforms project. The tech app (platform/tech-job.html) renders a per-
-- appliance checklist (refrigerator/washer/dryer/dishwasher/range/microwave) built from
-- standard diagnostic practice — OUR own checklists, not a third party's forms — and stores
-- the ticked items here as jsonb: { kind, checked:[ "Section::Item", ... ], ts }. Optional
-- (a tech isn't blocked or dinged for skipping it); useful for the office record, warranty
-- packages, and later the cross-shop brain. RLS + grants are already on job_tdr (008).
alter table public.job_tdr add column if not exists inspection jsonb;

-- 001_brain_eval.sql — the forward-eval harness table for the troubleshooting brain.
-- Run once in the Supabase SQL editor (Ant ops project). Idempotent.
--
-- Every prediction the brain makes is logged BEFORE the job closes (leak-proof by
-- construction); when the job closes we grade it against the actual fix. This is
-- the linchpin of docs/intelligence-architecture.md §Layer 4 — "measure it or it's
-- a vibe."

create table if not exists brain_predictions (
  id             bigint generated always as identity primary key,
  job_id         bigint,
  made_at        timestamptz  not null default now(),   -- BEFORE the outcome exists
  context        text,                                  -- intake | pre_diagnosis | backtest
  appliance      text,
  brand          text,
  model          text,
  symptom        text,
  pred_parts     jsonb        not null default '[]',    -- ranked [{part, confidence}]
  pred_component text,
  top_confidence numeric,
  grounded       boolean,                               -- was the answer cited/grounded?
  company_id     int          not null default 1,       -- multi-tenant from day one
  -- filled at grading time (when the job closes):
  graded_at      timestamptz,
  actual_part    text,
  actual_component text,
  hit_top1       boolean,
  hit_top3       boolean,
  component_hit  boolean,
  outcome_source text                                   -- which TDR field the truth came from
);

create index if not exists brain_predictions_job    on brain_predictions (job_id);
create index if not exists brain_predictions_graded on brain_predictions (graded_at);
create index if not exists brain_predictions_slice  on brain_predictions (appliance, brand);

-- Weekly accuracy rollup, sliced by appliance + brand — the nightly scorecard reads this.
create or replace view brain_eval_rollup as
select
  date_trunc('week', graded_at)              as week,
  appliance,
  brand,
  count(*)                                    as graded,
  round(avg((hit_top1)::int)::numeric, 3)     as top1_accuracy,
  round(avg((hit_top3)::int)::numeric, 3)     as top3_accuracy,
  round(avg((component_hit)::int)::numeric, 3) as component_accuracy,
  round(avg((grounded)::int)::numeric, 3)     as grounded_rate
from brain_predictions
where graded_at is not null
group by 1, 2, 3
order by 1 desc, graded desc;

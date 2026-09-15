-- 072_part_qty.sql — HOW MANY of this part. Run in the ANT Platforms project.
--
-- Teddy 2026-09-15: "when they're adding parts we need multiple options available because a
-- lot of times there's going to be multiple parts needed... and a little ticker at the end
-- they can adjust — one, two, three, four — some things they need multiples of."
--
-- job_part was already one row per part, so "multiple parts" was structurally there. What was
-- missing is the COUNT: a tech replacing four door bins, or two suspension rods, had one row
-- and no way to say how many. He'd either type "x4" into the name (junk the office has to
-- read) or log four identical rows (which the read-layer dedupe in 068's part_key() would
-- COLLAPSE back to one -- so the extra three vanish and we eat the cost).
--
-- ⚠️ THE MONEY RULE, and it is the whole reason this is a column and not a name suffix:
-- cost_cents and sell_cents stay the UNIT price. They already mean that on every row written
-- since 034/038, and redefining them to "line total" would silently re-price the entire
-- existing book. So every surface that touches money MULTIPLIES:  qty * sell_cents.
-- Under-billing is the failure this creates if a reader forgets, so the readers are the
-- work, not the column. Wired 2026-09-15: office-board invoice worksheet + drawer,
-- owner.html P&L, platform-ant.js, returns.html, portal_get.
--
-- NOT NULL DEFAULT 1 on purpose: every historical row IS one part, and a nullable qty would
-- make "unknown" and "one" indistinguishable at exactly the moment a reader multiplies.
alter table public.job_part add column if not exists qty integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_part_qty_check') then
    alter table public.job_part add constraint job_part_qty_check check (qty >= 1);
  end if;
end $$;

comment on column public.job_part.qty is
  'How many of this part. Always >= 1, default 1. cost_cents/sell_cents are the UNIT price -- multiply by qty for a line total. Never fold the count into name/number.';

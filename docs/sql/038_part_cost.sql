-- 038_part_cost.sql — parts-margin automation. The tech enters what the part COST the shop;
-- the owner sets one parts margin (company.settings.parts.markup_pct + optional min_add_cents);
-- retail (job_part.sell_cents) auto-derives = max(cost × (1+markup), cost + min_add). The tech
-- never has to ask "what do we charge for this" — the margin does it, and the cost→retail
-- breakdown flows to the office tile invoice + the owner's money view. Run in ANT Platforms.

alter table public.job_part add column if not exists cost_cents integer;   -- what the part cost the shop (tech enters)

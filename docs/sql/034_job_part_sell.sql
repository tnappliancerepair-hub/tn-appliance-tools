-- 034_job_part_sell.sql — let the tech's logged parts carry a price so the office invoice
-- itemizes them instead of re-keying one lump "Parts $". The tech captures name+number in the
-- field (job_part); the office prices each in the invoice drawer, the sum feeds Parts $, and
-- each part becomes its own invoice line on the customer's receipt. Run in ANT Platforms.

alter table public.job_part add column if not exists sell_cents integer;

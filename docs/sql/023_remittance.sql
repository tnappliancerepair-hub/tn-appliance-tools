-- 023_remittance.sql — the accuracy hinge. Track ACTUAL money collected per invoice
-- (a warranty vendor pays a batch EFT, often LESS than billed). `collected_cents` = real
-- money in; `paid_ref` = the EFT/check reference. The shop's Collected + Take-home read the
-- REAL amount; the tech's cut stays commission-on-labor (shop absorbs the warranty haircut,
-- not the tech). Full self-pay/card payments set collected_cents = total_cents.
-- Run: sb-admin-sql ?project=platform. Idempotent.
alter table public.invoice add column if not exists collected_cents integer not null default 0;
alter table public.invoice add column if not exists paid_ref text;
-- Backfill: anything already marked paid collected its full total.
update public.invoice set collected_cents = total_cents where status = 'paid' and collected_cents = 0;

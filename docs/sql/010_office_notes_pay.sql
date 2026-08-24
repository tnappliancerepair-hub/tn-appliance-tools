-- 010_office_notes_pay.sql — office board tracking + pay. Run AFTER 004 in the ANT
-- Platforms project. Adds a running office-notes field on the job (MeisterTask-style
-- card notes) and a payment-method on the invoice (for the money record + statements).
-- The invoice + invoice_line tables already exist (004) with tenant RLS.

alter table public.job     add column if not exists office_notes text;
alter table public.invoice add column if not exists paid_method  text;   -- cash / card / check / zelle / …
alter table public.invoice add column if not exists number       text;   -- human invoice # (optional)

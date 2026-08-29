-- 029_invoice_tech_scope.sql — "a tech only sees his OWN commissions owed/paid."
-- Run in the ANT Platforms project. Idempotent.
--
-- tech_payout (the PAID side) is already tech-scoped (022). The OWED/earned side is
-- computed from invoice.labor_cents. invoice + invoice_line were company-wide readable
-- (004), so a curious tech could pull every invoice via the raw API and back into other
-- techs' pay. This makes READS role-aware:
--   • office / owner / manager / admin / csr  → all company invoices (office board, money,
--     remittance, reconcile — unchanged).
--   • a technician                            → ONLY invoices for jobs assigned to them.
--
-- ⚠️ RLS gotcha handled: multiple PERMISSIVE policies for the same command are OR'd, and a
-- FOR ALL policy also covers SELECT. So writes are split into FOR INSERT/UPDATE/DELETE
-- (company-scoped, identical to before — zero write blast radius) and SELECT is governed
-- SOLELY by the restrictive read policy. portal_get is SECURITY DEFINER (customer receipt
-- unaffected); the tech pay lens already filters to his own jobs, so it keeps working.

-- ── invoice ──────────────────────────────────────────────────────────────────
drop policy if exists invoice_tenant       on public.invoice;
drop policy if exists invoice_read         on public.invoice;
drop policy if exists invoice_ins          on public.invoice;
drop policy if exists invoice_upd          on public.invoice;
drop policy if exists invoice_del          on public.invoice;

create policy invoice_read on public.invoice for select using (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or exists (select 1 from public.job j
               where j.id = invoice.job_id and j.technician_id = public.current_technician_id())
  )
);
create policy invoice_ins on public.invoice for insert with check (company_id = public.current_company_id());
create policy invoice_upd on public.invoice for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy invoice_del on public.invoice for delete using (company_id = public.current_company_id());

-- ── invoice_line (scoped through its parent invoice's job) ────────────────────
drop policy if exists invoice_line_tenant  on public.invoice_line;
drop policy if exists invoice_line_read    on public.invoice_line;
drop policy if exists invoice_line_ins     on public.invoice_line;
drop policy if exists invoice_line_upd     on public.invoice_line;
drop policy if exists invoice_line_del     on public.invoice_line;

create policy invoice_line_read on public.invoice_line for select using (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or exists (select 1 from public.invoice iv
               join public.job j on j.id = iv.job_id
               where iv.id = invoice_line.invoice_id and j.technician_id = public.current_technician_id())
  )
);
create policy invoice_line_ins on public.invoice_line for insert with check (company_id = public.current_company_id());
create policy invoice_line_upd on public.invoice_line for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
create policy invoice_line_del on public.invoice_line for delete using (company_id = public.current_company_id());

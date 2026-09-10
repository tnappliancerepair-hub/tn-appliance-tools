-- 058_invoice_write_scope.sql — "a tech only BILLS his OWN job."
-- Run in the ANT Platforms project. Idempotent. NOT YET APPLIED — see the verification note.
--
-- 029 made invoice READS role-aware (a tech sees only invoices for jobs assigned to him) but
-- deliberately left WRITES company-scoped, for "zero write blast radius". The gap that leaves:
-- any signed-in tech can INSERT, blind-UPDATE (including total_cents, collected_cents, status
-- 'paid') or DELETE ANY invoice in his own shop — including one for a job he has nothing to do
-- with, and one he cannot even read. Never cross-tenant; entirely intra-shop.
--
-- The obvious gate (management roles only, mirroring 041) would BREAK A LIVE FLOW: platform/
-- tech-job.html genuinely bills from the field — it inserts/updates the invoice, rewrites
-- invoice_line, and marks it paid when the tech collects at the door. So writes are scoped the
-- same way 029 scoped reads instead: management as before, or the technician the job belongs to.
-- A tech keeps billing his own stop and loses the ability to touch anyone else's.
--
-- Server-side platform-* functions use the SERVICE key and bypass RLS, so office/remittance/
-- reconcile automation is unaffected. portal_get stays SECURITY DEFINER (customer receipt fine).
--
-- ⚠️ VERIFY BEFORE RUNNING: sign in as a real tech seat, open a job assigned to that tech, save
-- an invoice + a line + mark it paid. All three must still succeed. Then confirm the same tech
-- cannot update an invoice on another tech's job (expect zero rows affected, not an error —
-- an RLS-blocked UPDATE returns an empty result, not 42501).

-- ── invoice ──────────────────────────────────────────────────────────────────
drop policy if exists invoice_ins on public.invoice;
drop policy if exists invoice_upd on public.invoice;
drop policy if exists invoice_del on public.invoice;

create policy invoice_ins on public.invoice for insert with check (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or exists (select 1 from public.job j
               where j.id = invoice.job_id and j.technician_id = public.current_technician_id())
  )
);
create policy invoice_upd on public.invoice for update
  using (
    company_id = public.current_company_id()
    and (
      public.current_app_role() in ('owner','office','manager','admin','csr')
      or exists (select 1 from public.job j
                 where j.id = invoice.job_id and j.technician_id = public.current_technician_id())
    )
  )
  with check (
    company_id = public.current_company_id()
    and (
      public.current_app_role() in ('owner','office','manager','admin','csr')
      or exists (select 1 from public.job j
                 where j.id = invoice.job_id and j.technician_id = public.current_technician_id())
    )
  );
create policy invoice_del on public.invoice for delete using (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or exists (select 1 from public.job j
               where j.id = invoice.job_id and j.technician_id = public.current_technician_id())
  )
);

-- ── invoice_line (scoped through its parent invoice's job, exactly like 029's read) ──────────
drop policy if exists invoice_line_ins on public.invoice_line;
drop policy if exists invoice_line_upd on public.invoice_line;
drop policy if exists invoice_line_del on public.invoice_line;

create policy invoice_line_ins on public.invoice_line for insert with check (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or exists (select 1 from public.invoice iv
               join public.job j on j.id = iv.job_id
               where iv.id = invoice_line.invoice_id and j.technician_id = public.current_technician_id())
  )
);
create policy invoice_line_upd on public.invoice_line for update
  using (
    company_id = public.current_company_id()
    and (
      public.current_app_role() in ('owner','office','manager','admin','csr')
      or exists (select 1 from public.invoice iv
                 join public.job j on j.id = iv.job_id
                 where iv.id = invoice_line.invoice_id and j.technician_id = public.current_technician_id())
    )
  )
  with check (
    company_id = public.current_company_id()
    and (
      public.current_app_role() in ('owner','office','manager','admin','csr')
      or exists (select 1 from public.invoice iv
                 join public.job j on j.id = iv.job_id
                 where iv.id = invoice_line.invoice_id and j.technician_id = public.current_technician_id())
    )
  );
create policy invoice_line_del on public.invoice_line for delete using (
  company_id = public.current_company_id()
  and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or exists (select 1 from public.invoice iv
               join public.job j on j.id = iv.job_id
               where iv.id = invoice_line.invoice_id and j.technician_id = public.current_technician_id())
  )
);

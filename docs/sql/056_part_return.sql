-- 056_part_return.sql — the parts-RETURN close-loop (Xano→platform parity: "the chargeback killer").
-- A job_part with disposition='return' is "owed back to the distributor", but until now it had NO
-- terminal state — a part shipped back stayed flagged forever, so the office had no worklist that
-- clears. This adds the "shipped it" close-loop + homes for the SquareTrade RMA lane (phase-2).
--
--   returned_at     : NULL = still owed back (shows on the returns worklist) ; set = shipped/closed (drops off)
--   returned_by     : who closed it ('tech:<name>' / 'office:<name>') — fairness record
--   rma_number      : the SquareTrade/Allstate RMA # (phase-2 email-tee fills this)
--   return_tracking : FedEx/carrier tracking # of the return label (phase-2)
--   return_carrier  : the return carrier (FedEx/UPS…) (phase-2)
--
-- RLS is unchanged — job_part_tenant already scopes every row to the shop (any in-company
-- tech OR office can read/write; the parts-migrate/tee service key bypasses).
--
-- Apply live via: sb-admin-sql?project=platform (Supabase Management API).

alter table public.job_part add column if not exists returned_at     timestamptz;
alter table public.job_part add column if not exists returned_by     text;
alter table public.job_part add column if not exists rma_number      text;
alter table public.job_part add column if not exists return_tracking text;
alter table public.job_part add column if not exists return_carrier  text;

-- The returns worklist reads disposition='return' AND returned_at IS NULL across a company;
-- index the hot filter so the office page stays fast as parts history grows.
create index if not exists job_part_returns_idx
  on public.job_part (company_id, disposition, returned_at);

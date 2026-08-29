-- 030_technician_pay_privacy.sql — finish "a tech only sees his own pay." Run in ANT
-- Platforms. Idempotent.
--
-- technician was company-wide readable (004), so a tech could read every teammate's
-- commission_pct/flat via the raw API, AND (FOR ALL write) could even set his OWN pay rate.
-- Fix:
--   • company_roster()  — a names-only roster (id,name,active, NO commission) for the tech
--     leaderboard + hand-off dropdowns. SECURITY DEFINER so it returns all teammates' names
--     without exposing the table.
--   • technician SELECT — office/owner/manager/admin/csr see all rows (incl commission, for
--     the owner's pay settings); a technician sees ONLY his own row.
--   • technician WRITE  — office roles only. A tech can never edit technician rows, so he
--     can't set his own commission. (Onboarding + owner pay-settings run as owner: unchanged.)
-- RLS gotcha handled: writes are split into FOR INSERT/UPDATE/DELETE so they don't reopen
-- SELECT (permissive policies are OR'd; a FOR ALL policy also covers SELECT).

create or replace function public.company_roster()
returns table(id uuid, name text, active boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.active
  from public.technician t
  where t.company_id = public.current_company_id()
  order by t.name
$$;
revoke all on function public.company_roster() from public;
grant execute on function public.company_roster() to authenticated;

drop policy if exists technician_tenant on public.technician;
drop policy if exists technician_read   on public.technician;
drop policy if exists technician_ins    on public.technician;
drop policy if exists technician_upd    on public.technician;
drop policy if exists technician_del    on public.technician;

create policy technician_read on public.technician for select using (
  company_id = public.current_company_id() and (
    public.current_app_role() in ('owner','office','manager','admin','csr')
    or id = public.current_technician_id()
  )
);
create policy technician_ins on public.technician for insert with check (
  company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin')
);
create policy technician_upd on public.technician for update
  using      (company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin'))
  with check (company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin'));
create policy technician_del on public.technician for delete using (
  company_id = public.current_company_id() and public.current_app_role() in ('owner','office','manager','admin')
);

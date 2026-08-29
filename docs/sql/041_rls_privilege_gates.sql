-- 041_rls_privilege_gates.sql — RLS hardening (2026-08-29 security audit). Cross-tenant isolation
-- was already solid (every table scopes to current_company_id()); this closes INTRA-tenant
-- privilege escalation: any signed-in app_user (incl. a TECH) could write app_user + company +
-- company_credential rows for their own shop. A tech could therefore UPDATE app_user.role='owner'
-- (self-promote) or rewrite company.settings (commission / parts margin / comms / payment config).
-- Fix = keep reads company-scoped, but gate WRITES to management roles, mirroring the technician
-- table's own policies. Run in ANT Platforms.

-- app_user: everyone in the shop may READ (the app resolves names/roles); only management may WRITE.
drop policy if exists app_user_tenant on public.app_user;
drop policy if exists app_user_read on public.app_user;
drop policy if exists app_user_ins  on public.app_user;
drop policy if exists app_user_upd  on public.app_user;
drop policy if exists app_user_del  on public.app_user;
create policy app_user_read on public.app_user for select
  using (company_id = public.current_company_id());
create policy app_user_ins on public.app_user for insert
  with check (company_id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']));
create policy app_user_upd on public.app_user for update
  using (company_id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']))
  with check (company_id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']));
create policy app_user_del on public.app_user for delete
  using (company_id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']));

-- company: everyone in the shop may READ their company row; only management may UPDATE settings.
-- (Company creation is server-side via create_company_with_owner / provision — no client insert;
--  a client never deletes a company — so no insert/delete policy = denied.)
drop policy if exists company_self on public.company;
drop policy if exists company_read on public.company;
drop policy if exists company_upd  on public.company;
create policy company_read on public.company for select
  using (id = public.current_company_id());
create policy company_upd on public.company for update
  using (id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']))
  with check (id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']));

-- company_credential (insurance docs / policy numbers): management only, both read + write.
drop policy if exists company_credential_tenant on public.company_credential;
drop policy if exists company_credential_mgmt   on public.company_credential;
create policy company_credential_mgmt on public.company_credential for all
  using (company_id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']))
  with check (company_id = public.current_company_id() and public.current_app_role() = any (array['owner','office','manager','admin']));

-- Hardening: TRUNCATE bypasses row-level security entirely and no client ever needs it.
revoke truncate on all tables in schema public from authenticated;

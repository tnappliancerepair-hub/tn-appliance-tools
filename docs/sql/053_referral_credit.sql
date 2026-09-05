-- 053_referral_credit.sql — customer bill-credit referral ("The Ant Army").
-- A referring CUSTOMER is a partner row distinguished by partner.company_id (their own shop):
-- company_id SET = a customer bill-credit referrer; NULL = a cash reseller (e.g. TK). All the
-- credit logic branches on company_id. Adds the two columns Phase 1/2 need; stripe_coupon_id is
-- the Stripe coupon we manage in Phase 2. Same service-role-only posture as 047_partner_referral.sql
-- (RLS deny-all to every browser client; the platform server uses the service key which bypasses
-- RLS). Run: sb-admin-sql ?project=platform (ANT Platforms). Idempotent.

alter table public.partner add column if not exists company_id uuid references public.company(id) on delete cascade;
alter table public.partner add column if not exists stripe_coupon_id text;
create index if not exists partner_company_id_idx on public.partner (company_id);

-- RLS + grants are already established in 047 (deny-all to anon/authenticated, all to service_role);
-- re-assert the service grant so a fresh apply is self-contained.
grant all on public.partner to service_role;

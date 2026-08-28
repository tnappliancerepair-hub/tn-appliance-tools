-- 024_billing.sql — SaaS billing linkage on `company`. This is OUR billing relationship
-- WITH the shop (platform subscription revenue) — entirely separate from the shop's own
-- customer money, which the platform never touches. A paid Stripe subscription drives
-- company.plan / company.status / company.features automatically via platform-stripe-webhook.
-- Run: sb-admin-sql ?project=platform. Idempotent.
alter table public.company add column if not exists stripe_customer_id     text;
alter table public.company add column if not exists stripe_subscription_id text;
alter table public.company add column if not exists billing_status         text;   -- stripe sub status: trialing|active|past_due|canceled|incomplete
alter table public.company add column if not exists trial_ends_at          timestamptz;
alter table public.company add column if not exists current_period_end     timestamptz;
alter table public.company add column if not exists billing_email          text;

-- Fast lookups from the webhook (Stripe hands us the customer/subscription id, we map back to the company).
create index if not exists company_stripe_customer_idx     on public.company (stripe_customer_id);
create index if not exists company_stripe_subscription_idx on public.company (stripe_subscription_id);

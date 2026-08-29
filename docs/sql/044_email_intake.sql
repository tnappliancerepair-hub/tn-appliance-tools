-- 044_email_intake.sql — multi-tenant warranty-email intake.
--
-- A warranty company (AHS/ServicePower/SquareTrade/Frontdoor/…) EMAILS a dispatch to the
-- shop. The shop auto-forwards those to  <slug>@jobs.assistant247.net . A Cloudflare Email
-- Worker parses the message and POSTs it to platform-email-intake, which resolves the shop
-- by the address, extracts the job (known-vendor parsers + a Claude fallback for any format),
-- and lands it on that shop's board — RLS-scoped, deduped by claim #.
--
-- This migration adds:
--   1. a per-email audit + idempotency ledger (email_intake) the owner can see, and
--   2. two job columns the warranty dispatch carries that the platform job lacked.
-- Apply in the "platform" (ANT Platforms) Supabase project.

-- ── job: the two dispatch specifics not already present (warranty_company + claim_number
--    were added in 033). Brand/model/serial go on unit.attributes; appliance on unit.kind/label.
alter table public.job add column if not exists dispatch_id    text;
alter table public.job add column if not exists service_window text;

-- ── the email-intake ledger: one row per inbound dispatch email.
--    Doubles as the idempotency guard (unique message per shop) AND the owner's
--    "📥 Emailed jobs" feed (what came in, how it parsed, which job it became).
create table if not exists public.email_intake (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  message_id    text,                         -- the email's Message-ID (idempotency key)
  to_addr       text,                         -- <slug>@jobs.assistant247.net
  from_addr     text,
  subject       text,
  vendor        text,                         -- ahs | servicepower | squaretrade | frontdoor | unknown
  method        text,                         -- how we parsed: 'ahs_xml' | 'servicepower' | 'claude' | 'none'
  confidence    text,                         -- high | medium | low  (for the Claude fallback)
  email_type    text,                         -- dispatch | status | payment | not_a_job | ...
  claim_number  text,
  job_id        uuid references public.job(id) on delete set null,
  status        text not null default 'received', -- received | created | deduped | skipped | unparsed | error
  detail        text,                         -- short human note (error msg / why skipped)
  raw_excerpt   text,                         -- first ~2k chars, for the owner to eyeball / debug
  created_at    timestamptz not null default now()
);

-- idempotency: the same email (per shop) is processed once.
create unique index if not exists email_intake_msg_uidx
  on public.email_intake (company_id, message_id) where message_id is not null;
create index if not exists email_intake_company_created_idx
  on public.email_intake (company_id, created_at desc);

-- RLS: the owner/office can READ their own shop's intake feed; nobody writes it from a
-- browser (the service key does, server-side). Mirrors the tenant read pattern in 004.
alter table public.email_intake enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_intake' and policyname='email_intake_select') then
    create policy email_intake_select on public.email_intake
      for select using (company_id = public.current_company_id());
  end if;
end $$;

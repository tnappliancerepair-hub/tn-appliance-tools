-- 011_tenant_integration — per-tenant vendor-credential store (Model A / BYOC), ANT Platforms.
-- Each shop connects its OWN AHS/ServicePower/Marcone/NSA accounts; Ant runs the automations
-- on their accounts (their money, never commingled). Credentials are stored ONLY as
-- AES-256-GCM ciphertext; the key lives in OUR vault (INTEGRATION_ENC_KEY, or derived from
-- VAPI_ADMIN_SECRET), never in this DB — a DB dump reveals nothing usable.
--
-- SECURITY POSTURE: the browser NEVER queries this table. All access is via the service-key
-- function platform-integrations.js (Bearer -> company_id + role gate). Direct access from the
-- tenant roles is fully revoked; RLS stays ON as belt-and-suspenders. service_role (the
-- function) keeps full access.

create table if not exists public.tenant_integration (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  vendor       text not null,           -- servicepower|ahs|frontdoor|marcone|nsa|amazon|...
  label        text,
  secret_enc   text,                    -- base64 AES-256-GCM ciphertext of the cred JSON
  enc_v        text,                    -- key derivation used (ded|kdf1) — for rotation
  meta         jsonb not null default '{}'::jsonb,   -- NON-secret display fields only
  status       text not null default 'connected',    -- connected|stored|error|disconnected
  verified_at  timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, vendor)
);
alter table public.tenant_integration enable row level security;
drop policy if exists ti_tenant_all on public.tenant_integration;
create policy ti_tenant_all on public.tenant_integration
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

-- Full lockdown: the service-key function is the ONLY access path. (Supabase grants table-wide
-- SELECT to the tenant roles by default, which would override a column-level revoke — so revoke
-- everything from them instead.)
revoke all on public.tenant_integration from anon, authenticated;
create index if not exists tenant_integration_co_idx on public.tenant_integration (company_id);

-- OPTIONAL HARDENING (recommended): add INTEGRATION_ENC_KEY (32-byte hex) to the vault so the
-- credential encryption uses a dedicated key instead of one derived from VAPI_ADMIN_SECRET.
-- Rows are tagged with enc_v so a future re-key migration is safe.

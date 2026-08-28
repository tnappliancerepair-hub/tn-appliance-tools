-- 012_tenant_keyring — envelope encryption for the per-tenant vendor-credential store.
-- Each shop has its OWN Data Encryption Key (DEK) that encrypts all of that shop's
-- credentials (tenant_integration.secret_enc, enc_v='dek1'). The DEK is stored here only
-- WRAPPED (encrypted) by a vault master key (KEK) — so this DB never holds a usable key.
-- Unwrapping a DEK requires the KEK, which lives in OUR vault (INTEGRATION_ENC_KEY, else
-- derived from ADMIN_SECRET), not here. Blast radius of any single leak = ONE shop, and each
-- shop's key can be rotated independently. Legacy blobs (enc_v kdf1/ded, encrypted directly
-- with the master key) still decrypt for back-compat.
create table if not exists public.tenant_keyring (
  company_id  uuid primary key,
  wrapped_dek text not null,        -- base64 KEK-wrapped DEK (AES-256-GCM)
  kek_v       text not null,        -- which KEK wrapped it (ded|kdf1) — for KEK rotation
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);
alter table public.tenant_keyring enable row level security;
-- the service-key function (tenant-creds.js) is the ONLY access path
revoke all on public.tenant_keyring from anon, authenticated;

-- 026_credentials.sql — Credentials & Insurance vault (platform module). Run in ANT Platforms.
--
-- Each shop stores its COI (general liability / workers' comp / auto), business license,
-- W-9, and certs here. Files live in R2 (keyed <company_id>/credentials/...); this table is
-- the index + expiry tracker. RLS scopes every row to the shop. A PUBLIC summary function
-- powers the shareable "Licensed & Insured ✓" verify page (summary only — never the files,
-- never policy numbers). Idempotent.

create table if not exists public.company_credential (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete cascade,
  kind          text not null,   -- coi_gl | coi_wc | coi_auto | license | w9 | cert | other
  label         text,            -- free-text ("Hiscox GL", "TN contractor license")
  storage_path  text,            -- R2 key: <company_id>/credentials/<uuid>__<file>
  file_name     text,
  issued_on     date,
  expires_on    date,            -- null = no expiry (e.g. W-9)
  policy_number text,            -- NEVER exposed publicly
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists company_credential_company_idx on public.company_credential (company_id);

alter table public.company_credential enable row level security;
drop policy if exists company_credential_tenant on public.company_credential;
create policy company_credential_tenant on public.company_credential
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.company_credential to authenticated;

-- ── credentials_summary(slug) — PUBLIC (anon) proof-of-insurance summary for the verify page.
-- Returns ONLY: what the shop carries, its label, expiry, and whether it's current. NEVER the
-- file, the storage path, or the policy number. Safe to share — it's marketing ("we're insured").
create or replace function public.credentials_summary(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare co record;
begin
  select id, name into co from public.company where slug = lower(trim(p_slug)) limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  return jsonb_build_object(
    'ok', true,
    'shop', co.name,
    'credentials', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', k.kind,
        'label', k.label,
        'expires_on', k.expires_on,
        'current', (k.expires_on is null or k.expires_on >= current_date)
      ) order by k.kind), '[]'::jsonb)
      from public.company_credential k where k.company_id = co.id)
  );
end $$;
grant execute on function public.credentials_summary(text) to anon, authenticated;

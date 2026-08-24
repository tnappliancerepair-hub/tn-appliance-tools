-- 007_intake.sql — the customer INTAKE bundle on the platform. Run AFTER 004/005 in the
-- ANT Platforms project. This is TN's proven intake magic, multi-tenant: Ann captures a
-- lead → texts the customer a link → they give availability + a video + model photos +
-- sign the release of liability → it all lands on the job.
--
-- Media hosting: VIDEO on Cloudflare Stream (weak-signal-proof, TN's account); PHOTOS in a
-- Supabase Storage bucket. Refs are recorded in job_media; the intake page writes through
-- the SERVER (platform-intake, service key), never directly, so anon never touches the DB.

-- intake fields on the job
alter table public.job add column if not exists availability     text;
alter table public.job add column if not exists access_notes     text;         -- gate codes, pets, park-in-rear…
alter table public.job add column if not exists waiver_signed_at  timestamptz;
alter table public.job add column if not exists waiver_name       text;
alter table public.job add column if not exists intake_done_at    timestamptz;  -- customer finished the bundle

-- media attached to a job (video / photo). Trade-agnostic; provider tells us where it lives.
create table if not exists public.job_media (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  job_id      uuid not null references public.job(id) on delete cascade,
  kind        text not null default 'photo' check (kind in ('video','photo')),
  provider    text not null default 'storage',       -- 'cfstream' (Cloudflare uid) | 'storage' (Supabase path)
  ref         text not null,                          -- the uid or the storage path
  label       text,                                   -- 'Problem video', 'Model sticker'
  created_at  timestamptz not null default now()
);
create index if not exists job_media_job_idx on public.job_media (job_id);

-- staff see their own tenant's media (RLS); the intake page writes via the service key
alter table public.job_media enable row level security;
drop policy if exists job_media_tenant on public.job_media;
create policy job_media_tenant on public.job_media
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.job_media to authenticated;

-- Supabase Storage bucket for intake photos (public read = model-sticker photos, not
-- sensitive; uploads go through the service key). The board/tech read photos by public URL.
insert into storage.buckets (id, name, public)
  values ('intake-photos', 'intake-photos', true)
  on conflict (id) do nothing;

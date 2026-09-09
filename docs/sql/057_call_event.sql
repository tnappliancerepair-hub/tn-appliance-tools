-- 057_call_event.sql — the platform's own call log (Supabase / multi-tenant).
--
-- Teddy 2026-09-09: "We need inbound and outbound calls on Supabase platform please."
-- platform-voice bridges both directions; this is where the record of each call lands so a
-- shop can answer the one question that actually matters about a phone system: are we
-- catching the calls, and who caught them? (The Xano side learned this the hard way — 100
-- calls in 24h, 22 asking for a human, and nobody could tell whether a human ever picked up.)
--
-- Written SERVER-SIDE ONLY by platform-voice with the service key (a Telnyx webhook has no
-- session), so the client policy below is read-only. Nothing here is on the live-call path:
-- the row is written from the Dial action webhook AFTER the call, so a slow insert can never
-- become dead air for a caller.
create table if not exists public.call_event (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete cascade,
  direction    text not null check (direction in ('in','out')),
  outcome      text not null check (outcome in ('answered','missed','failed','placed')),
  caller       text,            -- the outside party, E.164
  seat_phone   text,            -- which of our people the leg went to, E.164
  seat_id      uuid references public.app_user(id) on delete set null,
  job_id       uuid references public.job(id) on delete set null,
  call_sid     text,            -- Telnyx CallSid, so a row can be traced back to the carrier
  at           timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- "How did the phones do this week" is the only question asked of this table.
create index if not exists call_event_company_at_idx on public.call_event (company_id, at desc);
create index if not exists call_event_job_idx on public.call_event (job_id) where job_id is not null;

alter table public.call_event enable row level security;

-- Tenant-scoped READ so a shop can see its own call history in the app.
drop policy if exists call_event_tenant_read on public.call_event;
create policy call_event_tenant_read on public.call_event
  for select using (company_id = current_company_id());

-- No client insert/update/delete on purpose: every row is a carrier fact written by the
-- server. A seat being able to edit "who answered" would make the number worthless.

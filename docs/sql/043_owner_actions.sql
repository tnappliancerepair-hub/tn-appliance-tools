-- 043_owner_actions.sql
-- The reversible action ledger — the spine of the Ant owner/CSR partner.
-- Every change Ant (or a person) makes lands here as one row: what changed, the
-- value BEFORE, the value AFTER, when, by whom, and why. Every row can be undone
-- because it carries the exact before-state. This is what makes "act AND reverse"
-- safe enough to hand a partner real power.
--
-- Multi-tenant: RLS scopes reads to the caller's own company; writes are gated to
-- management (mirrors the company/technician gates from 041). The server intent
-- engine (platform-owner-action.js) writes with the service key and enforces the
-- same company + role gate in code; these policies protect any direct client read.

create table if not exists owner_action (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references company(id) on delete cascade,
  actor         text not null default 'owner',   -- who initiated: owner|office|manager|ant
  via           text not null default 'ui',      -- channel: ui|ant
  intent        text not null,                   -- e.g. set_parts_margin
  label         text not null,                   -- human sentence shown in the feed
  target_table  text,                            -- company|technician|tech_time_off
  target_id     uuid,                            -- affected row (when applicable)
  path          text,                            -- settings json path when applicable (e.g. settings.parts)
  op            text not null default 'update',  -- update|insert|delete (tells undo how to reverse)
  before_value  jsonb,
  after_value   jsonb,
  status        text not null default 'applied', -- applied|reversed
  reason        text,
  created_at    timestamptz not null default now(),
  reversed_at   timestamptz,
  reversed_by   text
);
create index if not exists owner_action_company_created_idx on owner_action (company_id, created_at desc);

alter table owner_action enable row level security;

-- staff of the shop read their own shop's action log
drop policy if exists owner_action_sel on owner_action;
create policy owner_action_sel on owner_action for select to authenticated
  using (company_id = current_company_id());

-- only management writes / closes actions
drop policy if exists owner_action_ins on owner_action;
create policy owner_action_ins on owner_action for insert to authenticated
  with check (company_id = current_company_id()
              and current_app_role() in ('owner','office','manager','admin'));

drop policy if exists owner_action_upd on owner_action;
create policy owner_action_upd on owner_action for update to authenticated
  using (company_id = current_company_id()
         and current_app_role() in ('owner','office','manager','admin'))
  with check (company_id = current_company_id());

-- one-call resolver for the app layer: who am I, which shop, which role, which tech?
create or replace function platform_whoami()
returns table(company_id uuid, role text, technician_id uuid)
language sql stable security definer set search_path = public as $$
  select current_company_id(), current_app_role(), current_technician_id()
$$;
grant execute on function platform_whoami() to authenticated;

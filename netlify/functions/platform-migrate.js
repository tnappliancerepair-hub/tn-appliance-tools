// platform-migrate — admin-gated, allow-listed schema migrations for the ANT Platforms
// Supabase project. NOT an arbitrary SQL runner: it only executes the named, idempotent
// (IF NOT EXISTS) statements defined in MIGRATIONS below, via the Supabase Management API
// (same mechanism + SUPABASE_MGMT_TOKEN as platform-ops.js). This is how office-board /
// platform schema tweaks get applied without hand-running SQL in the dashboard.
//
//   GET ?secret=<admin>&do=<name>   -> runs that migration (idempotent; safe to re-run)
//   GET ?secret=<admin>             -> lists the available migration names
const { getSecret } = require('./_lib/secrets');

const MGMT = 'https://api.supabase.com/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function refFromUrl(u) { const m = String(u || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i); return m ? m[1] : ''; }
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Allow-listed, idempotent migrations. Add new ones here; each is safe to re-run.
const MIGRATIONS = {
  // The office board's per-job "which column" placement (mirrors the legacy office_stage).
  // Nullable + additive: existing jobs derive a default column until one is set here.
  board_stage: `alter table public.job add column if not exists board_stage text;`,

  // Widen the TDR outcome set to the office's full claim dispositions: the original three
  // (fixed / return_needed / not_fixable=replacement) plus second_opinion + no_failure (NFF).
  tdr_outcomes: `alter table public.job_tdr drop constraint if exists job_tdr_outcome_check;
                 alter table public.job_tdr add constraint job_tdr_outcome_check
                   check (outcome in ('fixed','return_needed','not_fixable','second_opinion','no_failure'));`,

  // Per-part fulfillment: where the part is COMING FROM (source — warranty co / warehouse /
  // Amazon / free text), the delivery ROUTE (distributor pickup vs shipped to the customer's
  // home), and the ETA. So the office (and Ann) can answer "when are my parts coming?".
  part_fulfillment: `alter table public.job_part add column if not exists source  text;
                     alter table public.job_part add column if not exists ship_to text;
                     alter table public.job_part add column if not exists eta     date;`,

  // Editable, per-shop TAGS (MeisterTask-style): a `tag` library each shop builds itself, and a
  // `job_tag` join so a job can carry several. Both RLS-scoped to the shop; any shop member
  // manages them (operational, like customer/job). Cards show the colorful chips.
  tags: `create table if not exists public.tag (
           id uuid primary key default gen_random_uuid(),
           company_id uuid not null references public.company(id) on delete cascade,
           label text not null,
           color text,
           created_at timestamptz not null default now()
         );
         create index if not exists tag_company_idx on public.tag (company_id);
         alter table public.tag enable row level security;
         drop policy if exists tag_tenant on public.tag;
         create policy tag_tenant on public.tag
           using (company_id = public.current_company_id())
           with check (company_id = public.current_company_id());
         grant select, insert, update, delete on public.tag to authenticated;
         create table if not exists public.job_tag (
           id uuid primary key default gen_random_uuid(),
           company_id uuid not null references public.company(id) on delete cascade,
           job_id uuid not null references public.job(id) on delete cascade,
           tag_id uuid not null references public.tag(id) on delete cascade,
           created_at timestamptz not null default now(),
           unique (job_id, tag_id)
         );
         create index if not exists job_tag_job_idx on public.job_tag (job_id);
         create index if not exists job_tag_company_idx on public.job_tag (company_id);
         alter table public.job_tag enable row level security;
         drop policy if exists job_tag_tenant on public.job_tag;
         create policy job_tag_tenant on public.job_tag
           using (company_id = public.current_company_id())
           with check (company_id = public.current_company_id());
         grant select, insert, update, delete on public.job_tag to authenticated;`,

  // Invoice worksheet upgrade: shipping & handling, tips (100% to the tech, not taxed), the
  // office-adjustable tech pay, and the parts cost (for the margin readout). All editable.
  invoice_extras: `alter table public.invoice add column if not exists shipping_cents  integer not null default 0;
                   alter table public.invoice add column if not exists tip_cents       integer not null default 0;
                   alter table public.invoice add column if not exists tech_pay_cents   integer;
                   alter table public.invoice add column if not exists parts_cost_cents integer;`,

  // Teach the call resolver to surface the best PART's source + route + ETA (from job_part), so
  // Ann can answer "when are my parts coming?" with "shipping from American Home Shield, ETA …".
  // CREATE OR REPLACE the same SECURITY DEFINER resolver, adding part_source/part_ship_to/part_eta.
  call_brain_parts: `create or replace function public.platform_call_lookup(
      p_company_id uuid, p_phone text default null, p_claim text default null, p_name text default null
    ) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
    declare
      v_last10  text := right(regexp_replace(coalesce(p_phone,''), '\\D', '', 'g'), 10);
      v_claim   text := regexp_replace(coalesce(p_claim,''), '\\s', '', 'g');
      v_cust_id uuid; v_first text; v_last text; v_phone text;
      v_job_id  uuid; v_matched text; v_count int := 0; v_job jsonb;
      v_p_source text; v_p_ship text; v_p_eta date;
    begin
      if length(v_last10) >= 7 then
        select c.id, c.first_name, c.last_name, c.phone into v_cust_id, v_first, v_last, v_phone
          from customer c where c.company_id = p_company_id
            and right(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g'), 10) = v_last10
          order by c.id limit 1;
        if v_cust_id is not null then v_matched := 'phone'; end if;
      end if;
      if v_cust_id is null and v_claim <> '' then
        select j.customer_id, j.id into v_cust_id, v_job_id from job j
          where j.company_id = p_company_id
            and regexp_replace(coalesce(j.claim_number,''), '\\s', '', 'g') = v_claim
          order by j.created_at desc limit 1;
        if v_cust_id is not null then
          select c.first_name, c.last_name, c.phone into v_first, v_last, v_phone from customer c where c.id = v_cust_id;
          v_matched := 'claim';
        end if;
      end if;
      if v_cust_id is null and btrim(coalesce(p_name,'')) <> '' then
        select c.id, c.first_name, c.last_name, c.phone into v_cust_id, v_first, v_last, v_phone
          from customer c where c.company_id = p_company_id
            and lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) like '%' || lower(btrim(p_name)) || '%'
          order by c.id limit 1;
        if v_cust_id is not null then v_matched := 'name'; end if;
      end if;
      if v_cust_id is null then
        return jsonb_build_object('ok', true, 'found', false, 'matched_by', null);
      end if;
      if v_job_id is null then
        select j.id into v_job_id from job j
          where j.company_id = p_company_id and j.customer_id = v_cust_id
          order by (case when j.status not in ('completed','canceled') then 0 else 1 end), j.created_at desc
          limit 1;
      end if;
      select count(*) into v_count from job j where j.company_id = p_company_id and j.customer_id = v_cust_id;
      if v_job_id is not null then
        -- best part to speak about: prefer one with an ETA (soonest), else the newest logged.
        select jp.source, jp.ship_to, jp.eta into v_p_source, v_p_ship, v_p_eta
          from job_part jp where jp.job_id = v_job_id
          order by (jp.eta is null), jp.eta asc, jp.created_at desc limit 1;
        select jsonb_build_object(
          'id', j.id, 'status', j.status, 'problem', j.problem,
          'scheduled_day', j.scheduled_day, 'scheduled_start', j.scheduled_start,
          'en_route_at', j.en_route_at, 'started_at', j.started_at, 'completed_at', j.completed_at,
          'tech_first', (select split_part(coalesce(t.name,''), ' ', 1) from technician t where t.id = j.technician_id),
          'unit_label', (select u.label from unit u where u.id = j.unit_id),
          'warranty_company', j.warranty_company, 'claim_number', j.claim_number,
          'dispatch_id', j.dispatch_id, 'service_window', j.service_window,
          'parts_status', j.parts_status, 'parts_eta', j.parts_eta,
          'part_source', v_p_source, 'part_ship_to', v_p_ship, 'part_eta', v_p_eta
        ) into v_job from job j where j.id = v_job_id;
      end if;
      return jsonb_build_object('ok', true, 'found', true, 'matched_by', v_matched,
        'customer', jsonb_build_object('id', v_cust_id, 'first_name', v_first, 'last_name', v_last, 'phone', v_phone),
        'job_count', v_count, 'job', v_job);
    end $fn$;`,
};

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const names = Object.keys(MIGRATIONS);
  const name = q.do || '';
  if (!name) return json(200, { ok: true, migrations: names });
  if (!MIGRATIONS[name]) return json(200, { ok: false, error: 'unknown migration', migrations: names });

  const token = await getSecret('SUPABASE_MGMT_TOKEN');
  if (!token) return json(200, { ok: false, error: 'SUPABASE_MGMT_TOKEN not vaulted' });
  const ref = refFromUrl(await getSecret('PLATFORM_SUPABASE_URL')) || 'tntbhfwitytkcoqlejwc';

  try {
    const r = await fetch(`${MGMT}/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MIGRATIONS[name] }), signal: AbortSignal.timeout(24000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json(200, { ok: false, error: 'query ' + r.status + ' ' + JSON.stringify(d).slice(0, 300) });
    return json(200, { ok: true, applied: name, sql: MIGRATIONS[name], result: d });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};

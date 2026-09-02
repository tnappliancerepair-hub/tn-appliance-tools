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

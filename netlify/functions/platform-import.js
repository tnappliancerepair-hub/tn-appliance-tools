// platform-import — the data-migration engine behind the "Bring your data over" wizard
// (platform/import.html). Operator/admin-gated. Reads a shop's OLD system (Housecall Pro
// today) and lands customers, jobs, techs + invoices onto their board — idempotently, so a
// re-run never double-creates. Resumable (Netlify's 26s cap) via a cursor on import_run.
//
//   ?do=probe    {source,key?,company}                 auth + true source totals (no writes)
//   ?do=preview  {source,key?,company}                 sample bundle + counts, opens an import_run
//   ?do=commit   {source,key?,company,run}             land ~a few pages; call until done=true
//   ?do=status   {run}                                  read an import_run
//
// Gate: ?secret=<admin>  OR  operator Supabase JWT (Bearer). `key` = the shop's HCP API key
// (pasted in the wizard); omit it to fall back to the vaulted HCP_API_KEY for a demo. The raw
// key is NEVER stored — only its last 4 (key_hint).
'use strict';
const { getSecret } = require('./_lib/secrets');
const { platform, cfg } = require('./_lib/platform-rest');
const land = require('./_lib/import/land');
const hcp = require('./_lib/import/hcp-adapter');
const jobber = require('./_lib/import/jobber-adapter');
const workiz = require('./_lib/import/workiz-adapter');
const xano = require('./_lib/import/xano-adapter');

const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
const OPERATOR_EMAILS = ['tnappliancerepair@gmail.com'];
const ADAPTERS = { housecallpro: hcp, jobber, workiz, xano };
const KEYLESS = { xano: true }; // TN's own system reads a vaulted token, no pasted key
// each adapter declares its own PHASES (FK order) + START cursor; commit iterates them generically.
const PAGES_PER_COMMIT = 3;              // bounded per call so we stay under the 26s cap

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function operatorFromJWT(event) {
  const h = event.headers || {};
  const m = String(h.authorization || h.Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return OPERATOR_EMAILS.includes(String((u && u.email) || '').toLowerCase()) ? String(u.email).toLowerCase() : null;
  } catch (_) { return null; }
}

// Self-serve OWNER auth: verify a shop owner/office user's Supabase session JWT and return
// THEIR OWN company_id. This is what makes import owner-self-serve — a real customer imports
// their own book with just their shop login, no operator key. Security: they can only ever
// resolve to their own company (the handler forces the import target to this id), so an owner
// can never import onto another shop's board.
async function ownerCompanyFromToken(pf, token) {
  token = String(token || '').trim();
  if (!token) return null;
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + token, apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    if (!u || !u.id) return null;
    const rows = await pf.get(`app_user?auth_user_id=eq.${encodeURIComponent(u.id)}&role=in.(owner,office)&select=company_id&limit=1`);
    return (rows && rows[0] && rows[0].company_id) || null;
  } catch (_) { return null; }
}

async function resolveCompany(pf, ref) {
  ref = String(ref || '').trim();
  if (!ref) return null;
  const isUuid = /^[0-9a-f-]{36}$/i.test(ref);
  const rows = await pf.get(isUuid ? `company?id=eq.${ref}&select=id,name,slug&limit=1` : `company?slug=eq.${encodeURIComponent(ref)}&select=id,name,slug&limit=1`);
  return (rows && rows[0]) || null;
}

// low-level import_run read/write via service key
async function runGet(pf, id) { const r = await pf.get(`import_run?id=eq.${id}&select=*&limit=1`); return (r && r[0]) || null; }
async function runInsert(row) {
  const { url, key } = await cfg();
  const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/import_run`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) });
  const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.message) || 'run insert ' + r.status); return Array.isArray(d) ? d[0] : d;
}
async function runPatch(id, patch) {
  const { url, key } = await cfg();
  const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/import_run?id=eq.${id}`, { method: 'PATCH', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.message) || 'run patch ' + r.status); return Array.isArray(d) ? d[0] : d;
}

const money = (c) => '$' + (Math.round((c || 0) / 100)).toLocaleString();

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const body = (() => { try { return JSON.parse(event.body || '{}'); } catch (_) { return {}; } })();
  const p = { ...q, ...body };

  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const pf = await platform();
  if (!pf) return json(200, { ok: false, error: 'platform not configured' });

  // Auth: (a) operator — admin secret or an operator email's JWT (can import onto ANY shop);
  //       (b) self-serve OWNER — the owner's own session token, from the Authorization header
  //           OR the JSON body (access_token). An owner can ONLY import onto their own shop.
  const isAdmin = p.secret === guard || !!(await operatorFromJWT(event));
  let ownerCompanyId = null;
  if (!isAdmin) {
    const bearer = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '');
    const tok = String(p.access_token || '').trim() || bearer;
    ownerCompanyId = await ownerCompanyFromToken(pf, tok);
  }
  if (!isAdmin && !ownerCompanyId) return { statusCode: 403, body: 'forbidden' };
  // Force a self-serve owner's import onto THEIR OWN shop — ignore any slug/id passed from the client.
  if (!isAdmin && ownerCompanyId) p.company = ownerCompanyId;

  const source = String(p.source || 'housecallpro').toLowerCase();
  const adapter = ADAPTERS[source];
  if (!adapter) return json(400, { ok: false, error: 'unsupported source: ' + source + ' (housecallpro | jobber | workiz | xano)' });
  let key = String(p.key || '').trim();
  if (!key && source === 'housecallpro') key = (await getSecret('HCP_API_KEY')) || ''; // demo fallback for HCP only
  const do_ = String(p.do || 'probe');

  // ---- STATUS ----
  if (do_ === 'status') {
    const run = await runGet(pf, String(p.run || ''));
    if (!run) return json(404, { ok: false, error: 'run not found' });
    return json(200, { ok: true, run });
  }

  if (!key && !KEYLESS[source]) return json(200, { ok: false, error: 'no API key — paste the shop’s key' });
  const key_hint = KEYLESS[source] ? 'vault' : key.slice(-4);

  // ---- PROBE ----
  if (do_ === 'probe') {
    const totals = await adapter.probe(key);
    const ok = Object.values(totals).every((t) => t.ok);
    return json(200, { ok, source, key_hint, totals });
  }

  const company = await resolveCompany(pf, p.company);
  if (!company) return json(400, { ok: false, error: 'unknown company (pass ?company=slug or uuid)' });

  // ---- PREVIEW ----  true totals + a small normalized sample; opens an import_run.
  if (do_ === 'preview') {
    const totals = await adapter.probe(key);
    if (!Object.values(totals).every((t) => t.ok)) return json(200, { ok: false, error: 'could not read the source — check the API key', totals });

    // sample page 1 of each kind for the eyeball screen
    const sample = { customers: [], jobs: [] };
    let money_cents = 0, paid_cents = 0;
    const cust1 = await adapter.page(key, 'customers', adapter.START);
    sample.customers = cust1.records.slice(0, 6).map((r) => ({ name: [r.row.first_name, r.row.last_name].filter(Boolean).join(' ') || '(no name)', phone: r.row.phone, city: r.row.city, state: r.row.state }));
    const job1 = await adapter.page(key, 'jobs', adapter.START);
    sample.jobs = job1.records.slice(0, 6).map((r) => ({ status: r.row.status, problem: (r.row.problem || '').slice(0, 60), day: r.row.scheduled_day, total: r.invoice ? money(r.invoice.total_cents) : '—' }));
    for (const r of job1.records) { if (r.invoice) { money_cents += r.invoice.total_cents; if (r.invoice.paid) paid_cents += r.invoice.total_cents; } }

    const est = {
      // optional-chain: some sources (e.g. Workiz) return no `technicians` key in probe — don't crash preview.
      technicians: totals.technicians?.total || 0,
      customers: totals.customers?.total || 0,
      jobs: totals.jobs?.total || 0,
      invoices_on_page1: job1.records.filter((r) => r.invoice).length,
      page1_billed: money(money_cents),
    };
    const limit = Math.max(0, parseInt(p.limit_pages, 10) || 0); // 0 = no cap (full migration)
    const run = await runInsert({
      company_id: company.id, source, status: 'preview', key_hint,
      totals: { technicians: est.technicians, customers: est.customers, jobs: est.jobs },
      cursor: { phase: adapter.PHASES[0].kind, cur: adapter.START, n: 0, limit },
      sample, note: limit ? ('capped at ' + limit + ' pages/kind') : null,
    });
    return json(200, { ok: true, run_id: run.id, company: { id: company.id, name: company.name, slug: company.slug }, source, key_hint, estimate: est, sample });
  }

  // ---- COMMIT ----  resumable: lands ~PAGES_PER_COMMIT pages of the current phase, advances the cursor.
  if (do_ === 'commit') {
    const run = await runGet(pf, String(p.run || ''));
    if (!run || run.company_id !== company.id) return json(400, { ok: false, error: 'run not found for this company — start with do=preview' });
    if (run.status === 'committed') return json(200, { ok: true, done: true, landed: run.landed, note: 'already complete' });

    const PHASES = adapter.PHASES;
    const cursor = run.cursor || { phase: PHASES[0].kind, cur: adapter.START, n: 0 };
    const landed = { technicians: 0, customers: 0, jobs: 0, invoices: 0, invoice_lines: 0, ...(run.landed || {}) };
    const skipped = { technicians: 0, customers: 0, jobs: 0, ...(run.skipped || {}) };

    let phaseIdx = Math.max(0, PHASES.findIndex((p) => p.kind === cursor.phase));
    let pagesDone = 0;
    try {
      while (pagesDone < PAGES_PER_COMMIT && phaseIdx < PHASES.length) {
        const ph = PHASES[phaseIdx];
        const pg = await adapter.page(key, ph.kind, cursor.cur);
        if (pg.status >= 400) return json(200, { ok: false, error: 'source error on ' + ph.kind + ' (http ' + pg.status + ')', run_id: run.id });

        if (pg.records.length) {
          if (ph.fk) {
            const res = await land.landJobs({ companyId: company.id, source, runId: run.id, records: pg.records });
            landed.jobs += res.landed; skipped.jobs += res.skipped; landed.invoices += res.invoices; landed.invoice_lines += res.invoice_lines;
          } else {
            const res = await land.landSimple(ph.mapKind, ph.table, { companyId: company.id, source, runId: run.id, records: pg.records });
            landed[ph.kind] = (landed[ph.kind] || 0) + res.landed; skipped[ph.kind] = (skipped[ph.kind] || 0) + res.skipped;
          }
          cursor.n = (cursor.n || 0) + 1;
          pagesDone++;
        }
        cursor.cur = pg.next;
        const capped = cursor.limit && cursor.n >= cursor.limit;
        if (!pg.next || !pg.records.length || capped) { phaseIdx++; cursor.phase = (PHASES[phaseIdx] && PHASES[phaseIdx].kind) || 'done'; cursor.cur = adapter.START; cursor.n = 0; }
      }
    } catch (e) {
      await runPatch(run.id, { status: 'failed', cursor, landed, skipped, note: String(e.message || e).slice(0, 300) });
      return json(200, { ok: false, error: String(e.message || e), run_id: run.id, landed });
    }

    const done = phaseIdx >= PHASES.length;
    await runPatch(run.id, { status: done ? 'committed' : 'committing', cursor: done ? { phase: 'done', page: 0 } : cursor, landed, skipped, committed_at: done ? new Date().toISOString() : null });
    return json(200, { ok: true, done, phase: done ? 'done' : cursor.phase, landed, skipped, run_id: run.id, next: done ? null : 'call do=commit again' });
  }

  return json(400, { ok: false, error: 'pass ?do=probe|preview|commit|status' });
};

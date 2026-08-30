// _lib/import/workiz-adapter — Workiz (REST) → the platform's normalized bundle.
// Same contract as hcp-adapter (probe / page / PHASES / START) so it plugs into land.js.
// Auth: the Workiz API token lives IN THE URL PATH (…/api/v1/<token>/…). Workiz has no separate
// customers list — customer fields are denormalized onto each job — so the 'customers' phase walks
// the jobs feed and emits a deduped customer per job (external_id = ClientId, resolved through
// import_map on land), and the 'jobs' phase walks it again emitting jobs linked by the same id.
// Pagination is offset-based. No reliable team endpoint → jobs land with tech null (office assigns).
//
// NOTE: built to Workiz's documented v1 API; first-real-shop tuning expected (status spellings,
// field names, whether team data is exposed) — same as HCP surfaced live.
'use strict';

const HOST = process.env.WORKIZ_API_HOST || 'https://api.workiz.com';
const RECORDS = 100;
const START_DATE = '2010-01-01';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toCents(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[$,\s]/g, '');
  return /\./.test(s) ? (Math.round(parseFloat(s) * 100) || 0) : (parseInt(s, 10) || 0);
}
function clean(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function pick(o, keys) { for (const k of keys) { const v = o && o[k]; if ((typeof v === 'string' && v !== '') || typeof v === 'number') return v; } return ''; }

function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (/complet|done|paid/.test(v)) return 'completed';
  if (/cancel/.test(v)) return 'canceled';
  if (/on the way|in progress|en route|started/.test(v)) return 'in_progress';
  if (/submitted|pending|new|unscheduled/.test(v)) return 'new';
  if (/schedul/.test(v)) return 'scheduled';
  return 'new';
}

function custExt(j) { return String(pick(j, ['ClientId', 'client_id']) || pick(j, ['Phone', 'PhoneNumber']) || ''); }

function normCustomer(j) {
  return {
    external_id: custExt(j),
    row: {
      first_name: String(pick(j, ['FirstName', 'first_name']) || ''),
      last_name: String(pick(j, ['LastName', 'last_name']) || pick(j, ['Company']) || ''),
      phone: String(pick(j, ['Phone', 'PhoneNumber', 'SecondPhone']) || ''),
      email: String(pick(j, ['Email']) || ''),
      address: String(pick(j, ['Address']) || ''),
      city: String(pick(j, ['City']) || ''),
      state: String(pick(j, ['State']) || ''),
      zip: String(pick(j, ['PostalCode', 'Zip']) || ''),
      notes: null,
    },
  };
}
function normJob(j) {
  const start = String(pick(j, ['JobDateTime', 'ScheduledDateTime', 'CreatedDate']) || '');
  const total = toCents(pick(j, ['JobTotalPrice', 'Total', 'SubTotal']));
  const due = toCents(pick(j, ['JobAmountDue', 'AmountDue']));
  const st = mapStatus(pick(j, ['Status', 'SubStatus']));
  return {
    external_id: String(pick(j, ['UUID', 'uuid', 'SerialId', 'id']) || ''),
    _customer_ext: custExt(j),
    _tech_ext: '',
    row: {
      status: st,
      problem: (clean(pick(j, ['JobType', 'JobNotes', 'Comments'])) || null),
      source: 'import_workiz',
      scheduled_day: start ? String(start).slice(0, 10) : null,
      scheduled_start: /\d{4}-\d\d-\d\d[ T]\d/.test(start) ? start.replace(' ', 'T') : null,
      completed_at: null,
    },
    invoice: total > 0 ? { external_id: 'inv_' + String(pick(j, ['UUID', 'SerialId']) || ''), number: (pick(j, ['SerialId']) ? String(j.SerialId) : null), total_cents: total, paid: total > 0 && due === 0, line_desc: 'Imported from Workiz' + (j.Status ? ' · ' + j.Status : '') } : null,
  };
}

async function fetchJobs(token, offset) {
  const url = `${HOST}/api/v1/${encodeURIComponent(token)}/job/all/?start_date=${START_DATE}&offset=${offset}&records=${RECORDS}&only_open=false`;
  let r; for (let a = 0; a < 3; a++) { r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (r.status !== 429) break; await sleep(1500 * (a + 1)); }
  let d = null; try { d = await r.json(); } catch (_) {}
  const list = (d && (Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []))) || [];
  return { status: r.status, list, flag: d && d.flag };
}

async function probe(token) {
  const p = await fetchJobs(token, 0);
  const ok = p.status < 400 && p.flag !== false;
  // Workiz gives no grand total; report first-page presence (real totals accrue as it imports).
  return {
    customers: { http: p.status, total: null, ok, sample_keys: p.list[0] ? Object.keys(p.list[0]).slice(0, 16) : [] },
    jobs: { http: p.status, total: null, ok, sample_keys: p.list[0] ? Object.keys(p.list[0]).slice(0, 16) : [] },
  };
}

// cursor = offset (START=0). one page of a kind, both derived from the jobs feed.
async function page(token, kind, cursor) {
  const offset = Number(cursor) || 0;
  const p = await fetchJobs(token, offset);
  if (p.status >= 400) return { status: p.status, total: null, records: [], next: null };
  const norm = kind === 'jobs' ? normJob : normCustomer;
  const records = p.list.map(norm).filter((x) => x.external_id);
  const next = p.list.length < RECORDS ? null : offset + RECORDS;
  return { status: p.status, total: null, records, next };
}

const PHASES = [
  { kind: 'customers', table: 'customer', mapKind: 'customer' },
  { kind: 'jobs',      table: 'job',       mapKind: 'job', fk: true },
];

module.exports = { probe, page, PHASES, START: 0, mapStatus, toCents };

// _lib/import/jobber-adapter — Jobber (GraphQL) → the platform's normalized bundle.
// Same contract as hcp-adapter (probe / page / PHASES / START) so it plugs into land.js.
// Auth: a Jobber OAuth access token, header `Authorization: Bearer <token>`. Jobber has no
// static API key — the token comes from the OAuth "Connect Jobber" step (operator-driven for
// now; a one-click connect button is the polish). Pagination is GraphQL cursors (after/endCursor).
//
// NOTE: built to Jobber's documented API; gets its first-real-shop field tuning like HCP did
// (enum spellings, nested money/address shapes vary by account + API version).
'use strict';

const BASE = process.env.JOBBER_GRAPHQL_URL || 'https://api.getjobber.com/api/graphql';
const API_VERSION = process.env.JOBBER_API_VERSION || '2023-11-15';
const PAGE = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toCents(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) >= 1000 ? v : Math.round(v * 100);
  const s = String(v).replace(/[$,\s]/g, '');
  return /\./.test(s) ? (Math.round(parseFloat(s) * 100) || 0) : (parseInt(s, 10) || 0);
}
function clean(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function primary(arr, field) { // Jobber phones/emails: [{number|address, primary}]
  if (!Array.isArray(arr) || !arr.length) return '';
  const p = arr.find((x) => x && x.primary) || arr[0];
  return String((p && (p[field])) || '');
}

// Jobber jobStatus enum -> board status
function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (/complete|invoiced|closed/.test(v)) return 'completed';
  if (/archiv|cancel/.test(v)) return 'canceled';
  if (/active|today|in_progress/.test(v)) return 'in_progress';
  if (/hold|action_required|requires/.test(v)) return 'awaiting_parts';
  if (/upcoming|unscheduled|late|scheduled/.test(v)) return 'scheduled';
  return 'new';
}

// ---- normalizers ----
function normTech(n) {
  const nm = n.name || {};
  return { external_id: String(n.id || ''), row: { name: [nm.first, nm.last].filter(Boolean).join(' ') || 'Technician', phone: String((n.phone && (n.phone.friendly || n.phone.raw)) || ''), active: true } };
}
function normCustomer(n) {
  const a = n.billingAddress || {};
  return {
    external_id: String(n.id || ''),
    row: {
      first_name: String(n.firstName || ''),
      last_name: String(n.lastName || n.companyName || ''),
      phone: primary(n.phones, 'number'),
      email: primary(n.emails, 'address'),
      address: [a.street1, a.street2].filter(Boolean).join(' '),
      city: String(a.city || ''),
      state: String(a.province || a.state || ''),
      zip: String(a.postalCode || ''),
      notes: null,
    },
  };
}
function normJob(n) {
  const a = (n.property && n.property.address) || {};
  const startIso = n.startAt || (n.schedule && n.schedule.startAt) || '';
  const total = toCents(n.total && (n.total.amount != null ? n.total.amount : n.total));
  const st = mapStatus(n.jobStatus || n.status);
  return {
    external_id: String(n.id || ''),
    _customer_ext: String((n.client && n.client.id) || ''),
    _tech_ext: '', // Jobber assigns via visits/assignments — left null in v1 (office reassigns)
    row: {
      status: st,
      problem: clean(n.title || n.instructions || n.description) || null,
      source: 'import_jobber',
      scheduled_day: startIso ? String(startIso).slice(0, 10) : null,
      scheduled_start: startIso || null,
      completed_at: st === 'completed' ? (n.completedAt || null) : null,
    },
    invoice: total > 0 ? { external_id: 'inv_' + String(n.id || ''), number: n.jobNumber != null ? String(n.jobNumber) : null, total_cents: total, paid: false, line_desc: 'Imported from Jobber' + (n.jobStatus ? ' · ' + n.jobStatus : '') } : null,
  };
}

// ---- GraphQL kinds ----
const KINDS = {
  technicians: {
    conn: 'users', norm: normTech,
    node: 'id name { first last } phone { friendly }',
  },
  customers: {
    conn: 'clients', norm: normCustomer,
    node: 'id firstName lastName companyName phones { number primary } emails { address primary } billingAddress { street1 street2 city province postalCode }',
  },
  jobs: {
    conn: 'jobs', norm: normJob,
    node: 'id jobNumber title jobStatus startAt client { id } total property { address { street1 city province postalCode } }',
  },
};

async function gql(token, query) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'X-JOBBER-GRAPHQL-VERSION': API_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000),
  });
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, data: d && d.data, errors: d && d.errors };
}

async function probe(token) {
  const out = {};
  for (const [kind, cfg] of Object.entries(KINDS)) {
    const q = `query { ${cfg.conn}(first: 1) { totalCount } }`;
    const r = await gql(token, q);
    const conn = r.data && r.data[cfg.conn];
    out[kind] = { http: r.status, total: conn ? conn.totalCount : null, ok: r.status < 400 && !r.errors && !!conn, sample_keys: [] };
    await sleep(150);
  }
  return out;
}

// cursor = GraphQL endCursor (START=null → first page). returns { status, total, records, next }
async function page(token, kind, cursor) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error('unknown kind ' + kind);
  const after = cursor ? `, after: ${JSON.stringify(String(cursor))}` : '';
  const q = `query { ${cfg.conn}(first: ${PAGE}${after}) { totalCount pageInfo { hasNextPage endCursor } nodes { ${cfg.node} } } }`;
  const r = await gql(token, q);
  if (r.status >= 400 || r.errors) return { status: r.status >= 400 ? r.status : 422, total: null, records: [], next: null };
  const conn = (r.data && r.data[cfg.conn]) || {};
  const nodes = conn.nodes || (conn.edges || []).map((e) => e.node) || [];
  const records = nodes.map(cfg.norm).filter((x) => x.external_id);
  const pi = conn.pageInfo || {};
  return { status: r.status, total: conn.totalCount ?? null, records, next: pi.hasNextPage ? pi.endCursor : null };
}

const PHASES = [
  { kind: 'technicians', table: 'technician', mapKind: 'technician' },
  { kind: 'customers',   table: 'customer',   mapKind: 'customer' },
  { kind: 'jobs',        table: 'job',         mapKind: 'job', fk: true },
];

module.exports = { probe, page, PHASES, START: null, mapStatus, toCents };

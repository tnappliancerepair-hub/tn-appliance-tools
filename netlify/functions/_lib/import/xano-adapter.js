// _lib/import/xano-adapter — TN's OWN old system (Xano) → the platform board.
// Same contract as the other adapters (probe / page / PHASES / START) so it lands through land.js.
// READ-ONLY against Xano (Metadata content API) — the old system keeps running untouched; this
// never writes a byte back to Xano. That IS "run both until you're sure."
//
// Auth: the vaulted XANO_METADATA_TOKEN (content-scoped) — this is TN's own system, so no key is
// pasted; platform-import falls back to it. The platform was built to hold TN's shape: every landed
// row also carries its Xano id (customer/job/unit -> xano_id, technician -> xano_tech_id) so the
// board's existing mirror columns line up.
//
// NOTE: normalizers are best-guess from known columns; `do=probe` returns each table's real
// sample_keys so the mapping gets confirmed against live data before any commit (same as HCP).
'use strict';
const { getSecret } = require('../secrets');

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const PER_PAGE = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// TN Xano table ids (confirmed in _lib/backup.js NAME_MAP)
const TABLE = { technicians: 15, customers: 6, jobs: 7 };

function toCents(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100);
  const s = String(v).replace(/[$,\s]/g, '');
  return /\./.test(s) ? (Math.round(parseFloat(s) * 100) || 0) : (parseInt(s, 10) || 0);
}
function clean(s) { return String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(); }
function pick(o, keys) { for (const k of keys) { const v = o && o[k]; if ((typeof v === 'string' && v !== '') || typeof v === 'number') return v; } return ''; }
function firstIso(v) { // Xano timestamps land as ms number or ISO string
  if (!v) return '';
  if (typeof v === 'number') { try { return new Date(v).toISOString(); } catch (_) { return ''; } }
  return String(v);
}

// Xano scheduling_status -> board status
function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (/complet/.test(v)) return 'completed';
  if (/cancel/.test(v)) return 'canceled';
  if (/in_progress|in progress|started/.test(v)) return 'in_progress';
  if (/await|parts|hold/.test(v)) return 'awaiting_parts';
  if (/scheduled/.test(v)) return 'scheduled';
  return 'new'; // not_ready / needs_more_info / needs_scheduled / new
}

// ---- normalizers (job/customer/tech raw Xano row -> board columns) ----
function normTech(o) {
  const name = [pick(o, ['first_name', 'name']), pick(o, ['last_name'])].filter(Boolean).join(' ') || 'Technician';
  return { external_id: String(o.id), row: { name, phone: String(pick(o, ['phone', 'cell', 'mobile']) || ''), active: o.active !== false, xano_tech_id: o.id } };
}
function normCustomer(o) {
  return {
    external_id: String(o.id),
    row: {
      first_name: String(pick(o, ['first_name', 'customer_first']) || ''),
      last_name: String(pick(o, ['last_name', 'customer_last']) || ''),
      phone: String(pick(o, ['phone', 'customer_phone', 'mobile', 'cell']) || ''),
      email: String(pick(o, ['email', 'customer_email']) || ''),
      address: String(pick(o, ['service_address', 'address', 'street']) || ''),
      city: String(pick(o, ['service_city', 'city']) || ''),
      state: String(pick(o, ['service_state', 'state']) || ''),
      zip: String(pick(o, ['service_zip', 'zip', 'postal_code']) || ''),
      notes: clean(pick(o, ['notes', 'notes_internal'])) || null,
      xano_id: o.id,
    },
  };
}
function normJob(o) {
  const sched = firstIso(pick(o, ['scheduled_start']));
  const done = firstIso(pick(o, ['job_completed_at']));
  const appl = [pick(o, ['appliance_brand', 'brand']), pick(o, ['appliance_type']), pick(o, ['model_number', 'appliance_model'])].filter(Boolean).join(' ').trim();
  const prob = clean(pick(o, ['problem_summary', 'problem_description', 'recommended_service']));
  const problem = [appl, prob].filter(Boolean).join(' — ') || null; // fold appliance into problem (units are phase-2)
  const st = mapStatus(pick(o, ['scheduling_status', 'current_status']));
  return {
    external_id: String(o.id),
    _customer_ext: String(pick(o, ['customer_id']) || ''),
    _tech_ext: String(pick(o, ['technician_id', 'accepted_by_tech_id']) || ''),
    row: {
      status: st,
      problem,
      source: 'import_xano',
      scheduled_day: sched ? sched.slice(0, 10) : null,
      scheduled_start: sched || null,
      completed_at: done || null,
      warranty_company: String(pick(o, ['warranty_company']) || '') || null,
      claim_number: String(pick(o, ['claim_number']) || '') || null,
      dispatch_id: String(pick(o, ['dispatch_source_id']) || '') || null,
      parts_status: String(pick(o, ['parts_status']) || '') || null,
      service_window: String(pick(o, ['service_eta_window']) || '') || null,
      xano_id: o.id,
      xano_status: String(pick(o, ['scheduling_status']) || '') || null,
      xano_current_status: String(pick(o, ['current_status']) || '') || null,
    },
    invoice: null, // money layer (total_amount_cents + warranty remittance) is its own careful phase-2 pass
  };
}
// TN's Xano carries throwaway test jobs (test_run_id) — never migrate those onto a real board.
function isTestJob(o) { const t = o && o.test_run_id; return t != null && t !== '' && t !== false; }
const NORM = { technicians: normTech, customers: normCustomer, jobs: normJob };

async function headers() {
  const tok = (await getSecret('XANO_METADATA_TOKEN')) || '';
  return { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
}

// read one page of a Xano table via the Metadata content/search endpoint (id-ascending = stable)
async function readTable(id, page) {
  const H = await headers();
  let r;
  for (let a = 0; a < 3; a++) {
    r = await fetch(`${META}/table/${id}/content/search`, {
      method: 'POST', headers: H, body: JSON.stringify({ per_page: PER_PAGE, page, sort: { id: 'asc' } }), signal: AbortSignal.timeout(15000),
    });
    if (r.status !== 429) break; await sleep(1500 * (a + 1));
  }
  let d = null; try { d = await r.json(); } catch (_) {}
  const list = Array.isArray(d) ? d : (d && (d.items || d.records || d.data)) || [];
  return { status: r.status, list, total: d && (d.itemsTotal || d.total) };
}

async function probe(_key) {
  const out = {};
  for (const [kind, id] of Object.entries(TABLE)) {
    const p = await readTable(id, 1);
    out[kind] = { http: p.status, total: p.total ?? null, ok: p.status < 400, sample_keys: p.list[0] ? Object.keys(p.list[0]) : [] };
    await sleep(150);
  }
  return out;
}

// cursor = page number (START=1). { status, total, records, next }
async function page(_key, kind, cursor) {
  const id = TABLE[kind];
  if (!id) throw new Error('unknown kind ' + kind);
  const pageNum = Number(cursor) || 1;
  const p = await readTable(id, pageNum);
  let list = p.list || [];
  if (kind === 'jobs') list = list.filter((o) => !isTestJob(o)); // drop TN's test jobs
  const records = list.map(NORM[kind]).filter((x) => x.external_id && x.external_id !== 'undefined');
  const next = (p.list || []).length < PER_PAGE ? null : pageNum + 1;
  return { status: p.status, total: p.total ?? null, records, next };
}

const PHASES = [
  { kind: 'technicians', table: 'technician', mapKind: 'technician' },
  { kind: 'customers',   table: 'customer',   mapKind: 'customer' },
  { kind: 'jobs',        table: 'job',         mapKind: 'job', fk: true },
];

module.exports = { probe, page, PHASES, START: 1, TABLE, mapStatus, toCents };

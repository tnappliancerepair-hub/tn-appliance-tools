// _lib/import/hcp-adapter — Housecall Pro → the platform's normalized bundle.
// Read-only against HCP's public API (Authorization: Token <key>). Knows nothing about
// Supabase — it just fetches a page of a kind and normalizes each record into the shape the
// board-landing writer (land.js) understands. Jobber/Workiz get sibling adapters with the
// same three exports (probe / page / the norm* helpers wired through KINDS).
'use strict';

const BASE = process.env.HCP_BASE_URL || 'https://api.housecallpro.com';
const PAGE_SIZE = 100;

const KINDS = {
  // internal kind -> { path, arrayKeys, norm(rawObject) -> normalized partial }
  technicians: { path: 'employees',  arrayKeys: ['employees'],  norm: normTech },
  customers:   { path: 'customers',  arrayKeys: ['customers'],  norm: normCustomer },
  jobs:        { path: 'jobs',       arrayKeys: ['jobs'],       norm: normJob },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function listFrom(d, keys) {
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d && d[k])) return d[k];
  if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  return [];
}
function totalFrom(d) { return (d && (d.total_items || d.total || d.total_count)) || null; }

// HCP money: job total_amount / balances are integer cents. Guard for the rare decimal-dollar string.
function toCents(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100);
  const s = String(v).replace(/[$,\s]/g, '');
  if (/\./.test(s)) return Math.round(parseFloat(s) * 100) || 0;
  const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0;
}
// scalar-only: HCP fields like description/notes are sometimes objects/arrays — never let one
// stringify to "[object Object]" in a board column.
function pick(o, keys) { for (const k of keys) { const v = o && o[k]; if ((typeof v === 'string' && v !== '') || typeof v === 'number') return v; } return ''; }
// HCP descriptions are often rich text (dispatch.me <a> tags, <br>, entities) — strip to clean,
// safe plain text before it lands in a board column.
function clean(s) {
  return String(s)
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim();
}
// text — coerce a scalar, or flatten an array/object of note-ish shapes, to clean plain text.
function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return clean(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(' · ');
  if (typeof v === 'object') { for (const k of ['content', 'text', 'note', 'message', 'body', 'value', 'name']) if (typeof v[k] === 'string' && v[k]) return clean(v[k]); }
  return '';
}

// ---- status map (HCP work_status -> board status) ----
function mapStatus(ws) {
  const s = String(ws || '').toLowerCase().replace(/_/g, ' ').trim();
  if (/complete/.test(s)) return 'completed';
  if (/cancel/.test(s)) return 'canceled';
  if (/in progress|started/.test(s)) return 'in_progress';
  if (/scheduled|schedule appointment/.test(s)) return 'scheduled';
  return 'new'; // needs scheduling / unscheduled / new / anything else
}

// ---- normalizers: raw HCP object -> { external_id, ...board columns, _refs } ----
function normTech(o) {
  const name = [pick(o, ['first_name']), pick(o, ['last_name'])].filter(Boolean).join(' ') || pick(o, ['name', 'email']) || 'Technician';
  return {
    external_id: String(o.id || o.uuid || ''),
    row: { name, phone: String(pick(o, ['mobile_number', 'phone', 'work_number']) || ''), active: o.role !== 'office_staff' && o.deactivated !== true },
  };
}

function normCustomer(o) {
  const addr = (Array.isArray(o.addresses) && o.addresses[0]) || o.address || {};
  return {
    external_id: String(o.id || o.uuid || ''),
    row: {
      first_name: String(pick(o, ['first_name']) || ''),
      last_name: String(pick(o, ['last_name']) || pick(o, ['company']) || ''),
      phone: String(pick(o, ['mobile_number', 'home_number', 'work_number', 'phone']) || ''),
      email: String(pick(o, ['email']) || ''),
      address: String(pick(addr, ['street', 'street_line_1', 'address']) || ''),
      city: String(pick(addr, ['city']) || ''),
      state: String(pick(addr, ['state']) || ''),
      zip: String(pick(addr, ['zip', 'postal_code']) || ''),
      notes: (text(o.notes).slice(0, 2000)) || null,
    },
  };
}

function normJob(o) {
  const cust = o.customer || {};
  const sched = o.schedule || {};
  const startIso = pick(sched, ['scheduled_start', 'start_time']) || pick(o, ['scheduled_start']) || '';
  const day = startIso ? String(startIso).slice(0, 10) : null;
  const emp = (Array.isArray(o.assigned_employees) && o.assigned_employees[0]) || null;
  const total = toCents(pick(o, ['total_amount', 'total']));
  const balance = toCents(pick(o, ['outstanding_balance', 'balance']));
  const done = mapStatus(o.work_status) === 'completed';
  return {
    external_id: String(o.id || o.uuid || ''),
    _customer_ext: String(cust.id || cust.uuid || o.customer_id || ''),
    _tech_ext: emp ? String(emp.id || emp.uuid || '') : '',
    row: {
      status: mapStatus(o.work_status),
      problem: ((text(o.description) || text(o.notes)).slice(0, 4000)) || null,
      source: 'import_hcp',
      scheduled_day: day,
      scheduled_start: startIso || null,
      completed_at: done ? (pick(o, ['work_timestamps.completed_at']) || null) : null,
    },
    invoice: total > 0 ? {
      external_id: 'inv_' + String(o.id || ''),
      number: String(pick(o, ['invoice_number']) || '') || null,
      total_cents: total,
      paid: total > 0 && balance === 0,
      line_desc: 'Imported from Housecall Pro' + (o.work_status ? ' · ' + o.work_status : ''),
    } : null,
  };
}

// ---- API ----
async function fetchPage(key, path, arrayKeys, page) {
  const url = `${BASE}/${path}?page_size=${PAGE_SIZE}&per_page=${PAGE_SIZE}&page=${page}`;
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(url, { headers: { Authorization: 'Token ' + key }, signal: AbortSignal.timeout(15000) });
    if (r.status !== 429) break;
    await sleep(1500 * (attempt + 1));
  }
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, list: listFrom(d, arrayKeys), total: totalFrom(d) };
}

// probe — auth + true totals per kind, no normalization, no writes.
async function probe(key) {
  const out = {};
  for (const [kind, cfg] of Object.entries(KINDS)) {
    const p = await fetchPage(key, cfg.path, cfg.arrayKeys, 1);
    out[kind] = { http: p.status, total: p.total, ok: p.status < 400, sample_keys: p.list[0] ? Object.keys(p.list[0]).slice(0, 16) : [] };
    await sleep(200);
  }
  return out;
}

// page — one normalized page of a kind. { status, total, records:[normalized], short }
async function page(key, kind, pageNum) {
  const cfg = KINDS[kind];
  if (!cfg) throw new Error('unknown kind ' + kind);
  const p = await fetchPage(key, cfg.path, cfg.arrayKeys, pageNum);
  const records = (p.list || []).map(cfg.norm).filter((x) => x.external_id);
  return { status: p.status, total: p.total, records, short: (p.list || []).length < PAGE_SIZE };
}

module.exports = { probe, page, KINDS: Object.keys(KINDS), PAGE_SIZE, mapStatus, toCents };

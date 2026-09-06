// platform-tn-parts-migrate — phase-2 parts migration: copy TN's per-part
// parts-logistics detail from the legacy Xano into the platform `job_part` table,
// joined by the xano_id every mirrored job already carries.
//
// TWO Xano sources (both READ-ONLY toward Xano — Xano stays system of record):
//   A) parts_orders (table 47)          -> shop-ordered / cash parts: parts house
//      (supplier), ship-to vs pickup (notes.ship_to / notes.where_kind), per-order
//      ETA (notes.eta), cost + sell, order status, part #.
//   B) warranty_part_supplied (event_log table 3) -> vendor-supplied warranty parts
//      (AHS / ServicePower / SquareTrade): distributor/parts house, disposition
//      (used / return / not-here), part #, warranty vendor.
//
// Idempotent: every landed row carries xano_id 'po:<id>' / 'wp:<eventId>' and is
// upserted on (company_id, xano_id) — a re-run updates in place, never duplicates.
// Native app-created job_part rows (xano_id NULL) are never touched.
//
//   ?secret=<VAPI_ADMIN_SECRET>&dryrun=1                 -> preview both sources, ZERO writes
//   ?secret=…                                            -> forward run (newest N of each source)
//   ?secret=…&backfill=parts&page=1&limit=200            -> grind ALL parts_orders (asc), loop until done
//   ?secret=…&backfill=warranty&page=1&limit=200         -> grind ALL warranty parts (asc), loop until done
// A scheduled wrapper (platform-tn-parts-migrate-cron) calls the forward run every few min.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f'; // TN Appliance Exchange LLC (keeper)
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const PARTS_ORDERS = 47;   // Xano metadata table id
const EVENT_LOG = 3;       // Xano metadata table id
const FWD_PARTS = 80;      // forward-window size per source
const FWD_WARRANTY = 80;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url, key };
}

// ---- helpers -------------------------------------------------------------

function parseNotes(n) {
  if (!n) return {};
  if (typeof n === 'object') return n;
  try { return JSON.parse(n) || {}; } catch (_) { return {}; }
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function s(v) { return (v == null ? '' : String(v)).trim(); }
function isoDate(v) { const d = s(v); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; }
function clean(v) { const x = s(v); return x || null; }

// Xano job id -> platform job UUID, batched (job.xano_id is bigint on the mirror).
async function resolveJobs(url, key, ids) {
  const map = {};
  const uniq = [...new Set(ids.filter((n) => n > 0))];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const q = `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk.join(',')})&select=id,xano_id`;
    const r = await fetch(q, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    const rows = await r.json().catch(() => []);
    for (const j of (rows || [])) map[Number(j.xano_id)] = j.id;
  }
  return map;
}

// PostgREST bulk upsert on (company_id, xano_id). Cloned from platform-tn-mirror.
async function upsert(url, key, rows) {
  let landed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(`${url}/rest/v1/job_part?on_conflict=company_id,xano_id`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error(`job_part_${r.status}_${d.slice(0, 240)}`); }
    landed += chunk.length;
  }
  return landed;
}

// ---- source A: parts_orders (table 47) -----------------------------------

function poShipTo(notes) {
  const wk = s(notes.where_kind).toLowerCase();
  if (wk === 'willcall') return 'pickup_parts_house';
  if (wk === 'shop') return 'pickup_shop';
  if (wk === 'truck') return 'on_truck';
  if (wk === 'in_hand') return 'in_hand';
  if (wk === 'home') return 'customer';
  const st = s(notes.ship_to).toLowerCase();
  if (st === 'customer') return 'customer';
  if (st === 'shop') return 'pickup_shop';
  return null;
}
function poOrderStatus(v) {
  const x = s(v).toLowerCase();
  if (!x) return null;
  if (x === 'to_order' || x === 'needs_order' || x === 'needs_to_order' || x === 'pending') return 'to_order';
  return 'ordered'; // ordered / shipped / in_transit / arrived / received / delivered / returned -> placed-or-beyond
}
function mapPartsOrder(row, jobUuid) {
  const notes = parseNotes(row.notes);
  const pn = s(row.part_number);
  const sup = s(row.supplier).toLowerCase();
  const cost = num(row.cost_cents);
  const sell = num(row.sold_to_customer_cents);
  return {
    company_id: TN_COMPANY,
    job_id: jobUuid,
    xano_id: 'po:' + row.id,
    number: (pn && pn.toLowerCase() !== 'tbd') ? pn : null,
    name: clean(row.part_name),
    source: (sup && sup !== 'tbd' && sup !== 'other') ? sup : null,
    ship_to: poShipTo(notes),
    eta: isoDate(notes.eta) || isoDate(row.parts_eta_date),
    order_status: poOrderStatus(row.order_status),
    cost_cents: cost > 0 ? cost : null,
    sell_cents: sell > 0 ? sell : null,
  };
}

// ---- source B: warranty_part_supplied (event_log table 3) -----------------

function wpNorm(v) {
  const x = s(v).toLowerCase();
  if (['used'].includes(x)) return 'used';
  if (['to_return', 'unused', 'return'].includes(x)) return 'to_return';
  if (['returned', 'shipped'].includes(x)) return 'returned';
  if (['missing', 'not_here', 'not-here', 'discrepancy'].includes(x)) return 'missing';
  if (['to_order', 'order', 'need', 'needed'].includes(x)) return 'to_order';
  if (['we_ordering', 'we_order', 'self_order', 'we_ordered'].includes(x)) return 'we_ordering';
  if (['requested', 'ordered', 'request'].includes(x)) return 'requested';
  return 'for_claim';
}
function wpOrderStatus(st) {
  if (st === 'to_order') return 'to_order';
  if (st === 'requested' || st === 'we_ordering') return 'ordered';
  return 'claim_only'; // used / to_return / returned / missing / for_claim -> supplied under the claim
}
function wpDisposition(st) {
  if (st === 'used') return 'used';
  if (st === 'to_return' || st === 'returned') return 'return';
  if (st === 'missing') return 'not_here';
  return null; // requested / to_order / we_ordering / for_claim -> no disposition yet
}
function mapWarrantyPart(evt, jobUuid) {
  let md = evt.metadata;
  if (typeof md === 'string') { try { md = JSON.parse(md); } catch (_) { md = {}; } }
  md = md || {};
  const st = wpNorm(md.status);
  const distributor = s(md.distributor);
  const vendor = s(md.vendor);
  return {
    company_id: TN_COMPANY,
    job_id: jobUuid,
    xano_id: 'wp:' + evt.id,
    number: clean(md.part),
    name: clean(md.description || md.desc) || ('Part from ' + (distributor || vendor || 'warranty')),
    source: clean(distributor || vendor),   // the parts house / warranty co supplying it
    ship_to: null,                          // warranty-supplied path doesn't carry a destination
    eta: null,
    order_status: wpOrderStatus(st),
    disposition: wpDisposition(st),
  };
}

// ---- readers -------------------------------------------------------------

async function readParts(dir, per, page) { return crud.searchPageN(PARTS_ORDERS, {}, { id: dir }, per, page); }
async function readWarranty(dir, per, page) { return crud.searchPageN(EVENT_LOG, { action: 'warranty_part_supplied' }, { id: dir }, per, page); }

// Build job_part rows from a raw page of one source (resolving platform jobs).
async function buildPartsRows(url, key, rawRows) {
  const allIds = rawRows.map((r) => num(r.job_id));
  const jobIds = allIds.filter((n) => n > 0);
  const jm = await resolveJobs(url, key, jobIds);
  const rows = []; let no_job = 0, bad = 0, zero_job = 0;
  for (const r of rawRows) {
    try {
      const jid = num(r.job_id);
      if (jid <= 0) { zero_job++; no_job++; continue; }
      const uuid = jm[jid];
      if (!uuid) { no_job++; continue; }
      rows.push(mapPartsOrder(r, uuid));
    } catch (_) { bad++; }
  }
  const dbg = { zero_job, distinct_job_ids: [...new Set(jobIds)].slice(0, 20), resolved_ids: Object.keys(jm).length };
  return { rows, no_job, bad, dbg };
}
async function buildWarrantyRows(url, key, rawRows) {
  const parsed = rawRows.map((e) => {
    let md = e.metadata; if (typeof md === 'string') { try { md = JSON.parse(md); } catch (_) { md = {}; } }
    return { e, jid: num((md || {}).job_id) };
  });
  const jm = await resolveJobs(url, key, parsed.map((p) => p.jid));
  const rows = []; let no_job = 0, bad = 0;
  for (const { e, jid } of parsed) {
    try {
      const uuid = jm[jid];
      if (!uuid) { no_job++; continue; }
      rows.push(mapWarrantyPart(e, uuid));
    } catch (_) { bad++; }
  }
  return { rows, no_job, bad };
}

// ---- runner --------------------------------------------------------------

async function runPartsMigrate(o) {
  const dry = !!o.dry;
  const mode = o.mode || 'forward';
  const { url, key } = await cfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };

  const out = { ok: true, mode, dry };

  if (mode === 'backfill_parts' || mode === 'backfill_warranty') {
    const page = Math.max(1, parseInt(o.page, 10) || 1);
    const per = Math.min(200, Math.max(1, parseInt(o.limit, 10) || 200));
    const raw = mode === 'backfill_parts' ? await readParts('asc', per, page) : await readWarranty('asc', per, page);
    const built = mode === 'backfill_parts' ? await buildPartsRows(url, key, raw) : await buildWarrantyRows(url, key, raw);
    let landed = 0;
    if (!dry && built.rows.length) landed = await upsert(url, key, built.rows);
    out.page = page; out.read = raw.length; out.mapped = built.rows.length;
    out.no_job = built.no_job; out.bad = built.bad; out.landed = dry ? 0 : landed;
    out.next_page = raw.length >= per ? page + 1 : null;
    out.done = out.next_page === null;
    if (dry) { out.sample = built.rows.slice(0, 5); if (built.dbg) out.dbg = built.dbg; }
    return out;
  }

  // forward: newest N of BOTH sources
  const rawP = await readParts('desc', FWD_PARTS, 1);
  const rawW = await readWarranty('desc', FWD_WARRANTY, 1);
  const bp = await buildPartsRows(url, key, rawP);
  const bw = await buildWarrantyRows(url, key, rawW);
  const rows = bp.rows.concat(bw.rows);
  let landed = 0;
  if (!dry && rows.length) landed = await upsert(url, key, rows);
  out.parts = { read: rawP.length, mapped: bp.rows.length, no_job: bp.no_job, bad: bp.bad };
  out.warranty = { read: rawW.length, mapped: bw.rows.length, no_job: bw.no_job, bad: bw.bad };
  out.landed = dry ? 0 : landed;
  if (dry) { out.sample = { parts: bp.rows.slice(0, 4), warranty: bw.rows.slice(0, 4) }; if (bp.dbg) out.parts_dbg = bp.dbg; }
  return out;
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const dry = q.dryrun === '1';
  let mode = 'forward';
  if (q.backfill === 'parts') mode = 'backfill_parts';
  else if (q.backfill === 'warranty') mode = 'backfill_warranty';

  // Kill switch (vault, fresh so a flip is immediate) — bypassed under dryrun.
  if (!dry) {
    const enabled = s(await getSecretFresh('PLATFORM_PARTS_MIGRATE_ENABLED')).toLowerCase();
    if (enabled === 'false') return json(200, { ok: true, disabled: true, note: 'PLATFORM_PARTS_MIGRATE_ENABLED=false' });
  }

  try {
    const res = await runPartsMigrate({ dry, mode, page: q.page, limit: q.limit });
    return json(res.ok ? 200 : 500, res);
  } catch (err) {
    return json(200, { ok: false, error: String(err && err.message || err) });
  }
};

module.exports.runPartsMigrate = runPartsMigrate;

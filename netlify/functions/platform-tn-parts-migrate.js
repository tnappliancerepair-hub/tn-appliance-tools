// platform-tn-parts-migrate — copy TN's per-part PARTS-LOGISTICS from legacy Xano onto the
// ANT Platform tenant (job_part), in parallel with Xano. The v1 board migration brought
// job-level warranty/parts STATUS but not the per-part detail (which parts house, ship-to
// vs pickup, per-part ETA, cost, order status/disposition). This fills job_part so the
// platform board is trustworthy for daily parts tracking.
//
// READ-ONLY toward Xano (Xano stays system of record). WRITES only into the platform Supabase
// (TN's tenant, service key). Joins on the xano_id every migrated job already carries
// (unique company_id,xano_id) so each part lands on the right job.
//
// TWO legacy sources -> job_part:
//   A) parts_orders (Xano table 47)      -> job_part {source=supplier(parts house), ship_to=notes.ship_to/where_kind,
//        the shop's own orders (cash+warranty)   eta=notes.eta, cost_cents, sell_cents=sold_to_customer_cents,
//                                                 number=part_number, name=part_name, order_status}   xano_id='po:<id>'
//   B) warranty_part_supplied (event_log id 3) -> job_part {source=distributor||vendor, number=part, name=description,
//        vendor-supplied AHS/ServicePower/SquareTrade  disposition/order_status<-status}              xano_id='wp:<id>'
//
// Idempotent: job_part upserts on (company_id,xano_id) [migration 055 — text, plain unique],
// namespaced po:/wp: keys so the two sources never collide. Native app-created parts (xano_id
// NULL) are untouched.
//
//   GET ?secret=<admin>                       -> forward run (recent parts_orders + recent warranty parts)
//   GET ?secret=…&dryrun=1                     -> list what WOULD land, write nothing
//   GET ?secret=…&mode=backfill_po&page=P      -> walk ALL parts_orders (id asc), returns next_page/done
//   GET ?secret=…&mode=backfill_wp&page=P      -> walk ALL warranty_part_supplied events (id asc)
//   Tunables (vault): PLATFORM_PARTS_MIGRATE_ENABLED=false (kill), PLATFORM_PARTS_MIGRATE_FWD_PO (default 80),
//     PLATFORM_PARTS_MIGRATE_FWD_WP (default 80)
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';   // TN Appliance Exchange LLC (keeper)
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const T_PARTS = 47;    // parts_orders
const T_EVENT = 3;     // event_log

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// ── Xano metadata read (vault-first token) ──
async function xanoToken() { return (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN || ''; }
async function xanoSearch(tableId, body) {
  const token = await xanoToken();
  if (!token) throw new Error('XANO_METADATA_TOKEN missing');
  const r = await fetch(`${META}/table/${tableId}/content/search`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`xano_${tableId}_${r.status}`);
  return (await r.json()).items || [];
}

// ── Platform Supabase (service key) ──
async function platformCfg() {
  const url = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url, key };
}
function pf(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(10000) }); return r.ok ? r.json() : []; },
    // Upsert job_part on (company_id,xano_id) -> idempotent (no dup on re-run). Chunked at 500.
    async upsertParts(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const r = await fetch(`${base}/rest/v1/job_part?on_conflict=company_id,xano_id`, {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error('parts_upsert_' + r.status + '_' + d.slice(0, 180)); }
        n += chunk.length;
      }
      return n;
    },
  };
}

// Map a batch of Xano job_ids -> platform job UUIDs (chunked). Returns Map<xanoId, uuid>.
async function resolveJobsByXano(db, xanoIds) {
  const out = new Map();
  const ids = [...new Set(xanoIds.filter((n) => Number(n) > 0))];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await db.get(`job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk.map((n) => '"' + n + '"').join(',')})&select=id,xano_id`);
    (rows || []).forEach((r) => out.set(String(r.xano_id), r.id));
  }
  return out;
}
// Fallback: resolve a platform job UUID by claim_number (for warranty parts missing job_id).
async function resolveJobByClaim(db, claim) {
  const c = String(claim || '').trim();
  if (!c) return null;
  const rows = await db.get(`job?company_id=eq.${TN_COMPANY}&claim_number=eq.${encodeURIComponent(c)}&select=id&limit=1`);
  return (rows && rows[0] && rows[0].id) || null;
}

// ── helpers ──
const SUPPLIER_PRETTY = { marcone: 'Marcone', msupply: 'Marcone', amazon: 'Amazon', encompass: 'Encompass', reliable: 'Reliable Parts', tribles: 'Tribles', ideal: 'Ideal', ideals: 'Ideal', other: 'Other' };
function prettySupplier(s) {
  const k = String(s || '').trim().toLowerCase();
  if (!k || k === 'tbd') return null;
  if (SUPPLIER_PRETTY[k]) return SUPPLIER_PRETTY[k];
  return k.charAt(0).toUpperCase() + k.slice(1);
}
function cleanNum(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; }
function isoDate(v) { const s = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function partNumber(v) { const s = String(v || '').trim(); return (!s || s.toUpperCase() === 'TBD') ? null : s.slice(0, 120); }
function text(v, cap) { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, cap || 200) : null; }
function normKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// A warranty event's `part` sometimes carries the description mashed in ("W123 -- Desc: PTC relay").
function splitPartDesc(part, desc) {
  const raw = String(part == null ? '' : part).trim();
  let num = raw, dsc = String(desc == null ? '' : desc).trim();
  const m = raw.match(/^(.*?)\s*(?:--\s*)?desc\s*:\s*(.+)$/i);
  if (m) { num = m[1].trim(); if (!dsc) dsc = m[2].trim(); }
  return { number: partNumber(num), name: text(dsc, 200) };
}

// notes JSON (string or object) -> {ship_to display, eta}
function parseNotes(notes) {
  let m = notes;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
  if (!m || typeof m !== 'object') m = {};
  const wk = String(m.where_kind || '').toLowerCase();
  const st = String(m.ship_to || '').toLowerCase();
  let ship = null;
  if (wk === 'willcall') ship = 'Pickup — parts house';
  else if (wk === 'shop') ship = 'Pickup — shop/storage';
  else if (wk === 'truck') ship = 'On the truck';
  else if (wk === 'in_hand') ship = 'In hand';
  else if (wk === 'home' || st === 'customer') ship = 'Ship to customer';
  else if (st === 'shop') ship = 'To the shop';
  return { ship_to: ship, eta: isoDate(m.eta) };
}

// warranty_part_supplied status -> platform {order_status, disposition}
function mapWarrantyStatus(status, requiresReturn) {
  const s = String(status || '').toLowerCase();
  if (s === 'used') return { disposition: 'used' };
  if (s === 'to_return' || s === 'returned') return { disposition: 'return' };
  if (s === 'missing') return { disposition: 'not_here' };
  if (s === 'to_order' || s === 'we_ordering') return { order_status: 'to_order' };
  if (s === 'requested' || s === 'for_claim') return { order_status: 'claim_only' };
  if (requiresReturn === true || requiresReturn === 'true') return { disposition: 'return' };
  return {};
}

// A row is worth landing only if it carries something useful beyond the join keys.
function meaningful(row) {
  return !!(row.number || row.name || row.source || row.cost_cents || row.sell_cents || row.eta || row.ship_to || row.order_status || row.disposition);
}

// ── PARTS_ORDERS pass ──
async function partsOrdersPass(db, rows, dry) {
  const res = { source: 'parts_orders', scanned: rows.length, upserted: 0, skipped_no_job: 0, skipped_empty: 0, errors: 0, sample: [] };
  const jobMap = await resolveJobsByXano(db, rows.map((a) => Number(a.job_id)));
  const dbg = { zero_job: 0, unresolved: 0, jobmap_size: jobMap.size, sample_job_ids: [] };
  const out = [];
  for (const a of rows) {
    if (!a.job_id || Number(a.job_id) <= 0) { res.skipped_no_job++; dbg.zero_job++; continue; }
    const pjob = jobMap.get(String(Number(a.job_id)));
    if (!pjob) { res.skipped_no_job++; dbg.unresolved++; if (dbg.sample_job_ids.length < 8) dbg.sample_job_ids.push(Number(a.job_id)); continue; }   // job not mirrored yet -> caught next cycle
    const { ship_to, eta } = parseNotes(a.notes);
    const os = String(a.order_status || '').toLowerCase();
    const row = {
      company_id: TN_COMPANY, job_id: pjob, xano_id: 'po:' + a.id,
      number: partNumber(a.part_number),
      name: text(a.part_name, 200),
      source: prettySupplier(a.supplier),
      cost_cents: cleanNum(a.cost_cents),
      sell_cents: cleanNum(a.sold_to_customer_cents),
      order_status: (os === 'to_order' || os === 'ordered') ? os : null,
      ship_to, eta,
    };
    if (!meaningful(row)) { res.skipped_empty++; continue; }
    if (dry) { res.upserted++; if (res.sample.length < 10) res.sample.push({ job: a.job_id, number: row.number, source: row.source, ship_to: row.ship_to, eta: row.eta, status: row.order_status }); continue; }
    out.push(row);
  }
  if (!dry && out.length) { try { res.upserted = await db.upsertParts(out); } catch (e) { res.errors++; res.upsert_error = String((e && e.message) || e).slice(0, 200); } }
  if (dry) res.debug = dbg;
  return res;
}

// ── WARRANTY_PART_SUPPLIED pass ──
async function warrantyPartsPass(db, events, dry) {
  const res = { source: 'warranty_part_supplied', scanned: events.length, upserted: 0, skipped_no_job: 0, skipped_empty: 0, errors: 0, sample: [] };
  const parsed = events.map((e) => {
    let m = e.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    if (!m || typeof m !== 'object') m = {};
    return { id: e.id, job_id: Number(m.job_id || 0), claim: String(m.claim || ''), part: m.part, desc: m.description || m.desc, distributor: m.distributor, vendor: m.vendor, status: m.status, requires_return: m.requires_return };
  });
  const jobMap = await resolveJobsByXano(db, parsed.map((x) => x.job_id));
  // Collapse to ONE row per (job, part): ServicePower emits two events per part (order + shipped),
  // so key on a stable per-part id — last event wins. Also prevents the "ON CONFLICT can't affect a
  // row twice" batch error that duplicate xano_id keys in one upsert would cause.
  const bykey = new Map();
  for (const w of parsed) {
    let pjob = w.job_id > 0 ? jobMap.get(String(w.job_id)) : null;
    if (!pjob && w.claim) { try { pjob = await resolveJobByClaim(db, w.claim); } catch (_) { pjob = null; } }
    if (!pjob) { res.skipped_no_job++; continue; }
    const disp = mapWarrantyStatus(w.status, w.requires_return);
    const source = prettySupplier(w.distributor) || (w.vendor ? text(w.vendor, 60) + ' (warranty)' : null);
    const pd = splitPartDesc(w.part, w.desc);
    const jobKey = w.job_id > 0 ? String(w.job_id) : ('c' + normKey(w.claim));
    const partKey = normKey(pd.number || w.part);
    const xano_id = partKey ? ('wp:' + jobKey + ':' + partKey) : ('wp:evt:' + w.id);
    const row = {
      company_id: TN_COMPANY, job_id: pjob, xano_id,
      number: pd.number,
      name: pd.name,
      source,
      order_status: disp.order_status || null,
      disposition: disp.disposition || null,
    };
    if (!meaningful(row)) { res.skipped_empty++; continue; }
    bykey.set(xano_id, row);
  }
  const out = [...bykey.values()];
  if (dry) {
    res.upserted = out.length;
    res.sample = out.slice(0, 10).map((r) => ({ number: r.number, name: r.name, source: r.source, disposition: r.disposition, status: r.order_status }));
  } else if (out.length) {
    try { res.upserted = await db.upsertParts(out); } catch (e) { res.errors++; res.upsert_error = String((e && e.message) || e).slice(0, 200); }
  }
  return res;
}

async function runMigrate(opts) {
  const t0 = Date.now();
  const o = opts || {};
  const dry = !!o.dry;
  const enabled = String((await getSecretFresh('PLATFORM_PARTS_MIGRATE_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_PARTS_MIGRATE_ENABLED=false' };

  const { url, key } = await platformCfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };
  const db = pf(url, key);

  const out = { ok: true, dry, mode: o.mode || 'forward', ms: 0 };

  if (o.mode === 'backfill_po') {
    const page = Math.max(1, parseInt(o.page, 10) || 1);
    const per = Math.max(1, Math.min(parseInt(o.limit, 10) || 200, 400));
    const rows = await xanoSearch(T_PARTS, { sort: { id: 'asc' }, per_page: per, page });
    out.parts_orders = await partsOrdersPass(db, rows, dry);
    out.page = page; out.next_page = rows.length >= per ? page + 1 : null; out.done = out.next_page === null;
  } else if (o.mode === 'backfill_wp') {
    const page = Math.max(1, parseInt(o.page, 10) || 1);
    const per = Math.max(1, Math.min(parseInt(o.limit, 10) || 200, 400));
    const rows = await xanoSearch(T_EVENT, { search: { action: 'warranty_part_supplied' }, sort: { id: 'asc' }, per_page: per, page });
    out.warranty_parts = await warrantyPartsPass(db, rows, dry);
    out.page = page; out.next_page = rows.length >= per ? page + 1 : null; out.done = out.next_page === null;
  } else {
    // forward: newest parts_orders + newest warranty-part events (idempotent -> re-covering the window is cheap)
    const fwdPo = parseInt((await getSecretFresh('PLATFORM_PARTS_MIGRATE_FWD_PO')) || '80', 10) || 80;
    const fwdWp = parseInt((await getSecretFresh('PLATFORM_PARTS_MIGRATE_FWD_WP')) || '80', 10) || 80;
    const poRows = await xanoSearch(T_PARTS, { sort: { id: 'desc' }, per_page: Math.min(fwdPo, 400) });
    out.parts_orders = await partsOrdersPass(db, poRows, dry);
    const wpRows = await xanoSearch(T_EVENT, { search: { action: 'warranty_part_supplied' }, sort: { id: 'desc' }, per_page: Math.min(fwdWp, 400) });
    out.warranty_parts = await warrantyPartsPass(db, wpRows, dry);
  }
  out.ms = Date.now() - t0;
  return out;
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  try {
    const out = await runMigrate({ dry: q.dryrun === '1', mode: q.mode || 'forward', page: q.page, limit: q.limit });
    return json(200, out);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.runMigrate = runMigrate;

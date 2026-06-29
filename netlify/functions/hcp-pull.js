// hcp-pull — mine Housecall Pro history into Supabase hcp_archive for the
// intelligence layer (pre-diagnosis, customer history, price calibration).
//
// Teddy (2026-06-29): we mined MeisterTask into the DB; do the same with HCP —
// thousands of jobs — to improve database intelligence. HCP is being decommissioned,
// so this rescues the history before access ends.
//
// ARCHIVE ONLY. Writes to Supabase hcp_archive (run docs/hcp-archive-schema.sql
// first) — NEVER the live jobs/customer tables, never the loop, never a signal.
// Resumable grind (saves a cursor so it survives Netlify's 26s cap) — drive it with
// repeated calls or a cron until status shows done. Same pattern as meistertask-pull.
//
//   GET ?secret=<admin>&probe=1                 verify HCP auth + report totals per kind
//   GET ?secret=<admin>&status=1                cursor + archived counts
//   GET ?secret=<admin>&kind=jobs&grind=4       process 4 pages of `kind` from the cursor
//   GET ?secret=<admin>&kind=jobs&clear=1       wipe that kind + reset its cursor (idempotent refresh)
'use strict';
const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const HCP_BASE = process.env.HCP_BASE_URL || 'https://api.housecallpro.com';
const PAGE_SIZE = 100;
const PACE_MS = 250;

// Kinds we mine. arrayKeys = candidate response keys holding the list (we also
// auto-detect the first array value as a fallback).
const KINDS = {
  jobs:      { path: 'jobs',      arrayKeys: ['jobs'] },
  customers: { path: 'customers', arrayKeys: ['customers'] },
  invoices:  { path: 'invoices',  arrayKeys: ['invoices'] },
  estimates: { path: 'estimates', arrayKeys: ['estimates'] },
};

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listFrom(d, arrayKeys) {
  if (Array.isArray(d)) return d;
  for (const k of arrayKeys) if (Array.isArray(d && d[k])) return d[k];
  if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  return [];
}
function totalFrom(d) { return (d && (d.total_items || d.total || d.total_count)) || null; }

function titleFor(kind, o) {
  try {
    if (kind === 'jobs') { const c = o.customer || {}; const nm = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || ''; return [nm, o.work_status, (o.description || '').slice(0, 60)].filter(Boolean).join(' · '); }
    if (kind === 'customers') return [o.first_name, o.last_name].filter(Boolean).join(' ') || o.company || o.email || '';
    if (kind === 'invoices') return [o.invoice_number ? '#' + o.invoice_number : '', o.total != null ? '$' + o.total : ''].filter(Boolean).join(' ');
    if (kind === 'estimates') return [o.estimate_number ? '#' + o.estimate_number : '', o.total != null ? '$' + o.total : ''].filter(Boolean).join(' ');
  } catch (_) {}
  return '';
}

async function hcpPage(apiKey, kindCfg, page) {
  const url = `${HCP_BASE}/${kindCfg.path}?page_size=${PAGE_SIZE}&per_page=${PAGE_SIZE}&page=${page}`;
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetch(url, { headers: { Authorization: 'Token ' + apiKey }, signal: AbortSignal.timeout(15000) });
    if (r.status !== 429) break;
    await sleep(2000); // rate-limited — back off once
  }
  const status = r.status;
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status, list: listFrom(d, kindCfg.arrayKeys), total: totalFrom(d) };
}

// cursor row in hcp_archive (kind='_cursor'): data = { jobs:{page,done,archived}, ... }
async function readCursor() {
  try { const rows = await sb.select('hcp_archive', { kind: 'eq._cursor', limit: 1 }); const c = rows && rows[0]; return { id: c && c.id, data: (c && c.data) || {} }; } catch (_) { return { id: null, data: {} }; }
}
async function writeCursor(cur) {
  if (cur.id) { await sb.update('hcp_archive', { id: 'eq.' + cur.id }, { data: cur.data }); return cur.id; }
  const ins = await sb.insert('hcp_archive', [{ kind: '_cursor', title: 'hcp pull cursor', data: cur.data }], { quiet: false });
  cur.id = ins && ins[0] && ins[0].id; return cur.id;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const apiKey = await getSecret('HCP_API_KEY');
  if (!apiKey) return json(200, { ok: false, error: 'HCP_API_KEY not readable — check it is scoped to Functions/Runtime in Netlify' });
  if (!(await sb.isConnected())) return json(200, { ok: false, error: 'supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_KEY)' });

  // PROBE — auth + totals per kind (no writes)
  if (q.probe === '1') {
    const out = {};
    for (const [k, cfg] of Object.entries(KINDS)) { const p = await hcpPage(apiKey, cfg, 1); out[k] = { http: p.status, total_items: p.total, sample: p.list[0] ? Object.keys(p.list[0]).slice(0, 18) : [] }; await sleep(PACE_MS); }
    return json(200, { ok: true, mode: 'probe', base: HCP_BASE, kinds: out });
  }

  // STATUS — cursor + archived counts
  if (q.status === '1') {
    const cur = await readCursor();
    const counts = {};
    for (const k of Object.keys(KINDS)) { try { const rows = await sb.select('hcp_archive', { kind: 'eq.' + k.replace(/s$/, ''), select: 'id', limit: 1 }); counts[k] = rows ? 'present' : 'none'; } catch (_) { counts[k] = '?'; } }
    return json(200, { ok: true, mode: 'status', cursor: cur.data, archived: counts });
  }

  const kind = String(q.kind || '').toLowerCase();
  if (!KINDS[kind]) return json(400, { ok: false, error: 'pass &kind=jobs|customers|invoices|estimates' });
  const cfg = KINDS[kind];
  const singular = kind.replace(/s$/, '');

  // CLEAR — wipe this kind + reset its cursor slot (idempotent refresh)
  if (q.clear === '1') {
    try { await sb.del('hcp_archive', { kind: 'eq.' + singular }); } catch (e) { return json(200, { ok: false, error: 'clear failed: ' + String(e.message || e) }); }
    const cur = await readCursor(); cur.data[kind] = { page: 0, done: false, archived: 0 }; await writeCursor(cur);
    return json(200, { ok: true, mode: 'clear', kind, note: 'wiped + cursor reset to page 0' });
  }

  // GRIND — process N pages from the saved cursor
  const grind = Math.max(1, Math.min(8, parseInt(q.grind, 10) || 4));
  const cur = await readCursor();
  const st = cur.data[kind] || { page: 0, done: false, archived: 0 };
  if (st.done && q.force !== '1') return json(200, { ok: true, mode: 'grind', kind, done: true, archived: st.archived, note: 'already done — &force=1 to re-grind' });

  let pagesRun = 0, added = 0, lastHttp = 0, total = null;
  for (let i = 0; i < grind; i++) {
    const page = st.page + 1;
    const p = await hcpPage(apiKey, cfg, page);
    lastHttp = p.status; total = p.total ?? total;
    if (p.status === 429) { break; } // rate-limited — stop the batch, cursor unchanged
    if (p.status >= 400) { return json(200, { ok: false, kind, page, http: p.status, error: 'HCP error — cursor not advanced' }); }
    if (!p.list.length) { st.done = true; break; } // ran past the end

    const rows = p.list.map((o) => ({ kind: singular, hcp_id: String(o.id || o.uuid || ''), title: titleFor(kind, o), data: o }));
    try { await sb.insert('hcp_archive', rows); } catch (e) { return json(200, { ok: false, kind, page, error: 'supabase insert failed: ' + String(e.message || e) }); }

    st.page = page; st.archived = (st.archived || 0) + rows.length; added += rows.length; pagesRun++;
    if (p.list.length < PAGE_SIZE) { st.done = true; break; } // short page = last page
    await sleep(PACE_MS);
  }
  cur.data[kind] = st; await writeCursor(cur);

  return json(200, { ok: true, mode: 'grind', kind, pages_run: pagesRun, added_this_run: added, archived_total: st.archived, at_page: st.page, done: !!st.done, total_items: total, last_http: lastHttp, next: st.done ? 'complete' : `repeat with &kind=${kind}&grind=${grind}` });
};

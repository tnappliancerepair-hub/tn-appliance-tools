// parts-pickup — "parts to grab" for a tech, so a guy heading into town (Lee to
// Clarksville) or into a distributor (Marcone / Tribles will-call) can pull ALL
// the parts he'll need for the next few days in one stop.
//
// TWO pickup sources, one rolling window (default next 5 days), grouped by WHERE
// to grab it:
//   1. 🏢 OUR STORAGE  — warranty parts the vendors shipped to us (warranty_part_
//      supplied events), tied to this tech's upcoming jobs. Arrival is tagged from
//      the job's parts_eta_date (here vs still-incoming).
//   2. 🔧 DISTRIBUTOR WILL-CALL — parts staged for branch pickup at Marcone /
//      Tribles / etc. (part_pickup_ready events). Populated when the office/Ant
//      marks an order "pickup at <branch>" instead of drop-ship.
//
// The tech checks each one off ("✓ Grabbed") → part_picked_up event, so the
// office sees what left storage/will-call and the tech has a clean packing list.
//
//   GET  ?tech_id=N[&days=5]                      → grouped pickup list for a tech
//   POST {tech_id, key, action:'pickup'|'undo'}   → check a part off / undo
//   POST {action:'stage', supplier, branch, part, tech_id?, area?, job_id?, ...}
//                                                  → stage a will-call pickup item
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const INTAKE = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const keyOf = (jobId, part) => `${jobId || 0}::${String(part || '').trim().toLowerCase()}`;
const DAY = 86400000;

// CT day label + yyyy-mm-dd bucket for grouping.
function ctParts(ms) {
  const d = new Date(Number(ms) || 0);
  const label = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' });
  const iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // yyyy-mm-dd
  return { label, iso };
}
// Start-of-today in CT, as ms (so "next 5 days" includes everything from this morning).
function ctTodayStartMs() {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  return new Date(`${iso}T00:00:00-05:00`).getTime(); // CT is -05/-06; off-by-an-hour is harmless for a day bucket
}

async function getJson(url, opts, ms) {
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(ms || 8000) }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n || 400); } catch (_) { return []; } }

// ── GET: build a tech's rolling pickup list ─────────────────────────────
async function buildList(techId, days) {
  const windowDays = Number(days) > 0 ? Number(days) : 5;
  const startMs = ctTodayStartMs();
  const endMs = startMs + (windowDays + 1) * DAY; // inclusive through the last day

  // 1. This tech's upcoming stops (job_id + date + city + cluster + appliance).
  const rd = await getJson(`${INTAKE}/get_tech_route_days?technician_id=${encodeURIComponent(techId)}`, {}, 9000);
  const stops = (rd && Array.isArray(rd.stops)) ? rd.stops : [];
  const stopByJob = {};
  const clusters = new Set();
  const cities = new Set();
  for (const s of stops) {
    if (s.cluster) clusters.add(String(s.cluster).toLowerCase());
    if (s.city) cities.add(String(s.city).toLowerCase());
    const ms = Number(s.scheduled_start_ms) || 0;
    if (ms >= startMs && ms < endMs) stopByJob[s.job_id] = s;
  }
  const inWindowJobIds = new Set(Object.keys(stopByJob).map(Number));

  // 2. Pull recent supplied-parts + will-call + pickup/undo events.
  const [supplied, willCall, pickedUpRows, undoRows] = await Promise.all([
    rows('warranty_part_supplied', 400),
    rows('part_pickup_ready', 400),
    rows('part_picked_up', 400),
    rows('part_pickup_undo', 200),
  ]);
  // Net pickup state per key: newest event (by row id) wins, so an "undo" after a
  // "grab" un-checks it. Merge both streams and take the first (newest) per key.
  const merged = []
    .concat(pickedUpRows.map((r) => ({ id: Number(r.id) || 0, on: true, m: metaOf(r) })))
    .concat(undoRows.map((r) => ({ id: Number(r.id) || 0, on: false, m: metaOf(r) })))
    .sort((a, b) => b.id - a.id);
  const pickState = {};
  for (const e of merged) { const k = e.m.key || keyOf(e.m.job_id, e.m.part); if (pickState[k] === undefined) pickState[k] = e.on; }
  const pickedUp = new Set(Object.keys(pickState).filter((k) => pickState[k]));

  // 3. STORAGE items: newest supplied row per (job, part) for this tech's in-window jobs.
  const seen = new Set();
  const storageRaw = [];
  for (const r of supplied) {
    const m = metaOf(r);
    if (!inWindowJobIds.has(Number(m.job_id))) continue;
    const k = keyOf(m.job_id, m.part);
    if (seen.has(k)) continue; seen.add(k);
    storageRaw.push({ k, job_id: Number(m.job_id), part: String(m.part || ''), distributor: m.distributor || '', tracking: m.tracking || '', customer: m.customer || '', claim: m.claim || '' });
  }

  // Enrich only the parts-bearing jobs (bounded set) with customer + arrival.
  const jobIds = [...new Set(storageRaw.map((x) => x.job_id))];
  const jobInfo = {};
  await Promise.all(jobIds.map(async (jid) => {
    const d = await getJson(`${INTAKE}/get_job_for_dashboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job_id: jid }) }, 8000);
    const j = (d && d.job) || {};
    const cust = (d && d.customer) ? `${(d.customer.first_name || '').trim()} ${(d.customer.last_name || '').trim()}`.trim() : '';
    jobInfo[jid] = { parts_eta_date: j.parts_eta_date || '', parts_status: (j.parts_status || '').toLowerCase(), customer: cust, scheduling_status: (j.scheduling_status || '').toLowerCase() };
  }));

  const storage = storageRaw.map((x) => {
    const s = stopByJob[x.job_id] || {};
    const info = jobInfo[x.job_id] || {};
    const ms = Number(s.scheduled_start_ms) || 0;
    const { label, iso } = ctParts(ms);
    // Arrival: if an ETA is set and still in the future → still incoming; else assume it's here.
    let arrival = 'here'; let eta_text = '';
    const eta = info.parts_eta_date || '';
    if (eta) {
      const etaMs = new Date(eta).getTime();
      if (!isNaN(etaMs) && etaMs > Date.now()) { arrival = 'incoming'; eta_text = new Date(etaMs).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }); }
    }
    return {
      key: x.k, source: 'storage', job_id: x.job_id, part: x.part,
      distributor: x.distributor, tracking: x.tracking,
      customer: info.customer || x.customer || '', city: s.city || '', appliance: s.appliance || '',
      day_label: label, day_iso: iso, scheduled_ms: ms,
      arrival, eta_text, picked_up: pickedUp.has(x.k),
    };
  });

  // 4. WILL-CALL items: staged distributor pickups matched to this tech.
  const wcSeen = new Set();
  const willcall = [];
  for (const r of willCall) {
    const m = metaOf(r);
    const k = m.key || keyOf(m.job_id, m.part);
    if (wcSeen.has(k)) continue; wcSeen.add(k);
    // Match: explicit tech_id, OR an area/cluster/city this tech is working this window.
    const forTech = (m.tech_id != null && Number(m.tech_id) === Number(techId));
    const area = String(m.area || m.cluster || m.city || '').toLowerCase();
    const areaMatch = area && (clusters.has(area) || cities.has(area) || [...clusters].some((c) => c.includes(area) || area.includes(c)) || [...cities].some((c) => c.includes(area) || area.includes(c)));
    if (!forTech && !areaMatch) continue;
    // Drop ones already fulfilled (marked done) — reuse part_pickup_ready with done:true, or a picked_up match.
    if (m.done === true || pickedUp.has(k)) continue;
    willcall.push({
      key: k, source: 'willcall', supplier: m.supplier || 'distributor', branch: m.branch || '', part: String(m.part || ''),
      job_id: m.job_id || null, customer: m.customer || '', appliance: m.appliance || '', note: m.note || '',
      area: m.area || m.cluster || m.city || '', picked_up: pickedUp.has(k),
    });
  }

  // 5. Group storage by day (soonest first).
  const byDay = {};
  for (const it of storage) { (byDay[it.day_iso] = byDay[it.day_iso] || { day_iso: it.day_iso, day_label: it.day_label, items: [] }).items.push(it); }
  const storage_by_day = Object.values(byDay).sort((a, b) => (a.day_iso < b.day_iso ? -1 : 1));
  for (const g of storage_by_day) g.items.sort((a, b) => a.scheduled_ms - b.scheduled_ms);

  const openStorage = storage.filter((x) => !x.picked_up);
  const counts = {
    storage_total: storage.length,
    storage_here: openStorage.filter((x) => x.arrival === 'here').length,
    storage_incoming: openStorage.filter((x) => x.arrival === 'incoming').length,
    willcall_total: willcall.length,
    picked_up: storage.filter((x) => x.picked_up).length,
  };
  return { window_days: windowDays, storage_by_day, willcall, counts };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    // Stage a distributor will-call pickup item (office/Ant).
    if (b.action === 'stage') {
      if (!b.part || !b.supplier) return json(400, { ok: false, error: 'part + supplier required' });
      const key = b.key || keyOf(b.job_id, b.part);
      await crud.logEvent('part_pickup_ready', {
        key, supplier: String(b.supplier), branch: String(b.branch || ''), part: String(b.part),
        tech_id: b.tech_id != null ? Number(b.tech_id) : null, area: String(b.area || ''), job_id: b.job_id || null,
        customer: String(b.customer || ''), appliance: String(b.appliance || ''), note: String(b.note || ''),
        by: String(b.by || 'office'), at_ms: Date.now(),
      });
      return json(200, { ok: true, staged: key });
    }
    // Tech checks a part off (grabbed) or undoes it.
    const jobId = b.job_id != null ? Number(b.job_id) : null;
    const key = b.key || keyOf(jobId, b.part);
    if (!key || key === '0::') return json(400, { ok: false, error: 'key (or job_id+part) required' });
    if (b.action === 'undo') {
      await crud.logEvent('part_pickup_undo', { key, part: String(b.part || ''), job_id: jobId, tech_id: b.tech_id != null ? Number(b.tech_id) : null, at_ms: Date.now() });
      return json(200, { ok: true, undone: key, note: 'logged undo (list recomputes on next load)' });
    }
    await crud.logEvent('part_picked_up', {
      key, part: String(b.part || ''), job_id: jobId, source: String(b.source || 'storage'),
      supplier: String(b.supplier || ''), branch: String(b.branch || ''),
      tech_id: b.tech_id != null ? Number(b.tech_id) : null, at_ms: Date.now(),
    });
    return json(200, { ok: true, picked_up: key });
  }

  const q = event.queryStringParameters || {};
  const techId = q.tech_id ? Number(q.tech_id) : null;
  if (!techId) return json(400, { ok: false, error: 'pass ?tech_id=' });
  try {
    const data = await buildList(techId, q.days);
    return json(200, Object.assign({ ok: true, tech_id: techId }, data));
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};

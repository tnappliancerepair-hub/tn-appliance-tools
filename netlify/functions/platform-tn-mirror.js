// platform-tn-mirror — mirror TN Appliance's live Xano jobs INTO the ANT Platform
// tenant tables (customer + unit + job) scoped to TN's company_id, so the platform
// office board shows TN's REAL work — the parity baseline for the crossover.
//
// READ-ONLY toward Xano: Xano stays the system of record. This only WRITES into the
// platform Supabase (TN's own tenant, RLS-scoped). Idempotent via a xano_id ref on
// each table (unique on company_id,xano_id) so re-runs update in place, never dup.
//
//   ?secret=<VAPI_ADMIN_SECRET>            -> full sync now
//   ?secret=…&limit=25                     -> small test batch first
// A scheduled wrapper (platform-tn-mirror-cron) calls syncTnToPlatform() every few min.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { fetchKanban } = require('./_lib/board-mirror');

const TN_COMPANY = '7b421706-4951-4d79-b070-4d4bcbc37c47';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Xano scheduling_status/current_status -> platform job.status (kept to a safe small set).
function mapStatus(j) {
  const s = String(j.scheduling_status || j.current_status || '').toLowerCase();
  if (s.includes('complet')) return 'completed';
  if (s.includes('progress')) return 'in_progress';
  if (s.includes('await')) return 'awaiting_parts';
  if (s.includes('cancel')) return 'canceled';
  if (s === 'scheduled') return 'scheduled';       // needs_scheduled / not_ready fall through
  return 'new';
}

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url, key };
}

// Bulk-read the newest TDR (repair report) per job from Xano (metadata API, table 12).
// Gives us real repair data — diagnosis, failed part, labor, repair-done, parts-needed —
// which the board feed doesn't carry. Newest TDR per job wins (id desc). Best-effort:
// a token/read failure returns {} so the mirror still runs on board data alone.
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
async function fetchTdrMap() {
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!token) return {};
  const map = {};
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  for (let page = 1; page <= 4; page++) {
    let rows = [];
    try {
      const r = await fetch(`${META}/table/12/content/search`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ sort: { id: 'desc' }, per_page: 500, page }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) break;
      rows = (await r.json()).items || [];
    } catch (_) { break; }
    if (!rows.length) break;
    for (const t of rows) {
      const jid = Number(t.job_id || 0);
      if (!jid || map[jid]) continue;   // id-desc → first seen = newest TDR, wins
      map[jid] = {
        diagnosis: String(t.diagnosis || ''),
        failed_component: String(t.failed_component || ''),
        part: String(t.verified_part_number || ''),
        repair_completed: String(t.repair_completed || ''),
        parts_needed: String(t.parts_needed || ''),
        labor_hours: (t.labor_hours != null && t.labor_hours !== '') ? Number(t.labor_hours) : null,
      };
    }
    if (rows.length < 500) break;
  }
  return map;
}
// A real part token in parts_needed = the job needed a return trip for parts (not first-stop).
function neededPartsTrip(pn) {
  const s = String(pn || '').trim();
  if (!s || /^(none|n\/a|na|no)$/i.test(s)) return false;
  return /[A-Za-z0-9][A-Za-z0-9.\-]{4,}/.test(s) && /\d/.test(s);
}

// PostgREST bulk upsert that returns the upserted rows (so we can read back the UUIDs).
async function upsert(url, key, table, rows, onConflict) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${table}_${r.status}_${JSON.stringify(d).slice(0, 240)}`);
    if (Array.isArray(d)) out.push(...d);
  }
  return out;
}

async function syncTnToPlatform(limit) {
  const t0 = Date.now();
  const { url, key } = await cfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };

  let items = await fetchKanban();
  // Only jobs with a real id + customer are mirrorable (write-once: customer is the anchor).
  let jobs = items.filter((j) => Number(j.id) && Number(j.customer_id));
  if (limit) jobs = jobs.slice(0, limit);
  if (!jobs.length) return { ok: false, error: 'no_mirrorable_jobs', ms: Date.now() - t0 };

  // 1) customers — dedup by Xano customer_id
  const custMap = new Map();
  for (const j of jobs) {
    const cid = Number(j.customer_id);
    if (!custMap.has(cid)) custMap.set(cid, {
      company_id: TN_COMPANY, xano_id: cid,
      first_name: String(j.customer_first || ''), last_name: String(j.customer_last || ''),
      phone: String(j.customer_phone || ''), city: String(j.service_city || ''),
      state: String(j.service_state || ''), zip: String(j.service_zip || ''),
    });
  }
  const upCust = await upsert(url, key, 'customer', [...custMap.values()], 'company_id,xano_id');
  const custIdByXano = new Map(upCust.map((r) => [Number(r.xano_id), r.id]));

  // 2) units — one serviced appliance per job (multi-machine refinement later)
  const unitRows = jobs.map((j) => ({
    company_id: TN_COMPANY, xano_id: Number(j.id),
    customer_id: custIdByXano.get(Number(j.customer_id)),
    kind: 'appliance',
    label: [String(j.brand || ''), String(j.appliance || '')].filter(Boolean).join(' ').trim() || 'Appliance',
    attributes: { brand: String(j.brand || ''), appliance: String(j.appliance || '') },
  })).filter((u) => u.customer_id);
  const upUnit = await upsert(url, key, 'unit', unitRows, 'company_id,xano_id');
  const unitIdByXanoJob = new Map(upUnit.map((r) => [Number(r.xano_id), r.id]));

  // Xano tech id -> platform technician uuid, so every job carries its tech and the
  // per-tech KPIs + leaderboard resolve. (Crew rows seeded with xano_tech_id.)
  const techByXano = new Map();
  try {
    const tr = await fetch(`${url}/rest/v1/technician?company_id=eq.${TN_COMPANY}&select=id,xano_tech_id`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000),
    });
    const td = await tr.json();
    if (Array.isArray(td)) td.forEach((x) => { if (x.xano_tech_id != null) techByXano.set(Number(x.xano_tech_id), x.id); });
  } catch (_) { /* leave techs unmapped rather than fail the whole mirror */ }

  // Real repair data per job (first-stop, diagnosis, part, labor) from the TDR table.
  const tdrMap = await fetchTdrMap();

  // 3) jobs
  const jobRows = jobs.map((j) => {
    const customer_id = custIdByXano.get(Number(j.customer_id));
    const unit_id = unitIdByXanoJob.get(Number(j.id));
    if (!customer_id || !unit_id) return null;
    const ss = Number(j.scheduled_start);
    const iso = ss > 0 ? new Date(ss).toISOString() : null;
    const eta = String(j.parts_eta_date || '').trim();
    const tdr = tdrMap[Number(j.id)] || null;
    const isCompleted = mapStatus(j) === 'completed';
    // First-stop = fixed on the visit with no return trip for parts. Only meaningful on a
    // completed job WITH a TDR; unknown (null) otherwise so it never fakes the rate.
    const firstStop = (isCompleted && tdr) ? !neededPartsTrip(tdr.parts_needed) : null;
    return {
      company_id: TN_COMPANY, xano_id: Number(j.id),
      customer_id, unit_id,
      technician_id: techByXano.get(Number(j.technician_id)) || null,
      status: mapStatus(j),
      tdr_diagnosis: tdr ? tdr.diagnosis : '',
      tdr_failed_component: tdr ? tdr.failed_component : '',
      tdr_part_number: tdr ? tdr.part : '',
      tdr_repair_completed: tdr ? tdr.repair_completed : '',
      tdr_parts_needed: tdr ? tdr.parts_needed : '',
      tdr_labor_hours: tdr ? tdr.labor_hours : null,
      first_stop: firstStop,
      problem: String(j.problem_summary || ''),
      source: String(j.intake_source || 'xano_mirror'),
      scheduled_start: iso,
      scheduled_day: iso ? iso.slice(0, 10) : null,
      availability: String(j.customer_preference_text || ''),
      // warranty + parts + RAW status — the source fields KPIs need (condemned /
      // first-stop / warranty pipeline) that the simplified `status` bucket drops.
      warranty_company: String(j.warranty_company || ''),
      claim_number: String(j.claim_number || ''),
      parts_status: String(j.parts_status || ''),
      parts_eta: /^\d{4}-\d{2}-\d{2}/.test(eta) ? eta.slice(0, 10) : null,
      xano_status: String(j.scheduling_status || ''),
      xano_current_status: String(j.current_status || ''),
      updated_at: new Date().toISOString(),
    };
  }).filter(Boolean);
  const upJob = await upsert(url, key, 'job', jobRows, 'company_id,xano_id');

  return { ok: true, customers: upCust.length, units: upUnit.length, jobs: upJob.length, ms: Date.now() - t0 };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  try {
    const out = await syncTnToPlatform(q.limit ? Number(q.limit) : 0);
    return json(200, out);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.syncTnToPlatform = syncTnToPlatform;

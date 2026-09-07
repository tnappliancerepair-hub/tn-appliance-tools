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

// The real TN tenant — "TN Appliance Exchange LLC" (created 9/3, full book + all 8 crew/office
// logins). Was pointed at the older 8/27 setup tenant (7b421706 / slug tn-appliance), which
// left the crew's tenant frozen; repointed 9/5 so the crew's My Day stays live with Xano.
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Xano scheduling_status/current_status -> platform job.status (kept to a safe small set).
function mapStatus(j) {
  const s = String(j.scheduling_status || j.current_status || '').toLowerCase();
  if (s.includes('complet')) return 'completed';
  if (s.includes('progress')) return 'in_progress';
  if (s.includes('await')) return 'awaiting_parts';
  if (s.includes('cancel')) return 'canceled';
  if (s === 'scheduled') return 'scheduled';
  // A job booked with a real day + a tech but whose Xano status still lags at
  // needs_scheduled/not_ready IS scheduled work — show it in the Scheduled column
  // (matches the office board's own "real day + a tech ⇒ Scheduled" rule).
  if (Number(j.scheduled_start) > 0 && j.technician_id != null && String(j.technician_id).trim() !== '' && String(j.technician_id) !== '0') return 'scheduled';
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

// Supplemental completeness pull: the mirror's main feed (get_office_kanban) is capped at
// 800 rows sorted created_at DESC, so an OLD-created dispatch scheduled for next week gets
// crowded out and never mirrors. This pulls EVERY active/upcoming job straight from the Xano
// jobs table (metadata table 7), keyed by scheduling_status — an EQUALITY filter, the only
// reliable metadata search (range/multi-field are unsupported), so nothing is dropped by a
// created_at cap or a null-ordering quirk. Returns rows normalized to the kanban item shape
// the row-builder reads (raw column is `appliance_type`; the builder reads `j.appliance`).
// Best-effort: any failure returns [] and the mirror runs on the board feed alone.
const ACTIVE_STATUSES = ['scheduled', 'awaiting_parts', 'in_progress', 'held', 'needs_scheduled', 'not_ready'];
async function fetchActiveJobs() {
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!token) return [];
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const out = [];
  const seen = new Set();
  for (const status of ACTIVE_STATUSES) {
    for (let page = 1; page <= 4; page++) {
      let rows = [];
      try {
        const r = await fetch(`${META}/table/7/content/search`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ search: { scheduling_status: status }, sort: { id: 'desc' }, per_page: 500, page }),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) break;
        rows = (await r.json()).items || [];
      } catch (_) { break; }
      if (!rows.length) break;
      for (const j of rows) {
        const id = Number(j.id || 0);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        // Normalize the one field name that differs between the raw table and the kanban feed.
        j.appliance = (j.appliance != null && j.appliance !== '') ? j.appliance : String(j.appliance_type || '');
        out.push(j);
      }
      if (rows.length < 500) break;
    }
  }
  return out;
}
// Newest warranty-claim reconcile snapshot: claim/call # -> { status (P=paid, R/W=rejected,
// S=approved, ...), paid_total, eft_num }. Powers Straight Shooter (vendor approved the call)
// + the warranty "collected" number. Best-effort: {} on any failure.
const XANO_PUB = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
async function fetchClaimMap() {
  try {
    const r = await fetch(`${XANO_PUB}/list_recent_event_log?action=sp_claim_sync_state&days_back=120&limit=1`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return {};
    const rows = ((await r.json()).items) || [];
    if (!rows.length) return {};
    let md = rows[0].metadata;
    if (typeof md === 'string') { try { md = JSON.parse(md); } catch (_) { md = {}; } }
    return (md && md.map) || {};
  } catch (_) { return {}; }
}
// A real part token in parts_needed = the job needed a return trip for parts (not first-stop).
function neededPartsTrip(pn) {
  const s = String(pn || '').trim();
  if (!s || /^(none|n\/a|na|no)$/i.test(s)) return false;
  return /[A-Za-z0-9][A-Za-z0-9.\-]{4,}/.test(s) && /\d/.test(s);
}

// A real street has a letter — a bare "1"/number-only is the AHS "1,City" placeholder, NOT an
// address. Never let a placeholder overwrite a good street. (get_office_kanban returns
// service_city/state/zip but NOT the street; the raw table-7 supp row carries service_address,
// so kanban-origin jobs borrow the street from their supp twin — see the custMap builder.)
function cleanStreet(v) {
  const s = String(v == null ? '' : v).trim();
  return /[A-Za-z]/.test(s) ? s : '';
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

async function syncTnToPlatform(limit, opts) {
  const t0 = Date.now();
  const dryrun = !!(opts && opts.dryrun);
  const { url, key } = await cfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };

  let items = await fetchKanban();
  const kanbanCount = items.length;
  // Merge in every active/upcoming job the 800-row created_at-capped board feed leaves out
  // (dedup by job id; the richer kanban row wins when a job is in both).
  const supp = await fetchActiveJobs();
  const supplementalCount = supp.length;
  // The raw table-7 supp rows carry the full job incl. service_address (the street). The kanban
  // feed does NOT, and the kanban row wins in the merge below — so a kanban-origin job borrows
  // the street from its supp twin via this lookup (keyed by Xano job id).
  const suppById = new Map();
  for (const s of supp) { const id = Number(s.id); if (id) suppById.set(id, s); }
  const streetFor = (j) => cleanStreet(j.service_address) || cleanStreet((suppById.get(Number(j.id)) || {}).service_address);
  let addedFromSupp = 0;
  if (supp.length) {
    const have = new Set(items.map((j) => Number(j.id)));
    for (const s of supp) { const id = Number(s.id); if (id && !have.has(id)) { have.add(id); items.push(s); addedFromSupp++; } }
  }
  // Only jobs with a real id + customer are mirrorable (write-once: customer is the anchor).
  let jobs = items.filter((j) => Number(j.id) && Number(j.customer_id));
  if (limit) jobs = jobs.slice(0, limit);
  if (!jobs.length) return { ok: false, error: 'no_mirrorable_jobs', ms: Date.now() - t0 };

  if (dryrun) {
    const startTodayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const future = jobs.filter((j) => Number(j.scheduled_start) >= startTodayMs).length;
    const scheduled = jobs.filter((j) => mapStatus(j) === 'scheduled').length;
    // Confirm Xano's rows actually carry a real street before any live write.
    let withStreet = 0; const streetSample = [];
    for (const j of jobs) {
      const st = streetFor(j);
      if (st) { withStreet++; if (streetSample.length < 5) streetSample.push({ id: Number(j.id), street: st, city: String(j.service_city || ''), zip: String(j.service_zip || '') }); }
    }
    return { ok: true, dryrun: true, kanban: kanbanCount, supplemental: supplementalCount, added_from_supplemental: addedFromSupp, merged: items.length, mirrorable: jobs.length, scheduled, future_scheduled: future, street_fill: withStreet, street_of_total: jobs.length, street_sample: streetSample, ms: Date.now() - t0 };
  }

  // 1) customers — dedup by Xano customer_id. The base upsert deliberately OMITS `address`:
  // merge-duplicates only updates columns present in the payload, so leaving it out PRESERVES
  // any existing street (migration/tee/portal-sourced) instead of clobbering it with a blank
  // when Xano's feed has no street for that job. The street is filled by a SEPARATE upsert below.
  const custMap = new Map();
  const addrMap = new Map(); // xano customer_id -> a clean street (only when we actually have one)
  for (const j of jobs) {
    const cid = Number(j.customer_id);
    if (!custMap.has(cid)) custMap.set(cid, {
      company_id: TN_COMPANY, xano_id: cid,
      first_name: String(j.customer_first || ''), last_name: String(j.customer_last || ''),
      phone: String(j.customer_phone || ''), city: String(j.service_city || ''),
      state: String(j.service_state || ''), zip: String(j.service_zip || ''),
    });
    if (!addrMap.has(cid)) { const st = streetFor(j); if (st) addrMap.set(cid, st); }
  }
  const upCust = await upsert(url, key, 'customer', [...custMap.values()], 'company_id,xano_id');
  // Fill the street ONLY where we have a real one — never write a blank (additive, can't lose data).
  const addrRows = [...addrMap.entries()].map(([cid, address]) => ({ company_id: TN_COMPANY, xano_id: cid, address }));
  if (addrRows.length) await upsert(url, key, 'customer', addrRows, 'company_id,xano_id');
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
  // Warranty claim outcomes (approved/paid/rejected + $) keyed by claim/dispatch #.
  const claimMap = await fetchClaimMap();

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
    // Match the job to its claim outcome by claim# or dispatch#.
    const cl = claimMap[String(j.claim_number || '').trim()] || claimMap[String(j.dispatch_source_id || '').trim()] || null;
    const clStatus = cl ? String(cl.status || '').toUpperCase() : '';
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
      warranty_claim_status: clStatus,
      warranty_paid_cents: cl ? Math.round(Number(cl.paid_total || 0) * 100) : null,
      warranty_eft: cl ? String(cl.eft_num || '') : '',
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

  // Cross-dedup with the fresh-email loader (platform-warranty-tee). A dispatch the email
  // loader landed FIRST exists on the platform as a job with NO xano_id (createWarrantyJob
  // deduped it by claim_number). Our upsert keys only on (company_id,xano_id), so without
  // this it would INSERT a duplicate for that same dispatch. So BEFORE the upsert we ADOPT
  // each orphan tee job by stamping its xano_id -> the upsert then merges in place, one job
  // per dispatch regardless of which loader saw it first. Best-effort: any failure here just
  // leaves the (rare) dup for a later run; it must never break the mirror.
  try {
    const claimToXano = new Map();
    for (const jr of jobRows) {
      const cn = String(jr.claim_number || '').trim();
      if (cn && !claimToXano.has(cn)) claimToXano.set(cn, jr.xano_id);
    }
    const claims = [...claimToXano.keys()].filter((c) => /^[A-Za-z0-9._\-]+$/.test(c));
    for (let i = 0; i < claims.length; i += 100) {
      const chunk = claims.slice(i, i + 100);
      const inList = chunk.map((c) => '"' + c + '"').join(',');
      const r = await fetch(
        `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=is.null&claim_number=in.(${inList})&select=id,claim_number`,
        { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) },
      );
      const orphans = await r.json().catch(() => null);
      if (!Array.isArray(orphans)) continue;
      for (const o of orphans) {
        const xid = claimToXano.get(String(o.claim_number || '').trim());
        if (!xid) continue;
        await fetch(`${url}/rest/v1/job?id=eq.${o.id}`, {
          method: 'PATCH',
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ xano_id: xid }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }
    }
  } catch (_) { /* adoption is best-effort; the upsert still runs */ }

  const upJob = await upsert(url, key, 'job', jobRows, 'company_id,xano_id');

  return { ok: true, customers: upCust.length, units: upUnit.length, jobs: upJob.length, ms: Date.now() - t0 };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  try {
    const out = await syncTnToPlatform(q.limit ? Number(q.limit) : 0, { dryrun: q.dryrun === '1' });
    return json(200, out);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.syncTnToPlatform = syncTnToPlatform;

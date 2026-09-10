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

const { getSecret, primeXanoToken} = require('./_lib/secrets');
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
  // 4 pages = the newest 2,000 reports. Xano is at TDR id 2304 today, so an older job's
  // real report fell outside the window and read as "no report filed" - job 19988 had a
  // full diagnosis from Jimmy that the platform showed as blank. 8 pages covers every
  // report with headroom.
  //
  // CONCURRENT, not a serial loop. Widening 4 -> 8 pages the first time kept the sequential
  // fetch, which turned this into an 8 x 12s chain inside a cron that has a budget - and it
  // showed up immediately in the data: the run before the change wrote 1,150 jobs, every run
  // after wrote 25. Eight requests in one round trip is bounded by the SLOWEST page instead of
  // the SUM of them, so the window can widen without eating the run. Pages are merged in page
  // order (not completion order) to keep id-desc "first seen = newest TDR wins" exact, and
  // allSettled means one slow page costs its own rows, not the whole map. (2026-09-10)
  const PAGES = 8;
  const settled = await Promise.allSettled(
    Array.from({ length: PAGES }, (_, k) => k + 1).map(async (page) => {
      const r = await fetch(`${META}/table/12/content/search`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ sort: { id: 'desc' }, per_page: 500, page }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error('meta_' + r.status);
      return (await r.json()).items || [];
    })
  );
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    for (const t of res.value) {
      const jid = Number(t.job_id || 0);
      if (!jid || map[jid]) continue;   // id-desc, page order → first seen = newest TDR, wins
      map[jid] = {
        diagnosis: String(t.diagnosis || ''),
        failed_component: String(t.failed_component || ''),
        part: String(t.verified_part_number || ''),
        repair_completed: String(t.repair_completed || ''),
        parts_needed: String(t.parts_needed || ''),
        labor_hours: (t.labor_hours != null && t.labor_hours !== '') ? Number(t.labor_hours) : null,
      };
    }
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
// needs_more_info was the hole: a warranty dispatch lands there before it's accepted, the
// board feed doesn't return that status, and the six statuses below never asked for it - so
// brand-new SquareTrade/NSA/AHS work reached Xano and never reached the platform at all.
// Measured 2026-09-10: 11 real jobs from one week, every one a fresh warranty dispatch,
// which is the worst possible subset to be missing.
const ACTIVE_STATUSES = ['scheduled', 'awaiting_parts', 'in_progress', 'held', 'needs_scheduled', 'not_ready', 'needs_more_info'];

// ...but that status also holds ~430 dead claim shells with no name, no phone and no
// appliance. Mirroring those would bury the practice board in junk, so apply the same
// real-job test board-audit uses: a real job has a name, a usable phone, or an appliance.
function isRealJob(j) {
  let name = String(j.customer_first || j.customer_last || '').trim();
  const full = (String(j.customer_first || '') + ' ' + String(j.customer_last || '')).trim();
  if (/pending\s*review|^\(|^unknown\b|^n\/?a$|^test\b/i.test(full)) name = '';
  const ph = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
  let appl = String(j.appliance_type || j.appliance || '').trim().toLowerCase();
  if (appl === 'other' || appl === 'appliance' || appl === 'unknown') appl = '';
  return !!(name || ph.length >= 10 || appl);
}
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
        // Only screen the shell-heavy status; the other six are already real work and an
        // over-eager filter there would silently drop jobs the board has always shown.
        if (status === 'needs_more_info' && !isRealJob(j)) continue;
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

// One-time MANUAL recovery (?recover_addr=1): fill customer.address from Xano's CUSTOMER table
// (table 6, street = service_address/address/street) for TN customers currently BLANK on the
// platform. The Sep-3 migration sourced address from table 6, but the every-5-min mirror only
// carries the job denorm — so customer-table streets the jobs feed lacks were never mirrored
// (and a transient bug briefly blanked ~200). BLANK-ONLY + additive: it NEVER overwrites an
// existing address (protects job-denorm + portal-corrected values). Paged (cursor) so a grind
// loop stays under the function limit. NOT wired into the cron.
async function recoverCustomerStreets(url, key, startPage, maxPages) {
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!token) return { ok: false, error: 'no_xano_token' };
  // 1) platform TN customers currently blank on address -> Set of xano_id (paged, PostgREST 1000 cap)
  const blank = new Set();
  for (let from = 0; from < 40000; from += 1000) {
    const r = await fetch(`${url}/rest/v1/customer?company_id=eq.${TN_COMPANY}&or=(address.is.null,address.eq.)&select=xano_id`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Range: `${from}-${from + 999}` },
      signal: AbortSignal.timeout(12000),
    });
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const c of rows) if (c.xano_id != null) blank.add(Number(c.xano_id));
    if (rows.length < 1000) break;
  }
  // 2) page Xano customer table 6; collect a street ONLY for blanks that have a real one
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const fillRows = [];
  let scanned = 0, page = startPage, pagesDone = 0, done = false;
  for (; pagesDone < maxPages; page++, pagesDone++) {
    let rows = [];
    try {
      const r = await fetch(`${META}/table/6/content/search`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ sort: { id: 'asc' }, per_page: 500, page }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) break;
      rows = (await r.json()).items || [];
    } catch (_) { break; }
    if (!rows.length) { done = true; break; }
    scanned += rows.length;
    for (const o of rows) {
      const cid = Number(o.id);
      if (!cid || !blank.has(cid)) continue;
      const st = cleanStreet(o.service_address || o.address || o.street);
      if (st) fillRows.push({ company_id: TN_COMPANY, xano_id: cid, address: st });
    }
    if (rows.length < 500) { done = true; break; }
  }
  let filled = 0;
  if (fillRows.length) { const up = await upsert(url, key, 'customer', fillRows, 'company_id,xano_id'); filled = up.length; }
  return { ok: true, blank_customers: blank.size, scanned, filled, next_page: done ? null : page, done };
}

// ── ONE-SHOT: backfill technician reports onto COMPLETED jobs ───────────────────
// The every-5-min mirror only walks ACTIVE_STATUSES, so a job that has since been
// completed is never revisited - and 2,279 of TN's mirrored jobs carried 19 reports
// between them while Xano held the real thing. That history is exactly what the
// platform has to own before TN can run on it full-time: what we found, which part,
// how long. Additive and BLANK-ONLY - it writes a report only where the platform has
// none, so it can never overwrite a report a tech filed on the platform itself.
// Manual: ?backfill_tdr=1 (add &dryrun=1 to count first). (2026-09-10)
async function backfillTdr(url, key, dryrun) {
  const tdrMap = await fetchTdrMap();
  const ids = Object.keys(tdrMap).map(Number).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'no_tdrs' };
  const need = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).join(',');
    const r = await fetch(
      `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk})&or=(tdr_diagnosis.is.null,tdr_diagnosis.eq.)&select=xano_id`,
      { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(12000) },
    );
    const rows = await r.json().catch(() => null);
    if (Array.isArray(rows)) rows.forEach((x) => need.push(Number(x.xano_id)));
  }
  if (dryrun) return { ok: true, dryrun: true, tdrs: ids.length, missing_report: need.length };
  // Uniform key set on every row - a mixed shape is what PGRST102'd the main upsert.
  const rows = need.map((xid) => {
    const t = tdrMap[xid];
    return {
      company_id: TN_COMPANY, xano_id: xid,
      tdr_diagnosis: t.diagnosis, tdr_failed_component: t.failed_component,
      tdr_part_number: t.part, tdr_repair_completed: t.repair_completed,
      tdr_parts_needed: t.parts_needed, tdr_labor_hours: t.labor_hours,
    };
  }).filter((r) => r.tdr_diagnosis || r.tdr_failed_component || r.tdr_part_number);
  const up = await upsert(url, key, 'job', rows, 'company_id,xano_id');
  return { ok: true, tdrs: ids.length, missing_report: need.length, filled: up.length };
}

async function syncTnToPlatform(limit, opts) {
  const t0 = Date.now();
  const dryrun = !!(opts && opts.dryrun);
  const { url, key } = await cfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };

  // NEVER let the heavy board feed take the whole mirror down with it. get_office_kanban
  // measured 43.8s on 2026-09-10 and fetchKanban throws on abort - so one slow minute on
  // Xano killed the entire run before the supplemental pull (raw table 7) had even started,
  // and the platform went stale. That is backwards: the supplemental source is FASTER and
  // carries MORE (model, serial, street, claim); the kanban feed only adds older/completed
  // jobs it happens to have. Losing it should cost those extras, not the mirror.
  let items = [];
  let kanbanError = '';
  // 15s, not the 70s board-mirror-sync waits: this feed is a bonus here, not the source.
  try { items = await fetchKanban(15000); }
  catch (e) { kanbanError = String((e && e.message) || e).slice(0, 120); }
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
  // Same borrow for the model + serial. get_office_kanban drops BOTH (verified 2026-09-10:
  // its 27 keys carry brand and appliance but no model), while the raw table-7 row has
  // model_number + serial_number populated. Without this the mirror can answer "Kenmore
  // dryer" but not "which one" — and job-truth's tech lens reads the model straight off it.
  const pick = (j, ...keys) => {
    const twin = suppById.get(Number(j.id)) || {};
    // Take the first NON-EMPTY value from either row. Checking `!= null` instead would
    // stop at the kanban row's empty string and never reach the twin that has the value.
    for (const k of keys) {
      const a = String(j[k] || '').trim(); if (a) return a;
      const b = String(twin[k] || '').trim(); if (b) return b;
    }
    return '';
  };
  const modelFor = (j) => pick(j, 'model_number', 'appliance_model');
  const serialFor = (j) => pick(j, 'serial_number');
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
    // Confirm the model actually RESOLVES before trusting a live write - the kanban feed
    // has no model column at all, so this only works if the supplemental twin is found.
    const withModel = jobs.filter((j) => modelFor(j)).length;
    const modelSample = jobs.filter((j) => modelFor(j)).slice(0, 3).map((j) => ({ id: j.id, model: modelFor(j), serial: serialFor(j) }));
    return { ok: true, dryrun: true, kanban: kanbanCount, kanban_error: kanbanError || undefined, supplemental: supplementalCount, added_from_supplemental: addedFromSupp, merged: items.length, mirrorable: jobs.length, scheduled, future_scheduled: future, street_fill: withStreet, street_of_total: jobs.length, street_sample: streetSample, model_fill: withModel, model_sample: modelSample, ms: Date.now() - t0 };
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
    // model + serial ride here so every surface reading the mirror can name the exact
    // machine. attributes is a single jsonb column and merge-duplicates replaces it whole,
    // so these keys must always be present — writing them conditionally would blank a
    // model on the next run for any job whose row happened to arrive without one.
    attributes: { brand: String(j.brand || ''), appliance: String(j.appliance || ''), model: modelFor(j), serial: serialFor(j) },
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
      // Only write the report when we HAVE one. Writing '' on a miss erased good data:
      // fetchTdrMap breaks out on any slow/failed Xano page, and it only ever held the
      // newest ~2,000 reports, so an older job's real report read as "no report filed" and
      // then got blanked on the platform. merge-duplicates only touches columns present in
      // the payload, so omitting these preserves whatever is already mirrored. (2026-09-10)
      ...(tdr ? {
        tdr_diagnosis: tdr.diagnosis,
        tdr_failed_component: tdr.failed_component,
        tdr_part_number: tdr.part,
        tdr_repair_completed: tdr.repair_completed,
        tdr_parts_needed: tdr.parts_needed,
        tdr_labor_hours: tdr.labor_hours,
      } : {}),
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
    // A warranty CLAIM is not a job. SquareTrade issues a new work order per trip, so one
    // claim routinely covers several Xano jobs — and taking the first one meant stamping an
    // id that a sibling dispatch already owned. Every run tried the same doomed updates and
    // the client-side catch swallowed them, so nothing surfaced but Postgres logged an error
    // each time: ~3,000 a day, 84% of this database's error volume, hiding everything else.
    // Adopt only from a claim that maps to exactly ONE Xano job; anything else is a guess.
    const claimCount = new Map();
    for (const jr of jobRows) {
      const cn = String(jr.claim_number || '').trim();
      if (cn) claimCount.set(cn, (claimCount.get(cn) || 0) + 1);
    }
    const claimToXano = new Map();
    for (const jr of jobRows) {
      const cn = String(jr.claim_number || '').trim();
      if (cn && claimCount.get(cn) === 1 && !claimToXano.has(cn)) claimToXano.set(cn, jr.xano_id);
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
      // Belt and braces: never attempt an id another row already holds. The unique index
      // would reject it anyway - the point is to not ask, so the log stays readable.
      const wanted = [...new Set(orphans.map((o) => claimToXano.get(String(o.claim_number || '').trim())).filter(Boolean))];
      const taken = new Set();
      if (wanted.length) {
        try {
          const tr = await fetch(`${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=in.(${wanted.join(',')})&select=xano_id`,
            { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
          for (const t of (await tr.json().catch(() => [])) || []) taken.add(Number(t.xano_id));
        } catch (_) {}
      }
      for (const o of orphans) {
        const xid = claimToXano.get(String(o.claim_number || '').trim());
        if (!xid || taken.has(Number(xid))) continue;
        await fetch(`${url}/rest/v1/job?id=eq.${o.id}`, {
          method: 'PATCH',
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ xano_id: xid }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }
    }
  } catch (_) { /* adoption is best-effort; the upsert still runs */ }

  // ── DO NOT WALK A TECH'S WORK BACKWARDS (Teddy 2026-09-08) ──────────────────────
  // THE BUG THIS FIXES: this mirror rewrites job.status from XANO on every run (every
  // 5 min). TN is mid-migration, so a tech working in the PLATFORM would complete a job
  // there, and minutes later the mirror would overwrite his 'completed' back to Xano's
  // stale 'scheduled'. To the tech that is indistinguishable from "the new system didn't
  // save" — which is exactly what Jimmy reported. Proven on Clifford Allison's washer:
  // his job_tdr, completed_at AND waiver all saved, but status had been reverted.
  //
  // THE RULE: the mirror may move a job FORWARD, never backward. Xano stays the source of
  // truth for work that hasn't been touched on the platform; the moment a human does
  // something on the platform, that progress wins until Xano catches up.
  const RANK = { new: 0, scheduled: 1, in_progress: 2, awaiting_parts: 3, completed: 4, canceled: 4 };
  try {
    const xids = jobRows.map((r) => r.xano_id).filter(Boolean);
    const cur = new Map();
    for (let i = 0; i < xids.length; i += 200) {
      const chunk = xids.slice(i, i + 200).join(',');
      const r = await fetch(
        `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk})&select=xano_id,status,completed_at`,
        { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(12000) },
      );
      const rows = await r.json().catch(() => null);
      if (Array.isArray(rows)) rows.forEach((x) => cur.set(Number(x.xano_id), x));
    }
    let held = 0;
    for (const jr of jobRows) {
      const ex = cur.get(Number(jr.xano_id));
      if (!ex) continue;                                   // brand-new job: take Xano's status
      const wasDone = !!ex.completed_at;                   // a platform completion we must not undo
      const back = (RANK[ex.status] ?? -1) > (RANK[jr.status] ?? -1);
      if (back || (wasDone && jr.status !== 'completed' && jr.status !== 'canceled')) {
        jr.status = ex.status;                             // keep the platform's further-along state
        held++;
      }
    }
    if (held) console.log('[tn-mirror] kept platform status on ' + held + ' job(s) the mirror would have reverted');
  } catch (e) {
    // Never let this guard break the mirror — worst case is today's behavior.
    console.error('[tn-mirror] status-guard skipped: ' + String((e && e.message) || e));
  }

  // PostgREST requires every object in a bulk upsert to carry an IDENTICAL key set, and
  // rejects the whole batch with PGRST102 "All object keys must match" when they differ.
  // That collides head-on with the report keys above, which are deliberately OMITTED on a
  // miss so merge-duplicates can't blank a good report. One mixed array = a 400 that fails
  // all 1,174 rows at once - and it did: the job upsert stopped landing entirely while every
  // other write in the run kept succeeding, so the platform quietly went stale and only the
  // OTHER writers' rows carried a fresh updated_at. Split by shape instead; each group is
  // internally uniform and both keep the omit-on-miss semantics. (2026-09-10)
  const withTdr = jobRows.filter((r) => 'tdr_diagnosis' in r);
  const noTdr = jobRows.filter((r) => !('tdr_diagnosis' in r));
  const upJob = [
    ...(withTdr.length ? await upsert(url, key, 'job', withTdr, 'company_id,xano_id') : []),
    ...(noTdr.length ? await upsert(url, key, 'job', noTdr, 'company_id,xano_id') : []),
  ];

  return { ok: true, customers: upCust.length, units: upUnit.length, jobs: upJob.length, kanban: kanbanCount, kanban_error: kanbanError || undefined, ms: Date.now() - t0 };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  await primeXanoToken();   // 4KB budget: token lives in the vault, not env
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  try {
    if (q.recover_addr === '1') {
      const { url, key } = await cfg();
      if (!url || !key) return json(200, { ok: false, error: 'platform supabase not configured' });
      const out = await recoverCustomerStreets(url, key, q.page ? Number(q.page) : 1, q.pages ? Number(q.pages) : 4);
      return json(200, out);
    }
    if (q.backfill_tdr === '1') {
      const { url, key } = await cfg();
      if (!url || !key) return json(200, { ok: false, error: 'platform supabase not configured' });
      return json(200, await backfillTdr(url, key, q.dryrun === '1'));
    }
    const out = await syncTnToPlatform(q.limit ? Number(q.limit) : 0, { dryrun: q.dryrun === '1' });
    return json(200, out);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.syncTnToPlatform = syncTnToPlatform;

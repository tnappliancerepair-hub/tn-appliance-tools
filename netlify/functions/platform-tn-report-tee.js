// platform-tn-report-tee — carry TN's TECHNICIAN REPORTS and OFFICE NOTES from legacy Xano
// onto the ANT Platform tenant, so the practice board shows the same work Xano shows.
//
// READ-ONLY toward Xano (Xano stays the system of record). Writes ONLY into the platform
// Supabase, TN's own tenant, joined on the xano_id the mirror already stamps on every job.
//
// WHY THIS EXISTS: platform-tn-mirror copies a job's report into job.tdr_* columns, but the
// tech app and the office board's report panel both read the job_tdr TABLE. Measured
// 2026-09-10: 617 TN jobs carry report data in those columns and job_tdr held 13 rows - so
// on the practice board essentially every job read "No technician report filed yet" while
// Xano had the diagnosis, the failed part and the part number all along.
//
// Office notes are the other half. Danielle's note is how a tech knows what to bring
// ("Hisense sent part for this", "have one on the truck for the customer to buy"). Those
// live in the Xano event_log and had no platform path at all.
//
// NEVER CLOBBERS A HUMAN. Both writes are fill-the-blank only: a field already filled on the
// platform is left exactly as it is, because during practice week a tech may file a report
// HERE that Xano has never seen, and a mirror that overwrites it is indistinguishable from
// "the new system didn't save" - the same failure we fixed on job.status in September.
//
//   GET ?secret=<admin>                        forward run (newest reports + recent notes)
//   GET ?secret=…&dryrun=1                     show what WOULD land, write nothing
//   GET ?secret=…&mode=backfill&page=P         walk every report id-ascending, returns next_page
//   Tunables (vault): PLATFORM_REPORT_TEE_ENABLED=false (kill switch),
//     PLATFORM_REPORT_TEE_FWD_TDR (reports per forward run, default 400),
//     PLATFORM_REPORT_TEE_NOTE_DAYS (note lookback, default 120)
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO_PUB = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TDR_TABLE = 12;
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function s(v) { return String(v == null ? '' : v).trim(); }
function blank(v) { return s(v) === ''; }

// One page of Xano's technician_decision_report table. dir 'desc' = newest first (forward
// run); 'asc' = stable cursor order (backfill).
async function tdrPage(token, page, dir) {
  const r = await fetch(`${META}/table/${TDR_TABLE}/content/search`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sort: { id: dir === 'asc' ? 'asc' : 'desc' }, per_page: 500, page }),
    signal: AbortSignal.timeout(14000),
  });
  if (!r.ok) throw new Error('tdr_read_' + r.status);
  return (await r.json()).items || [];
}

// A job can have several reports (pre-diagnosis by the owner, then the tech's). Newest wins,
// which is the one the office and the tech are looking at.
function newestPerJob(rows, into) {
  const map = into || new Map();
  for (const t of rows) {
    const jid = Number(t.job_id || 0);
    if (!jid) continue;
    const prev = map.get(jid);
    if (!prev || Number(t.id || 0) > Number(prev.id || 0)) map.set(jid, t);
  }
  return map;
}

// Only claim an outcome when the tech's own words are unambiguous. A guess here becomes a
// wrong first-stop-fix rate and a wrong warranty story, so an unclear report stays null and
// the platform simply shows no outcome - which is the truth.
function outcomeOf(t) {
  const txt = (s(t.repair_completed) + ' ' + s(t.final_recommendation)).toLowerCase();
  if (!txt.trim()) return null;
  if (/\b(not repairable|unrepairable|condemn|replace the unit|beyond repair|no fix)\b/.test(txt)) return 'not_fixable';
  if (/\b(return|second visit|order(ing)? part|needs? part|awaiting part|come back)\b/.test(txt)) return 'return_needed';
  if (/\b(complete|completed|yes|fixed|repaired|working|resolved|done)\b/.test(txt)) return 'fixed';
  return null;
}

function labourOf(t) {
  const v = (t.labor_time_hours != null && t.labor_time_hours !== '') ? t.labor_time_hours : t.labor_hours;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The tech's prose, in the order a human would want to read it. Deduped so a report that
// repeats itself across fields does not read like a stutter on the tech's phone.
function notesOf(t) {
  const parts = [s(t.technician_notes), s(t.failure_description), s(t.failure_cause_notes), s(t.diagnostic_test_performed)];
  const seen = new Set(); const out = [];
  for (const p of parts) { const k = p.toLowerCase(); if (p && !seen.has(k)) { seen.add(k); out.push(p); } }
  return out.join('\n\n');
}

function techOf(t) {
  return [s(t.technician_first_name), s(t.technician_last_name)].filter(Boolean).join(' ');
}

// Map every Xano job id we hold a report for onto its platform job, plus the unit it hangs
// off (brand/model live there, and the report card shows them).
async function platformJobs(url, key, xanoIds) {
  const out = new Map();
  for (let i = 0; i < xanoIds.length; i += 150) {
    const chunk = xanoIds.slice(i, i + 150);
    const r = await fetch(
      `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk.join(',')})&select=id,xano_id,office_notes,unit:unit_id(label,attributes)`,
      { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(14000) },
    );
    const rows = await r.json().catch(() => null);
    if (Array.isArray(rows)) for (const j of rows) out.set(Number(j.xano_id), j);
  }
  return out;
}

// What the platform already holds, so we can fill blanks and touch nothing else.
async function existingReports(url, key, jobIds) {
  const out = new Map();
  for (let i = 0; i < jobIds.length; i += 150) {
    const chunk = jobIds.slice(i, i + 150);
    const r = await fetch(
      `${url}/rest/v1/job_tdr?company_id=eq.${TN_COMPANY}&job_id=in.(${chunk.map((x) => '"' + x + '"').join(',')})&select=job_id,brand,model,appliance,symptom,failed_component,part_number,root_cause,outcome,notes,tech,part_status,labor_hours`,
      { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(14000) },
    );
    const rows = await r.json().catch(() => null);
    if (Array.isArray(rows)) for (const x of rows) out.set(String(x.job_id), x);
  }
  return out;
}

async function upsert(url, key, table, rows, onConflict) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
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
    if (!r.ok) throw new Error(`${table}_${r.status}_${JSON.stringify(d).slice(0, 200)}`);
    if (Array.isArray(d)) n += d.length;
  }
  return n;
}

// ── OFFICE NOTES ────────────────────────────────────────────────────────────────────
// Xano's office notes are event_log rows, one per note, newest last. The platform keeps a
// single office_notes textarea per job, so we join a job's notes into one block in the order
// they were written. Deliberately NOT thread_message: the customer portal reads that table
// with no channel filter, and "have one on the truck for the customer to buy" is not a
// sentence the customer should ever see.
async function fetchOfficeNotes(days) {
  const r = await fetch(`${XANO_PUB}/list_recent_event_log?action=office_note&days_back=${days}&limit=500`, { signal: AbortSignal.timeout(14000) });
  if (!r.ok) throw new Error('note_read_' + r.status);
  const items = ((await r.json()).items) || [];
  const byJob = new Map();
  for (const row of items) {
    let md = row.metadata;
    if (typeof md === 'string') { try { md = JSON.parse(md); } catch (_) { md = null; } }
    if (!md) continue;
    const jid = Number(md.job_id || 0);
    const text = s(md.text);
    if (!jid || !text) continue;
    const when = Number(md.at_ms || row.created_at || 0);
    if (!byJob.has(jid)) byJob.set(jid, []);
    byJob.get(jid).push({ text, when, by: s(md.by) || 'office' });
  }
  for (const list of byJob.values()) list.sort((a, b) => a.when - b.when);
  return byJob;
}

function noteBlock(list) {
  return list.map((n) => {
    const d = n.when ? new Date(n.when).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }) : '';
    return (d ? d + ' — ' : '') + n.text;
  }).join('\n\n');
}

// The whole run, callable in-process by the scheduled wrapper. Returns a plain object; the
// HTTP handler is a thin shell around it.
async function runTee(opts) {
  const dry = !!(opts && opts.dry);
  const backfill = !!(opts && opts.backfill);
  const t0 = Date.now();

  const enabled = s(await getSecretFresh('PLATFORM_REPORT_TEE_ENABLED')).toLowerCase();
  if (enabled === 'false' || enabled === '0') return { ok: true, skipped: 'disabled' };

  const url = s(await getSecret('PLATFORM_SUPABASE_URL')).replace(/\/+$/, '');
  const key = s(await getSecret('PLATFORM_SUPABASE_SERVICE_KEY'));
  const token = s(await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!url || !key) return { ok: false, error: 'platform not configured' };
  if (!token) return { ok: false, error: 'XANO_METADATA_TOKEN not available' };

  const fwdTdr = Math.max(50, Math.min(2000, parseInt(await getSecretFresh('PLATFORM_REPORT_TEE_FWD_TDR'), 10) || 400));
  const noteDays = Math.max(1, Math.min(365, parseInt(await getSecretFresh('PLATFORM_REPORT_TEE_NOTE_DAYS'), 10) || 120));

  // 1) pull reports
  const startPage = Math.max(1, parseInt(opts && opts.page, 10) || 1);
  const wantPages = backfill ? 4 : Math.ceil(fwdTdr / 500);
  const byJob = new Map();
  let scanned = 0, page = startPage, done = false;
  try {
    for (let i = 0; i < wantPages; i++, page++) {
      const rows = await tdrPage(token, page, backfill ? 'asc' : 'desc');
      if (!rows.length) { done = true; break; }
      scanned += rows.length;
      newestPerJob(rows, byJob);
      if (rows.length < 500) { done = true; break; }
    }
  } catch (e) {
    return { ok: false, error: s(e && e.message) || 'tdr_read_failed', scanned };
  }

  const xanoIds = [...byJob.keys()];
  const jobMap = await platformJobs(url, key, xanoIds);
  const jobIds = [...jobMap.values()].map((j) => j.id);
  const have = await existingReports(url, key, jobIds);

  // 2) build fill-the-blank report rows
  const tdrRows = []; const sample = [];
  let noJob = 0, alreadyFull = 0;
  for (const [xid, t] of byJob) {
    const j = jobMap.get(xid);
    if (!j) { noJob++; continue; }
    const cur = have.get(String(j.id)) || {};
    const unit = j.unit || {};
    const attrs = (unit && unit.attributes) || {};
    const want = {
      brand: s(attrs.brand),
      model: s(t.model_number),
      appliance: s(attrs.appliance) || s(unit.label),
      symptom: s(t.problem_summary),
      failed_component: s(t.failed_component),
      part_number: s(t.verified_part_number) || s(t.oem_part_number),
      root_cause: s(t.diagnosis) || s(t.failure_cause),
      notes: notesOf(t),
      tech: techOf(t),
      part_status: s(t.parts_needed),
    };
    const row = { company_id: TN_COMPANY, job_id: j.id };
    let wrote = 0;
    for (const k of Object.keys(want)) {
      if (want[k] && blank(cur[k])) { row[k] = want[k]; wrote++; }
    }
    const lh = labourOf(t);
    if (lh != null && (cur.labor_hours == null || Number(cur.labor_hours) === 0)) { row.labor_hours = lh; wrote++; }
    const oc = outcomeOf(t);
    if (oc && blank(cur.outcome)) { row.outcome = oc; wrote++; }
    if (!wrote) { alreadyFull++; continue; }
    tdrRows.push(row);
    if (sample.length < 6) sample.push({ job: xid, fields: Object.keys(row).filter((k) => k !== 'company_id' && k !== 'job_id') });
  }

  // 3) office notes -> job.office_notes, blank-only
  let notesConsidered = 0, notePatches = [];
  try {
    const notesByJob = await fetchOfficeNotes(noteDays);
    notesConsidered = notesByJob.size;
    const noteXanoIds = [...notesByJob.keys()];
    const noteJobs = await platformJobs(url, key, noteXanoIds.filter((x) => !jobMap.has(x)));
    for (const [xid, list] of notesByJob) {
      const j = jobMap.get(xid) || noteJobs.get(xid);
      if (!j) continue;
      // Danielle may already have typed a note on the platform. Hers wins; we only fill an
      // empty box, so nothing she wrote here can be replaced by an older Xano copy.
      if (!blank(j.office_notes)) continue;
      const block = noteBlock(list);
      if (!block) continue;
      notePatches.push({ id: j.id, xano_id: xid, office_notes: block });
    }
  } catch (_) { /* notes are additive - never fail the report tee over them */ }

  if (dry) {
    return {
      ok: true, dry: true, mode: backfill ? 'backfill' : 'forward', ms: Date.now() - t0,
      reports: { scanned, jobs_with_a_report: byJob.size, matched_to_platform: byJob.size - noJob, no_platform_job: noJob, already_complete: alreadyFull, would_write: tdrRows.length, sample },
      office_notes: { jobs_with_notes: notesConsidered, would_fill: notePatches.length, sample: notePatches.slice(0, 3).map((p) => ({ job: p.xano_id, chars: p.office_notes.length })) },
      next_page: backfill && !done ? page : null,
    };
  }

  let wroteTdr = 0;
  try { wroteTdr = await upsert(url, key, 'job_tdr', tdrRows, 'job_id'); }
  catch (e) { return { ok: false, error: s(e && e.message), reports_attempted: tdrRows.length }; }

  let wroteNotes = 0;
  for (const p of notePatches) {
    try {
      const r = await fetch(`${url}/rest/v1/job?id=eq.${p.id}`, {
        method: 'PATCH',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ office_notes: p.office_notes }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) wroteNotes++;
    } catch (_) { /* one bad patch must not stop the rest */ }
  }

  return {
    ok: true, mode: backfill ? 'backfill' : 'forward', ms: Date.now() - t0,
    reports: { scanned, jobs_with_a_report: byJob.size, no_platform_job: noJob, already_complete: alreadyFull, written: wroteTdr },
    office_notes: { jobs_with_notes: notesConsidered, filled: wroteNotes },
    next_page: backfill && !done ? page : null,
  };
}

exports.runTee = runTee;

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  let out;
  try {
    out = await runTee({ dry: q.dryrun === '1' || q.dry === '1', backfill: q.mode === 'backfill', page: q.page });
  } catch (e) { out = { ok: false, error: s(e && e.message) || 'failed' }; }
  return json(200, out);
};

// Pure helpers exposed for unit tests only - no runtime caller.
exports._t = { outcomeOf, labourOf, notesOf, techOf, noteBlock, blank };

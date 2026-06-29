// v2-shadow — Phase 0 of the clean Supabase rebuild.
//
// A cloud-hosted v2 scheduling brain: clean JavaScript in a Netlify function
// (NO Mac, NO XanoScript), making the FULL auto-place decision (tech + day +
// time) for every job in the live needs-scheduled queue — then storing its call
// in Supabase and reconciling it against what the live system actually did.
//
// This is the SHADOW that earns "bulletproof": it runs against REAL traffic,
// touches NOTHING live, and gives a trending agreement % (v2-scoreboard.js).
// When agreement holds high for long enough, we cut the intake→schedule slice
// over to v2 with a rollback switch — slice by slice, never a big-bang flip.
//
// It is a faithful clean-room port of colony-loop/agents/job_intake_complete.js
// computeOffer() — same gates, same tech-by-zip, same profile constraints, same
// customer-availability honoring, same route clustering — but read-only and in
// normal JS instead of the brittle XS path we're migrating away from.
//
// Two predict tracks:
//   • queue          — the needs-scheduled queue (intake → schedule)
//   • awaiting_parts — jobs parked in awaiting_parts that never auto-return to a
//                      tech's day when the part lands (e.g. #19832 — John's missing
//                      1pm). Measures how often v2 would catch the re-placement
//                      before the office has to.
//
//   GET ?secret=<admin>[&predict=25][&parts=20][&reconcile=40][&dry=1]
//        predict   = max NEW queue jobs to decide this run (default 25)
//        parts     = max awaiting-parts jobs to decide this run (default 20)
//        reconcile = max prior predictions to check against reality (default 40)
//        dry=1     = compute + report, write NOTHING to Supabase
'use strict';

const supa = require('./_lib/supabase');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const INTAKE = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const FN_BASE = (process.env.NETLIFY_FUNCTIONS_BASE || 'https://tnapplianceexchange.net/.netlify/functions').replace(/\/+$/, '');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const T = (ms) => (AbortSignal && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;

async function getJSON(url) { const r = await fetch(url, { signal: T(9000) }); if (!r.ok) throw new Error(`${url.split('?')[0]} -> ${r.status}`); return r.json(); }
async function postJSON(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: T(9000) }); if (!r.ok) throw new Error(`${url.split('?')[0]} -> ${r.status}`); return r.json(); }

// ── engine constants (mirror job_intake_complete.js) ───────────────────────
const SYSTEM_MAX_JOBS_PER_DAY = 6;
const DEFAULT_JOB_DURATION_MS = 2 * 60 * 60 * 1000;
const SLOT_OFFSET_FROM_START_MS = 60 * 60 * 1000;
const PARTS_PENDING = new Set(['parts_needed', 'ordered', 'pending', 'on_order']);
const ALREADY_SCHEDULED = new Set(['scheduled', 'in_progress', 'completed', 'canceled', 'no_fix_possible', 'booked']);
const VENDOR_LOCKED = new Set(['squaretrade', 'st', 'servicepower', 'sp']);

// ── availability (compact port of colony-loop/availability.js) ─────────────
const DOW = { sun:0,sunday:0, mon:1,monday:1, tue:2,tues:2,tuesday:2, wed:3,weds:3,wednesday:3, thu:4,thur:4,thurs:4,thursday:4, fri:5,friday:5, sat:6,saturday:6 };
function ctDow(date) { const wd = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short'}).format(date).toLowerCase(); return DOW[wd] != null ? DOW[wd] : new Date(date).getDay(); }
function dayTokens(s) { const out = new Set(); const t = String(s||'').toLowerCase(); for (const [k,v] of Object.entries(DOW)) if (new RegExp(`\\b${k}s?\\b`).test(t)) out.add(v); if (/\bweekends?\b/.test(t)){out.add(0);out.add(6);} if (/\bweekdays?\b/.test(t)){[1,2,3,4,5].forEach(d=>out.add(d));} if (/\b(any ?time|any ?day|when ?ever|flexible|every ?day)\b/.test(t)){[0,1,2,3,4,5,6].forEach(d=>out.add(d));} return out; }
function splitSections(text){ const t=String(text||''); const am=t.match(/\bAVAIL[:\-]\s*([\s\S]*?)(?:\bUNAVAIL[:\-]|$)/i); const um=t.match(/\bUNAVAIL[:\-]\s*([\s\S]*)/i); let avail=am?am[1]:''; let unavail=um?um[1]:''; if(!am&&!um&&t.trim()) avail=t; return {avail:avail.trim(),unavail:unavail.trim()}; }
function parseAvailability(prefText, grid) {
  let gridAllowed = null;
  if (grid && typeof grid === 'object') { try { const g = typeof grid === 'string' ? JSON.parse(grid) : grid; if (Array.isArray(g.allowedDays)) gridAllowed = new Set(g.allowedDays.map(Number)); } catch(_){} }
  const { avail, unavail } = splitSections(prefText);
  const allowed = gridAllowed || dayTokens(avail);
  const blocked = dayTokens(unavail);
  const hasConstraints = (allowed && allowed.size > 0) || blocked.size > 0;
  return {
    hasConstraints,
    dayOk(date){ const d = ctDow(date); if (blocked.has(d)) return false; if (allowed && allowed.size && !allowed.has(d)) return false; return true; },
  };
}

// ── tech-profile constraints (port) ────────────────────────────────────────
const DOW_FULL = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const normList = (a) => (Array.isArray(a)?a:[]).map(s=>String(s||'').trim().toLowerCase()).filter(Boolean);
function matchAny(value, list){ const v=String(value||'').toLowerCase(); if(!v||!list||!list.length) return false; return list.some(x=>x&&(v.includes(x)||x.includes(v))); }
function normDays(arr){ const out=new Set(); for(const x of (arr||[])){ const s=String(x||'').trim().toLowerCase().replace(/[^a-z]/g,''); if(s.length<3) continue; for(const d of DOW_FULL) if(d.startsWith(s.slice(0,3))) out.add(d); } return out; }
function parseClock(raw){ let s=String(raw||'').trim().toLowerCase(); if(!s) return null; if(s==='noon') return 720; if(s==='midnight') return 0; const m=/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/.exec(s); if(!m) return null; let h=Number(m[1]); const min=Number(m[2]||0); const ap=m[3]; if(!Number.isFinite(h)||h>23||min>59) return null; if(ap){const pm=ap[0]==='p'; if(h===12)h=pm?12:0; else if(pm)h+=12;} return h*60+min; }
function profileConstraints(p){ if(!p||typeof p!=='object') return null; const stops=Number(p.stops_max); return { daysOff:normDays(p.days_off_hard), startMin:parseClock(p.start_earliest), endMin:parseClock(p.end_latest), idealMin:parseClock(p.start_ideal), stopsMax:Number.isFinite(stops)&&stops>0?stops:null, areasAvoid:normList(p.areas_avoid), appliancesAvoid:normList(p.appliance_avoid) }; }
async function fetchTechProfile(techId){ try { const r=await fetch(`${FN_BASE}/get-tech-profile?tech_id=${techId}`,{signal:T(6000)}); if(!r.ok) return null; const j=await r.json(); return (j&&j.found&&j.profile)?j.profile:null; } catch(_){ return null; } }

function parseHHMM(s){ const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||'').trim()); if(!m) return null; const h=Number(m[1]),mm=Number(m[2]); if(h<0||h>23||mm<0||mm>59) return null; return h*60+mm; }
function chicagoMidnightMs(ymd){ const [y,mo,d]=ymd.split('-').map(Number); const probe=Date.UTC(y,mo-1,d,6,0,0); const h=parseInt(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'}).format(new Date(probe)),10); return probe - h*3600*1000; }
const ymdCT = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

// ── the v2 decision (faithful read-only port of computeOffer) ───────────────
// Returns one of:
//   {status:'gated', reason}            — not placeable yet (no prediag / parts)
//   {status:'vendor_locked'}            — date set by vendor
//   {status:'no_fit', reason}           — placeable but engine found no slot
//   {status:'predicted', tech, startMs, why, profile_applied, clustered}
// opts.ignoreParts — for the AWAITING-PARTS re-placement track: skip the
// parts-pending gate (the whole point is to predict who/when this goes BACK on a
// tech's day once the part is in). Sets snap.part_ready (eta passed/absent).
async function v2Decide(jobId, snap, opts = {}) {
  let ctxData;
  try { ctxData = await getJSON(`${INTAKE}/get_auto_schedule_context?job_id=${jobId}`); }
  catch (e) { return { status: 'no_fit', reason: 'context_load_failed' }; }
  if (!ctxData || !ctxData.success) return { status: 'no_fit', reason: 'context_missing' };

  const { job, customer, job_address, has_pre_diagnosis } = ctxData;
  snap.zip = (job_address?.service_zip || customer?.zip || '').trim();
  snap.city = (job_address?.service_city || customer?.city || '').trim();
  snap.appliance = String(job.appliance_type || '').trim();
  snap.warranty_company = String(job.warranty_company || '').trim();

  const schedStatus = String(job.scheduling_status || '').trim().toLowerCase();
  if (ALREADY_SCHEDULED.has(schedStatus)) return { status: 'gated', reason: 'already_' + schedStatus };

  const explicitLocked = job.vendor_locked === true;
  const legacyLocked = VENDOR_LOCKED.has(String(job.warranty_company||'').toLowerCase().replace(/[\s_-]/g,'')) && job.scheduled_start != null;
  if (explicitLocked || legacyLocked) return { status: 'vendor_locked' };

  if (!has_pre_diagnosis) return { status: 'gated', reason: 'no_prediag' };
  const partsStatus = String(job.parts_status || '').trim().toLowerCase();
  // Awaiting-parts track: note whether the part looks in (eta absent or passed),
  // and DON'T gate on parts — we want the re-placement pick regardless.
  if (opts.ignoreParts) {
    const eta = job.parts_eta_date ? new Date(job.parts_eta_date) : null;
    snap.part_ready = !(eta && !isNaN(eta) && eta.getTime() > Date.now());
  } else if (PARTS_PENDING.has(partsStatus)) {
    return { status: 'gated', reason: 'parts_' + partsStatus };
  }

  // green-light → compute the offer
  const zip = snap.zip;
  if (!zip) return { status: 'no_fit', reason: 'no_zip' };

  let routing;
  try { routing = await postJSON(`${INTAKE}/get_tech_for_zip`, { zip_code: zip, waiver_signed: true }); }
  catch (e) { return { status: 'no_fit', reason: 'tech_routing_failed' }; }
  const result = routing?.response?.result || routing?.result || routing;
  if (!result || result.status !== 'assigned' || !result.technician_id) return { status: 'no_fit', reason: 'no_tech_for_zip' };
  const techId = Number(result.technician_id);
  if (techId === 1) return { status: 'no_fit', reason: 'fallback_to_owner' };

  const pc = profileConstraints(await fetchTechProfile(techId));
  if (pc && matchAny(job.appliance_type, pc.appliancesAvoid)) return { status: 'no_fit', reason: 'tech_avoids_appliance' };
  if (pc && matchAny(snap.city, pc.areasAvoid)) return { status: 'no_fit', reason: 'tech_avoids_area' };

  // customer availability — fetch full job for the pref text/grid
  let prefText = job.customer_preference_text || '', availGrid = job.customer_availability_grid || null;
  if (!prefText) { try { const full = await postJSON(`${INTAKE}/get_job_for_dashboard`, { job_id: jobId }); const fj = (full && full.job) || {}; prefText = fj.customer_preference_text || ''; availGrid = fj.customer_availability_grid || availGrid; } catch(_){} }
  const avail = parseAvailability(prefText, availGrid);

  const partsEta = job.parts_eta_date ? new Date(job.parts_eta_date) : null;
  const baseDate = partsEta && !isNaN(partsEta) && partsEta.getTime() > Date.now()
    ? new Date(partsEta.getTime() + 86400000)
    : new Date(Date.now() + 86400000);

  const jobDurMin = DEFAULT_JOB_DURATION_MS / 60000;
  const candidates = [];
  for (let off = 0; off < 14; off++) {
    const cand = new Date(baseDate.getTime() + off * 86400000);
    const dowShort = cand.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' });
    if (dowShort === 'Sat' || dowShort === 'Sun') continue;
    if (!avail.dayOk(cand)) continue;
    const dowLower = cand.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).toLowerCase();
    if (pc && pc.daysOff.has(dowLower)) continue;

    const ymd = ymdCT(cand.getTime());
    const dayStartMs = chicagoMidnightMs(ymd);
    const dayEndMs = dayStartMs + 86400000;

    let con;
    try { con = await getJSON(`${INTAKE}/get_tech_constraints_for_date?technician_id=${techId}&date_ymd=${encodeURIComponent(ymd)}&day_start_ms=${dayStartMs}&day_end_ms=${dayEndMs}&day_of_week_lower=${encodeURIComponent(dowLower)}`); }
    catch (e) { continue; }
    if (!con || !con.success || con.full_day_off) continue;

    let maxJobs = con.max_jobs_per_day || SYSTEM_MAX_JOBS_PER_DAY;
    if (pc && pc.stopsMax) maxJobs = Math.min(maxJobs, pc.stopsMax);
    if (con.existing_job_count >= maxJobs) continue;

    let startW = parseHHMM(con.working_start || '08:00');
    let endW = parseHHMM(con.working_end || '16:00');
    if (startW == null) continue;
    if (endW == null) endW = startW + 480;
    if (pc && pc.startMin != null) startW = Math.max(startW, pc.startMin);
    if (pc && pc.endMin != null) endW = Math.min(endW, pc.endMin);
    if (endW - startW < jobDurMin) continue;

    let slotMin = (pc && pc.idealMin != null) ? Math.max(startW, pc.idealMin) : startW + (SLOT_OFFSET_FROM_START_MS / 60000);
    if (slotMin + jobDurMin > endW) slotMin = endW - jobDurMin;
    if (slotMin < startW) slotMin = startW;

    candidates.push({ startMs: dayStartMs + slotMin * 60000, existing: Number(con.existing_job_count) || 0 });
    if (candidates.length >= 6) break;
  }
  if (!candidates.length) return { status: 'no_fit', reason: 'no_open_day', profile_applied: !!pc };

  const chosen = candidates.find((c) => c.existing > 0) || candidates[0];
  const bits = ['fits his day'];
  if (avail.hasConstraints) bits.push('customer availability');
  if (pc) bits.push('his profile');
  const why = bits.join(' + ') + (chosen.existing > 0 ? ' + route-clustered' : '');
  return { status: 'predicted', tech: techId, startMs: chosen.startMs, why, profile_applied: !!pc, clustered: chosen.existing > 0 };
}

// reality lookup for reconcile
function startToMs(v) { if (v == null) return null; if (typeof v === 'number') return v; const n = Number(v); if (Number.isFinite(n) && n > 1e12) return n; const p = Date.parse(v); return Number.isFinite(p) ? p : null; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // scheduled invocations have no secret; allow them. manual hits must match.
  const scheduled = !!event.headers && (event.headers['x-nf-event'] === 'schedule' || event.headers['X-Nf-Event'] === 'schedule');
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (!(await supa.isConnected())) return json(200, { ok: false, error: 'supabase_not_configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)' });

  const predictCap = Math.max(0, Math.min(60, parseInt(q.predict, 10) || 25));
  const partsCap = Math.max(0, Math.min(60, parseInt(q.parts, 10) || 20));
  const reconcileCap = Math.max(0, Math.min(100, parseInt(q.reconcile, 10) || 40));
  const dry = q.dry === '1';

  const out = { ok: true, dry, predicted: 0, reconciled: 0, gone: 0, errors: [], samples: [] };

  // ---- RECONCILE pass: did reality place jobs we already predicted? ----
  try {
    const pend = await supa.select('v2_shadow_decisions', { status: 'in.(predicted,no_fit)', reconciled_at: 'is.null', order: 'created_at.asc', limit: String(reconcileCap), select: 'job_id,status,predicted_tech,predicted_day' });
    for (const row of (pend || [])) {
      try {
        const full = await postJSON(`${INTAKE}/get_job_for_dashboard`, { job_id: row.job_id });
        const j = (full && full.job) || {};
        const ss = String(j.scheduling_status || '').toLowerCase();
        if (ss === 'canceled') { if (!dry) await supa.update('v2_shadow_decisions', { job_id: `eq.${row.job_id}` }, { status: 'gone', reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString() }); out.gone++; continue; }
        const actualTech = j.technician_id != null ? Number(j.technician_id) : null;
        const actualMs = startToMs(j.scheduled_start);
        if (!actualTech || !actualMs) continue; // not placed yet — leave pending
        const actualDay = ymdCT(actualMs);
        const patch = {
          status: 'reconciled', actual_tech: actualTech, actual_day: actualDay, actual_start_ms: actualMs,
          tech_match: row.predicted_tech != null ? Number(row.predicted_tech) === actualTech : null,
          day_match: row.predicted_day ? row.predicted_day === actualDay : null,
          reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        if (!dry) await supa.update('v2_shadow_decisions', { job_id: `eq.${row.job_id}` }, patch);
        out.reconciled++;
      } catch (e) { out.errors.push(`reconcile ${row.job_id}: ${String(e.message || e).slice(0, 80)}`); }
    }
  } catch (e) { out.errors.push(`reconcile_select: ${String(e.message || e).slice(0, 120)}`); }

  // ---- PREDICT pass: decide NEW queue jobs we haven't seen ----
  try {
    const seenRows = await supa.select('v2_shadow_decisions', { select: 'job_id', limit: '5000' });
    const seen = new Set((seenRows || []).map((r) => Number(r.job_id)));

    // decide + record one job under a given origin. Returns true if recorded.
    async function processOne(jobId, origin, opts) {
      if (!jobId || seen.has(jobId)) return false;
      seen.add(jobId);
      const snap = { zip: '', city: '', appliance: '', warranty_company: '', part_ready: null };
      let dec;
      try { dec = await v2Decide(jobId, snap, opts); }
      catch (e) { out.errors.push(`decide ${jobId}: ${String(e.message || e).slice(0, 80)}`); return false; }
      const row = {
        job_id: jobId, origin, part_ready: snap.part_ready,
        status: dec.status,
        predicted_tech: dec.tech != null ? dec.tech : null,
        predicted_day: dec.startMs ? ymdCT(dec.startMs) : null,
        predicted_start_ms: dec.startMs || null,
        why: dec.why || null,
        no_fit_reason: dec.reason || null,
        profile_applied: !!dec.profile_applied,
        clustered: !!dec.clustered,
        zip: snap.zip || null, city: snap.city || null, appliance: snap.appliance || null, warranty_company: snap.warranty_company || null,
      };
      if (!dry) { try { await supa.insert('v2_shadow_decisions', row); } catch (e) { out.errors.push(`insert ${jobId}: ${String(e.message || e).slice(0, 80)}`); return false; } }
      out.predicted++;
      if (out.samples.length < 14) out.samples.push({ job_id: jobId, origin, status: dec.status, tech: row.predicted_tech, day: row.predicted_day, part_ready: snap.part_ready, why: row.why || row.no_fit_reason });
      return true;
    }

    // Pass A — the needs-scheduled queue (intake → schedule).
    let queue = await getJSON(`${INTAKE}/list_needs_scheduled_parallel?limit=80`);
    let items = (queue && (queue.items || queue.jobs)) || (Array.isArray(queue) ? queue : []);
    let madeA = 0;
    for (const it of items) { if (madeA >= predictCap) break; if (await processOne(Number(it && (it.id || it.job_id)), 'queue', {})) madeA++; }
    out.queue_size = items.length;

    // Pass B — the AWAITING-PARTS re-placement track. These jobs are parked in
    // awaiting_parts and (like #19832) never auto-return to a tech's day when the
    // part lands — a human has to catch them. v2 predicts who/when it'd re-place
    // each (parts gate bypassed); reconcile then measures how often v2 would have
    // caught it before the office had to. part_ready flags whether the part looks in.
    // (read via the metadata API — jobs table, scheduling_status=awaiting_parts.
    //  the list_awaiting_parts_jobs function endpoint isn't deployed in Xano.)
    let pitems = [];
    try { pitems = await crud.searchPage(crud.TABLES.jobs, { scheduling_status: 'awaiting_parts' }, { id: 'desc' }, 80) || []; }
    catch (e) { out.errors.push(`awaiting_parts_list: ${String(e.message || e).slice(0, 80)}`); }
    let madeB = 0;
    for (const it of pitems) { if (madeB >= partsCap) break; if (await processOne(Number(it && (it.id || it.job_id)), 'awaiting_parts', { ignoreParts: true })) madeB++; }
    out.awaiting_parts_queue = pitems.length;
    out.awaiting_parts_predicted = madeB;
  } catch (e) { out.errors.push(`predict: ${String(e.message || e).slice(0, 120)}`); }

  out.summary = `predicted ${out.predicted} (incl ${out.awaiting_parts_predicted || 0} awaiting-parts) · reconciled ${out.reconciled} · gone ${out.gone}${out.errors.length ? ' · ' + out.errors.length + ' errs' : ''}`;
  return json(200, out);
};

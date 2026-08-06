// flag-part-needed — the "🔧 Office, I need this part" one-tap from the TDR.
// When the owner/tech watches the video and diagnoses a part (e.g. "heating element
// WPW10295370"), this makes it OBVIOUS to the office in three ways at once:
//   1) sets jobs.parts_status='to_order'  -> the job jumps into the office board's
//      pulsing "🔩 Pre-Diagnosed · Needs Parts ASAP" column,
//   2) drops an office note "🔧 NEEDS PART: <part>" -> the tile shows the 📋 badge,
//   3) TEXTS Danielle + Sofia "Job #X needs <part>" -> it hits their phones.
//
// The alert carries the SERVICE DATE + a live PART ETA + a "beats the visit?" verdict
// (same race the Beat-the-Tech queue computes) so the office can act immediately:
// order now if it beats the tech, or order + move the day if it won't.
//
// PURELY ADDITIVE — does not touch the video→text→owner flow or the existing TDR submit.
//   POST { job_id, part, component?, by? }  ->  { ok, flagged, noted, texted, timing, ... }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');
const msupply = require('./_lib/msupply');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const ORDERED = /(awaiting_parts|ordered|on_order|backorder|arrived)/i;
const BUFFER_DAYS = 1; // land at least this many days before the visit (matches parts-beat-tech)
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function s(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 80); }
function dayMs(v) { const t = typeof v === 'number' ? v : Date.parse(String(v || '')); return isFinite(t) ? t : 0; }
function daysBetween(aMs, bMs) { return Math.round((bMs - aMs) / 86400000); }
// Short, friendly date ("Thu Aug 7") in America/Chicago — the way we talk about days.
function fmtDay(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }); }
  catch (_) { return ''; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const part = s(b.part, 80);
  const component = s(b.component, 60);
  const by = s(b.by, 40) || 'pre-diagnosis';
  if (!jobId || !part) return json(400, { ok: false, error: 'job_id and part required' });

  // The job row gives us the SERVICE DATE (scheduled_start), brand + zip (for the ETA
  // lookup), and the current parts_status (for the order guard). One read, reused below.
  let job = {};
  try { job = (await crud.searchOne(crud.TABLES.jobs, { id: jobId })) || {}; } catch (_) {}
  const visitMs = dayMs(job.scheduled_start);

  // Customer + appliance for the alert copy. Best-effort, never blocks the flag.
  let cust = {}, appl = '';
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    cust = (d && d.customer) || {};
    appl = String((d && d.appliance && d.appliance.type) || (d && d.job && d.job.appliance_type) || job.appliance_type || '').trim();
  } catch (_) { appl = String(job.appliance_type || '').trim(); }
  const who = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || 'customer';
  const partLabel = (component ? component + ' ' : '') + part;

  // 1) Flag the job -> lands in the board's "🔩 Needs Parts ASAP" column. (Same as
  // flag-parts-to-order: skip if it already has an ETA / is already ordered.)
  let flagged = false;
  try {
    const cur = String(job.parts_status || '').toLowerCase();
    const eta = String(job.parts_eta_date || '').trim();
    if (!eta && !ORDERED.test(cur)) {
      await crud.update(crud.TABLES.jobs, jobId, { parts_status: 'to_order' });
      await crud.logEvent('parts_to_order_flagged', { job_id: jobId, part, component, via: 'tdr_needs_part_button', by, at_ms: Date.now() });
      flagged = true;
    }
  } catch (_) {}

  // LIVE part ETA (Marcone) + "beats the visit?" verdict — the actionable half. Best-
  // effort with a hard 6s cap so a slow/flaky lookup never blocks the office alert.
  let etaDays = null, inStock = null, beats = null;
  try {
    const zip = String(cust.zip || cust.zip_code || job.service_zip || '').slice(0, 5);
    const r = await Promise.race([
      msupply.lookupPart(part, job.brand || '', { zip }),
      new Promise((res) => setTimeout(() => res(null), 6000)),
    ]);
    if (r && r.ok) { etaDays = (r.eta_days == null ? null : Number(r.eta_days)); inStock = !!r.in_stock; }
  } catch (_) {}
  if (etaDays != null && visitMs) beats = (etaDays + BUFFER_DAYS) <= daysBetween(Date.now(), visitMs);

  // Human timing line, reused in the SMS, the office note, and the button result.
  const visitStr = visitMs ? fmtDay(visitMs) : 'not scheduled yet';
  const etaStr = etaDays != null ? ('~' + etaDays + 'd' + (inStock ? ' · in stock' : '')) : 'unknown';
  const verdict = beats === true ? '✅ order now — the part beats the visit'
    : beats === false ? '⚠️ part will MISS the visit — order now + move the day'
    : (visitMs ? '' : '📦 order now, schedule around arrival');
  const timing = `Visit: ${visitStr} · Part ETA: ${etaStr}` + (verdict ? ' — ' + verdict : '');

  // 2) Office note -> the 📋 badge on the tile, carrying the exact part + the timing.
  let noted = false;
  try {
    await crud.logEvent('office_note', { job_id: jobId, text: '🔧 NEEDS PART: ' + partLabel + ' — pre-diagnosed by ' + by + '. ' + timing, by: 'pre-diag', at_ms: Date.now() });
    noted = true;
  } catch (_) {}

  // 3) Text Danielle + Sofia — obvious, on their phones, with the race baked in.
  // Deduped per job+part (24h) so a re-tap doesn't re-spam.
  const partKey = part.toLowerCase().replace(/[^a-z0-9]/g, '');
  let already = false;
  try {
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'part_needed_alert' }, { id: 'desc' }, 60);
    already = (prior || []).some((r) => { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m && String(m.job_id) === String(jobId) && String(m.part_key || '') === partKey && Number(m.at_ms || 0) > Date.now() - 86400000; });
  } catch (_) {}

  const texted = [];
  if (!already) {
    const msg = `🔧 PART NEEDED — Job #${jobId}: ${who}${appl ? ' (' + appl + ')' : ''} needs ${partLabel}. Pre-diagnosed by ${by}.\n${timing}`;
    const danielle = (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713';
    const sofia = (await getSecret('OFFICE_CELL_SOFIA')) || '+16292594602';
    for (const [name, cell] of [['Danielle', danielle], ['Sofia', sofia]]) {
      try { await sendSms(cell, msg, 'office', 'part_needed'); texted.push(name); } catch (_) {}
    }
    try { await crud.logEvent('part_needed_alert', { job_id: jobId, part, part_key: partKey, component, by, texted, service_date: job.scheduled_start || null, eta_days: etaDays, beats_visit: beats, at_ms: Date.now() }); } catch (_) {}
  }

  return json(200, {
    ok: true, flagged, noted, texted, already_alerted: already, part: partLabel,
    service_date: job.scheduled_start || null, eta_days: etaDays, in_stock: inStock,
    beats_visit: beats, timing,
  });
};

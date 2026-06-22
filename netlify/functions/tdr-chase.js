// tdr-chase — the upstream nudge that keeps the Frontdoor invoice queue full.
// A tech finishes a warranty job but leaves the report (TDR) missing the BILLABLE
// fields — labor hours and/or what they fixed. Danielle can't invoice that job, so
// it sits and we don't get paid. This texts the assigned tech a one-tap link to
// finish it. Two modes:
//   • CRON (no job_id): scan recent completed AHS/HSA/Frontdoor jobs, nudge each
//     tech once/day for any job missing labor hrs or repair notes. CT business
//     hours only (9–6, Mon–Sat).
//   • MANUAL (?key=tn-frontdoor-2026&job_id=N): nudge that one job now (the
//     "Nudge tech" button on frontdoor-invoices.html). Bypasses the hour guard.
// Dedup: event_log action=tdr_chase_sent_<job_id> within 1 day. Spec:
// docs/frontdoor-portal-workflows-2026-06-22.md

'use strict';

const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const KEY = 'tn-frontdoor-2026';
const FD_VENDORS = ['ahs', 'hsa', 'frontdoor', 'americanhome', 'american home shield'];
const MAX_PER_RUN = 12;
// Andre's tech row stores his LA cell; the 615 silently gates. Force the 504.
const PHONE_OVERRIDE = { 3: '5049099413' };

function ctHour() { return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false })); }
function ctDow() { return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short' }); }
async function jfetch(url, opts, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 12000);
  try { const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {})); return await r.json(); }
  catch (_) { return null; } finally { clearTimeout(t); }
}
function digits(s) { return String(s || '').replace(/\D/g, ''); }
function has(v) { return !(v == null || v === '' || v === 0 || v === '0'); }

// missing billable fields → what to ask the tech for
function gaps(b, m) {
  const t = (b && b.tdr) || {};
  const out = [];
  if (!has(t.labor_time_hours) && !has(m && m.tdr_labor_hours)) out.push('labor hours');
  if (!has(t.repair_completed) && !has(m && m.tdr_repair_completed)) out.push('what you fixed');
  return out;
}

async function alreadyChased(jobId) {
  const d = await jfetch(`${XANO}/list_recent_event_log?action=tdr_chase_sent_${jobId}&days_back=1&limit=1`, null, 8000);
  return !!(d && d.count > 0);
}

async function nudge(b, m) {
  const jobId = (b && b.job_id) || (m && m.job_id);
  const tech = b && b.tech;
  if (!tech || !tech.id) return { job_id: jobId, sent: false, reason: 'no tech' };
  const phone = PHONE_OVERRIDE[tech.id] || digits(tech.phone);
  if (phone.length < 10) return { job_id: jobId, sent: false, reason: 'no phone' };
  const need = gaps(b, m);
  if (need.length === 0) return { job_id: jobId, sent: false, reason: 'complete' };

  const first = (tech.first_name || 'there').trim();
  const cust = ((b.customer && b.customer.first_name) || '').trim();
  const appl = [b.brand, b.appliance_type].filter(Boolean).join(' ') || 'job';
  const link = `${SITE}/tech-job.html?job_id=${jobId}&tech_id=${tech.id}`;
  const body = `Ant: job #${jobId}${cust ? ' (' + cust + ')' : ''} — ${appl} is done but the warranty report needs ${need.join(' + ')} before we can bill it. 30 sec to finish so you get paid: ${link}`;

  const ok = await sendSms(phone, body, 'tech', 'tdr_chase');
  await crud.logEvent('tdr_chase_sent_' + jobId, { job_id: jobId, technician_id: tech.id, missing: need, vendor: (m && m.warranty_company) || '', at_ms: Date.now() });
  return { job_id: jobId, sent: !!ok, tech: first, missing: need };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const manual = !!q.job_id;
  if (manual && q.key !== KEY) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };

  // ── MANUAL: nudge one job now (from the queue button) ──
  if (manual) {
    const jobId = parseInt(digits(q.job_id), 10);
    if (await alreadyChased(jobId)) return { statusCode: 200, body: JSON.stringify({ ok: true, sent: false, reason: 'Already nudged today' }) };
    const bd = await jfetch(`${XANO}/get_warranty_card_bundle_for_jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids_csv: String(jobId) }) }, 12000);
    const b = bd && bd.bundles && bd.bundles[0];
    if (!b) return { statusCode: 200, body: JSON.stringify({ ok: true, sent: false, reason: 'job not found' }) };
    const res = await nudge(b, null);
    return { statusCode: 200, body: JSON.stringify(Object.assign({ ok: true }, res)) };
  }

  // ── CRON: business hours, Mon–Sat ──
  const h = ctHour();
  if (h < 9 || h >= 18 || ctDow() === 'Sun') return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'off-hours' }) };

  const list = await jfetch(`${XANO}/find_recent_completed_warranty_jobs?days_back=21&limit=120`, null, 15000);
  let matches = (list && Array.isArray(list.matches)) ? list.matches : [];
  // only truly-completed-ish warranty jobs with a billable gap
  matches = matches.filter((m) => {
    if (!FD_VENDORS.includes(String(m.warranty_company || '').toLowerCase())) return false;
    const s = String(m.job_current_status || m.job_scheduling_status || '').toLowerCase();
    if (!/complet|done|await|invoic/.test(s)) return false; // completed or awaiting-parts (report still needed)
    const need = (!has(m.tdr_labor_hours) ? 1 : 0) + (!has(m.tdr_repair_completed) ? 1 : 0);
    return need > 0;
  }).slice(0, MAX_PER_RUN * 2);
  if (matches.length === 0) return { statusCode: 200, body: JSON.stringify({ ok: true, scanned: 0, sent: 0 }) };

  const ids = matches.map((m) => m.job_id);
  const bd = await jfetch(`${XANO}/get_warranty_card_bundle_for_jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids_csv: ids.join(',') }) }, 15000);
  const bundles = {}; ((bd && bd.bundles) || []).forEach((b) => { bundles[b.job_id] = b; });

  let sent = 0; const results = [];
  for (const m of matches) {
    if (sent >= MAX_PER_RUN) break;
    if (await alreadyChased(m.job_id)) continue;
    const b = bundles[m.job_id];
    if (!b) continue;
    const r = await nudge(b, m);
    results.push(r);
    if (r.sent) sent++;
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, scanned: matches.length, sent, results }) };
};

// schedule-hold — tentative "placeholder" slots on the office scheduling board
// (HCP-style event). When Danielle offers a customer a day, she HOLDS the slot:
// a ghosted block appears on that tech's day, reserving her memory + the spot,
// without firmly booking it (so the TECH never sees it). She confirms it into a
// real appointment when the customer says yes, or releases it. No auto-expire —
// it sits until she acts. (Teddy 2026-07-03)
//
//   GET                         -> { ok, holds:[{job_id,tech_id,date,customer,appliance,at}] }  (active only)
//   POST { action:'hold', job_id, tech_id, date, customer?, appliance? }  -> { ok }
//   POST { action:'release', job_id }                                     -> { ok }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
async function events(action) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${action}&days_back=120&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    return (d && (d.items || d.rows)) || [];
  } catch (_) { return []; }
}
async function writeEvent(action, metadata) {
  const h = hdr(); if (!h) throw new Error('metadata token not configured');
  const r = await fetch(`${META}/table/${EVENT_LOG}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) });
  if (!r.ok) throw new Error('event_log ' + r.status);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'GET') {
    const [holds, clears] = await Promise.all([events('schedule_hold'), events('schedule_hold_cleared')]);
    // Latest clear ts per job.
    const clearedAt = {};
    for (const r of clears) { const m = asObj(r.metadata); const jid = Number(m.job_id || 0); const at = Number(r.created_at) || Number(m.at_ms) || 0; if (jid && at > (clearedAt[jid] || 0)) clearedAt[jid] = at; }
    // Latest hold per job; active only if newer than the latest clear.
    const latest = {};
    for (const r of holds) {
      const m = asObj(r.metadata); const jid = Number(m.job_id || 0); if (!jid) continue;
      const at = Number(r.created_at) || Number(m.at_ms) || 0;
      if (!latest[jid] || at > latest[jid].at) latest[jid] = { job_id: jid, tech_id: Number(m.tech_id || 0), date: String(m.date || ''), customer: String(m.customer || ''), appliance: String(m.appliance || ''), by: String(m.by || 'office'), time_pref: String(m.time_pref || ''), city: String(m.city || ''), zip: String(m.zip || ''), phone: String(m.phone || ''), at };
    }
    const active = Object.values(latest).filter((h) => h.at > (clearedAt[h.job_id] || 0) && h.date);
    return j(200, { ok: true, holds: active });
  }

  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const action = String(b.action || '');
  const jobId = Number(b.job_id || 0);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  try {
    if (action === 'hold') {
      const date = String(b.date || '').slice(0, 10);
      if (!date) return j(400, { ok: false, error: 'date required' });
      // `by` distinguishes an office-placed hold from a CUSTOMER self-schedule request
      // (Teddy 2026-08-12: "the customer's done their part; the office approves or reaches
      // back out"). time_pref carries what the customer asked for ("Friday afternoon").
      const by = String(b.by || 'office').slice(0, 20);
      await writeEvent('schedule_hold', { job_id: jobId, tech_id: Number(b.tech_id || 0), date, customer: String(b.customer || '').slice(0, 80), appliance: String(b.appliance || '').slice(0, 40), by, time_pref: String(b.time_pref || '').slice(0, 40), city: String(b.city || '').slice(0, 60), zip: String(b.zip || '').slice(0, 12), phone: String(b.phone || '').replace(/\D/g, '').slice(0, 11), at_ms: Date.now() });
      return j(200, { ok: true });
    }
    if (action === 'release') {
      await writeEvent('schedule_hold_cleared', { job_id: jobId, by: 'office', at_ms: Date.now() });
      return j(200, { ok: true });
    }
    return j(400, { ok: false, error: 'unknown action' });
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};

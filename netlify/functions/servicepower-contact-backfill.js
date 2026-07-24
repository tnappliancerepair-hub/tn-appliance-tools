// servicepower-contact-backfill — the fix for "we struggle with ServicePower jobs"
// (Teddy 2026-07-24). ServicePower/SquareTrade DISPATCH EMAILS carry only the claim #,
// not the customer phone — so those jobs land phone-less, and a phone-less job can't be
// sent the intake link OR called by the tech for a video. The whole flow dies on them.
//
// But the ServicePower API (getCallInfo) DOES carry the contact: Phone1 / Phone2 /
// CellPhone (+ email + street). Proven live on job 20732 (Mamie Dents -> 225-456-3629).
// This sweep reads the board, finds ServicePower jobs with no reachable phone, pulls the
// number from the API, and writes it onto the customer record (+ job denorm) via
// update-customer-name. Once the phone lands, intake-link-guarantee sends the link and
// the tech's Teddy Tool shows a working Call button — ServicePower jobs flow like the rest.
//
//   GET ?probe=1                    -> how many SP jobs are phone-less right now (no writes)
//   GET ?dryrun=1&secret=<admin>    -> exactly which phones WOULD be pulled + written (no writes)
//   GET ?live=1&secret=<admin>      -> pull + write this run
//   Scheduled cron                  -> live unless env SP_CONTACT_BACKFILL_LIVE=false
'use strict';
const sp = require('./_lib/servicepower');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const PER_RUN_CAP = Number(process.env.SP_CONTACT_BACKFILL_CAP) || 25;
const MAX_EXAMINE = Number(process.env.SP_CONTACT_BACKFILL_EXAMINE) || 80;
const TERMINAL = new Set(['completed', 'complete', 'canceled', 'cancelled', 'done', 'closed', 'no_fix_possible', 'not_needed']);

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '•••' + d.slice(-4) : (d || '—'); }
async function jget(u, ms = 9000) { try { const r = await fetch(u, { signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (_) { return {}; } }
async function jpost(u, b, ms = 12000) { try { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (_) { return {}; } }

async function boardJobs() {
  const d = await jget(`${XANO}/get_office_kanban`, 15000);
  return (Array.isArray(d) ? d : (d.jobs || d.items || d.rows || [])) || [];
}

// A ServicePower dispatch #: 10-12 digits (e.g. 011872784134). AHS claims are shorter
// (~8 digits) and won't match getCallInfo anyway, but this keeps us off the AHS API path.
function spCallNo(j) {
  const c = String(j.claim_number || '').replace(/\D/g, '');
  return c.length >= 10 ? c : '';
}
function isServicePower(j) {
  const wc = String(j.warranty_company || '').toLowerCase();
  if (/square|service\s*power|servicepower|allstate/.test(wc)) return true;
  return !!spCallNo(j);   // SP-format claim # is the reliable tell
}
// Best contact phone from a parsed getCallInfo call. ServicePower fills empty slots with "0".
function bestPhone(call) {
  for (const v of [call && call.phone1, call && call.cell, call && call.phone2]) {
    const d = String(v || '').replace(/\D/g, '');
    const p10 = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    if (p10.length === 10 && !/^0+$/.test(p10)) return p10;
  }
  return '';
}

// Does this job already have a reachable phone? (job field OR job-truth, same as the
// intake sender.) If yes, no backfill needed.
async function currentPhone(j) {
  const f = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
  if (f.length >= 10) return f;
  try {
    const tr = await jget(`${SITE}/.netlify/functions/job-truth?job_id=${encodeURIComponent(j.id)}&lens=office`, 8000);
    const p = String((tr && tr.facts && tr.facts.customer_phone) || '').replace(/\D/g, '');
    if (p.length >= 10) return p;
  } catch (_) {}
  return '';
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const ADMIN = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const scheduled = !!(event && event.body && (() => { try { return JSON.parse(event.body).next_run; } catch (_) { return false; } })());
  const dryrun = q.dryrun === '1' || q.dryrun === 'true';
  const probe = q.probe === '1' || q.probe === 'true';

  if ((dryrun || q.live === '1') && q.secret !== ADMIN) return json(401, { ok: false, error: 'admin secret required' });
  if (!(await sp.isConfigured())) return json(200, { ok: false, error: 'servicepower not configured (creds missing)' });

  const raw = await boardJobs();
  const candidates = raw.filter((j) => {
    const st = String(j.scheduling_status || j.current_status || '').toLowerCase();
    if (TERMINAL.has(st)) return false;
    return isServicePower(j) && !!spCallNo(j);
  });

  if (probe) {
    return json(200, { status: 'probe', board_total: raw.length, servicepower_active: candidates.length,
      note: 'live/dryrun then resolves current phone per job; only the phone-less ones hit the API' });
  }

  const liveEnv = String((await getSecret('SP_CONTACT_BACKFILL_LIVE')) || 'true').toLowerCase() !== 'false';
  const live = q.live === '1' ? true : (scheduled && liveEnv);

  let filled = 0, examined = 0, skipped_has_phone = 0, no_api_phone = 0, no_call_data = 0, failed = 0;
  const preview = [], done = [];

  for (const j of candidates) {
    if (filled >= PER_RUN_CAP) break;
    if (examined++ >= MAX_EXAMINE) break;

    const have = await currentPhone(j);
    if (have) { skipped_has_phone++; continue; }        // already reachable — nothing to do

    const callNo = spCallNo(j);
    let call = null;
    try { const r = await sp.getCallInfo({ callNo, fromDateTime: '', toDateTime: '' }); call = (r.calls || [])[0] || null; } catch (_) {}
    if (!call) { no_call_data++; continue; }
    const phone = bestPhone(call);
    if (!phone) { no_api_phone++; continue; }

    const email = String(call.email || '').trim();
    if (dryrun) {
      preview.push({ job_id: j.id, name: [call.first_name, call.last_name].filter(Boolean).join(' ') || j.customer_first, call_no: callNo, phone: mask(phone), email: email || '—' });
      filled++;
      continue;
    }

    // Write the phone onto the customer record (+ job denorm). Partial PUT preserves the
    // rest; update-customer-name syncs customer_phone onto the customer's jobs too.
    const w = await jpost(`${SITE}/.netlify/functions/update-customer-name`, { job_id: Number(j.id), phone, actor: 'servicepower_contact_backfill' });
    if (w && w.ok) {
      filled++; done.push({ job_id: j.id, phone: mask(phone) });
      try { await jpost(`${XANO}/record_event_log`, { action: 'sp_contact_backfilled', metadata_json: JSON.stringify({ job_id: j.id, call_no: callNo, phone_last4: phone.slice(-4), email: email || '', at_ms: Date.now() }) }); } catch (_) {}
    } else failed++;
  }

  if (dryrun) return json(200, { status: 'dryrun', board_total: raw.length, servicepower_active: candidates.length, examined, would_fill: filled, skipped_has_phone, no_api_phone, no_call_data, preview: preview.slice(0, 25) });
  if (!live) return json(200, { status: 'idle', servicepower_active: candidates.length, note: '?dryrun=1&secret= to preview, ?live=1&secret= to write, or let the cron run' });
  return json(200, { status: 'ran', board_total: raw.length, servicepower_active: candidates.length, examined, filled, skipped_has_phone, no_api_phone, no_call_data, failed, done });
};

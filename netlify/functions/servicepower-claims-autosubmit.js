// servicepower-claims-autosubmit — the automation that FILES SquareTrade claims by
// itself. Scans recently-COMPLETED (repair_complete) SquareTrade jobs, and for each one
// that hasn't been filed yet, runs it through servicepower-claims-submit.
//
//   SHADOW (default): builds each claim + logs the preview + any blockers. Files nothing.
//   LIVE: set env SP_CLAIM_AUTOSUBMIT_LIVE=true → scheduled runs actually submit.
//
// Scheduled hourly (netlify.toml). Manual: ?secret=<admin> [&dryrun=1].
// The per-job submitter (servicepower-claims-submit) does the real build + POST; this is
// just the driver: find completions, dedupe, rate-limit, digest.
'use strict';

const claims = require('./_lib/servicepower-claims');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const MAX_PER_RUN = Number(process.env.SP_CLAIM_AUTOSUBMIT_MAX) || 10;
const LOOKBACK_DAYS = Number(process.env.SP_CLAIM_AUTOSUBMIT_DAYS) || 5;
const SHADOW_COOLDOWN_MS = 6 * 3600 * 1000; // don't re-preview the same job within 6h

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function mdOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function jget(url, ms) { const r = await fetch(url, { signal: AbortSignal.timeout(ms || 12000) }); return r.json().catch(() => ({})); }
// job_id -> latest at_ms for an action (one fetch, filtered client-side)
async function markerMap(action, days) {
  const out = {};
  try {
    const d = await jget(`${XANO}/list_recent_event_log?action=${encodeURIComponent(action)}&days_back=${days || 30}&limit=400`);
    for (const r of (d.items || [])) {
      const m = mdOf(r); const jid = Number(m.job_id || 0); if (!jid) continue;
      const ms = Number(m.at_ms) || Number(r.created_at) || 0;
      if (!out[jid] || ms > out[jid]) out[jid] = ms;
    }
  } catch (_) {}
  return out;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // A provided secret must be correct; scheduled runs (no secret) are allowed (shadow is
  // harmless; live is gated by the env flag below).
  if (q.secret != null && q.secret !== admin) return json(401, { ok: false, error: 'bad secret' });
  if (!(await claims.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds not in vault' });

  const dry = q.dryrun === '1';
  const live = String(process.env.SP_CLAIM_AUTOSUBMIT_LIVE || '').toLowerCase() === 'true' && !dry;

  // 1) recently-completed jobs — repair_complete only (a parts-needed stop isn't done,
  //    so its claim isn't ready). Newest unique job_ids.
  let comp = [];
  try { const d = await jget(`${XANO}/list_recent_event_log?action=tech_job_complete&days_back=${LOOKBACK_DAYS}&limit=300`); comp = d.items || []; }
  catch (e) { return json(200, { ok: false, error: 'completion scan failed: ' + String((e && e.message) || e) }); }
  const seen = new Set(); const jobIds = [];
  for (const r of comp) {
    const m = mdOf(r);
    if (String(m.completion_type || '').toLowerCase() !== 'repair_complete') continue;
    const jid = Number(m.job_id || 0);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid); jobIds.push(jid);
  }

  // 2) dedupe sets (one fetch each)
  const submitted = await markerMap('sp_claim_submitted', 45);   // already FILED — never re-file
  const lastShadow = await markerMap('sp_claim_autosubmit', 3);   // shadow cooldown

  const results = []; let filed = 0, shadowed = 0, skipped = 0, notSt = 0;
  for (const jid of jobIds) {
    if (results.length >= MAX_PER_RUN) break;
    if (submitted[jid]) { skipped++; continue; }                 // already filed
    if (!live && lastShadow[jid] && (Date.now() - lastShadow[jid]) < SHADOW_COOLDOWN_MS) { skipped++; continue; }

    // SquareTrade only — resolve the vendor via job-truth (reliable warranty read).
    let vendor = '', custName = '', appliance = '', claimNo = '';
    try {
      const tr = await jget(`${SITE}/.netlify/functions/job-truth?job_id=${jid}&lens=office`, 8000);
      const f = (tr && tr.facts) || {};
      vendor = String(f.warranty_company || ''); custName = String(f.customer_name || f.customer_first || ''); appliance = String(f.appliance || ''); claimNo = String(f.claim_number || '');
    } catch (_) {}
    if (!/square\s*trade|servicepower|service ?power/i.test(vendor)) { notSt++; continue; }

    // Run it through the per-job submitter (shadow, or live w/ confirm).
    const url = `${SITE}/.netlify/functions/servicepower-claims-submit?secret=${encodeURIComponent(admin)}&job_id=${jid}` + (live ? '&live=1&confirm=1' : '');
    let rr = null;
    try { rr = await jget(url, 22000); } catch (e) { rr = { ok: false, error: String((e && e.message) || e) }; }

    try { await crud.logEvent('sp_claim_autosubmit', { job_id: jid, mode: (rr && rr.mode) || (live ? 'live' : 'shadow'), ok: !!(rr && rr.ok), vendor, customer: custName, appliance, claim_number: claimNo, blockers: (rr && rr.blockers) || [], response_code: (rr && rr.response_code) || '', at_ms: Date.now() }); } catch (_) {}

    if (rr && rr.mode === 'live' && rr.ok) filed++;
    else if (!live || (rr && rr.mode !== 'live')) shadowed++;
    results.push({ job_id: jid, vendor, mode: rr && rr.mode, ok: !!(rr && rr.ok), blockers: (rr && rr.blockers) || undefined, response_code: (rr && rr.response_code) || undefined });
  }

  const out = { ok: true, mode: live ? 'LIVE' : 'shadow', candidates: jobIds.length, examined: results.length, filed, shadowed, skipped_already_filed_or_cooldown: skipped, skipped_not_squaretrade: notSt, results };
  try { await crud.logEvent('sp_claim_autosubmit_run', { mode: out.mode, filed, shadowed, candidates: jobIds.length, at_ms: Date.now() }); } catch (_) {}
  return json(200, out);
};

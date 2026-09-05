// platform-warranty-tee — feeds NEW warranty dispatch emails onto the platform board.
//
// The productized intake path is the Cloudflare Email Worker on jobs.assistant247.net
// (a shop forwards to <slug>@jobs.assistant247.net). That pipe isn't deployed yet, so
// this tee is the no-Cloudflare bridge for TN's cutover: it reads the dispatch emails
// that already land in TN's Gmail (the same ones the legacy Xano pollers read), and POSTs
// each to platform-email-intake as <slug>@jobs.assistant247.net — so the SAME dispatch
// lands on BOTH the platform board AND Xano (true parallel run; Gmail reads are
// non-destructive, so the legacy system is untouched).
//
// Idempotent: platform-email-intake dedupes per (company, message_id) BEFORE it parses,
// so re-scanning a rolling window every cron tick is cheap (a single DB lookup for
// already-seen mail). We key message_id off the stable Gmail message id.
//
//   GET ?secret=<admin>[&dryrun=1]   (dryrun lists what WOULD land, sends nothing)
//   Kill switch: vault PLATFORM_WARRANTY_TEE_ENABLED=false
//   Tunables (vault): PLATFORM_WARRANTY_TEE_SLUG (default tn-appliance-exchange-llc),
//     PLATFORM_WARRANTY_TEE_WINDOW_HOURS (default 3), PLATFORM_WARRANTY_TEE_SUBJECT
//     (default "New Dispatch Notification"), or PLATFORM_WARRANTY_TEE_QUERY to fully
//     override the Gmail query.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');
const intake = require('./platform-email-intake');

const SLUG_DEFAULT = 'tn-appliance-exchange-llc';
const SUBJECT_DEFAULT = 'New Dispatch Notification';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function runTee(dry) {
  const enabled = String((await getSecret('PLATFORM_WARRANTY_TEE_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_WARRANTY_TEE_ENABLED=false' };

  const slug = (await getSecret('PLATFORM_WARRANTY_TEE_SLUG')) || SLUG_DEFAULT;
  const toAddr = slug + '@jobs.assistant247.net';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const emailSecret = (await getSecret('PLATFORM_EMAIL_SECRET')) || admin;

  let query = (await getSecret('PLATFORM_WARRANTY_TEE_QUERY')) || '';
  if (!query) {
    const hrs = parseInt((await getSecret('PLATFORM_WARRANTY_TEE_WINDOW_HOURS')) || '3', 10) || 3;
    const after = Math.floor(Date.now() / 1000) - hrs * 3600;   // Gmail accepts epoch-seconds in after:
    const subject = (await getSecret('PLATFORM_WARRANTY_TEE_SUBJECT')) || SUBJECT_DEFAULT;
    query = `after:${after} -in:sent subject:"${subject}"`;
  }

  let msgs = [];
  try { msgs = await readMany(query, { max: 40 }); } catch (e) { return { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }; }

  const out = { ok: true, dry: !!dry, slug, query, scanned: msgs.length, created: 0, deduped: 0, skipped: 0, results: [] };
  for (const m of msgs) {
    const brief = { id: m.id, from: String(m.from || '').slice(0, 44), subject: String(m.subject || '').slice(0, 60) };
    if (dry) { out.results.push({ ...brief, would_send: true }); continue; }
    const payload = { to: toAddr, from: m.from, subject: m.subject, text: m.body, message_id: 'gmail-' + m.id };
    try {
      const r = await intake.handler({ httpMethod: 'POST', queryStringParameters: { secret: emailSecret }, body: JSON.stringify(payload) });
      const d = JSON.parse((r && r.body) || '{}');
      const st = d.duplicate_email ? 'deduped' : (d.status || (d.ok ? 'ok' : 'error'));
      if (st === 'created') out.created++; else if (st === 'deduped' || d.duplicate_email) out.deduped++; else out.skipped++;
      out.results.push({ ...brief, status: st, jobs: (d.jobs || []).map((j) => ({ claim: j.claim, customer: j.customer, appliance: j.appliance })) });
    } catch (e) { out.skipped++; out.results.push({ ...brief, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  return out;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });
  const res = await runTee(q.dryrun === '1');
  return json(200, res);
};

exports.runTee = runTee;

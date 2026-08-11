// cash-in-notify — the "money in" backstop (Teddy 2026-08-11).
//
// verify-quickcheck already fires an instant 💵 siren the moment a cash Quick Check is
// paid — BUT only on the Stripe REDIRECT path. If the customer closes the tab before the
// redirect, the payment still records (webhook), the job still lands, and Teddy gets
// nothing distinct — the cash-out blends into the warranty new-job firehose. That's how
// a real cash job slipped past unnoticed.
//
// This sweep guarantees the ping. Every few minutes it reads recent quick_check_paid
// events and, for any GENUINE cash-out that hasn't already been announced, texts Teddy a
// clean, unmistakable "💰 CASH IN" alert. It never double-texts: verify-quickcheck writes
// a `cash_in_ping_<job>` marker when its instant siren fires, and this sweep checks it.
//
// GENUINE filter (kills the noise that made "cash" untrustworthy):
//   • amount >= $25   → drops the $1 test transactions
//   • name not "…Pivacek…" → drops Teddy's own test payments
//   (quick_check_paid is inherently the self-pay funnel, so warranty dupes like Brenda —
//    which never generate a paid Quick Check — can't reach here.)
//
// Scheduled (403 on manual curl is normal — verify via the cash_in_ping_<job> markers in
// event_log). Manual: ?secret=<admin>  ·  ?dry=1 lists who WOULD ping without sending.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';          // Teddy (his own cell — recipient only)
const SITE = 'https://tnapplianceexchange.net';
const LOOKBACK_MS = 3 * 3600000;       // only announce cash paid in the last 3h
const MIN_CENTS = 2500;                // ignore $1 test checks
const SCAN = 40;                       // recent quick_check_paid rows to scan

function j(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function metaOf(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function isTest(name) { return /pivacek/i.test(String(name || '')); }

exports.handler = async function (event) {
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const dry = q.dry === '1';

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'quick_check_paid' }, { created_at: 'desc' }, SCAN); } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : (rows && rows.items) || [];

  const now = Date.now();
  const pinged = [];
  for (const r of rows) {
    const m = metaOf(r);
    const jobId = Number(m.job_id || 0);
    if (!jobId) continue;
    const at = Number(m.at_ms || r.created_at || 0);
    if (!at || at < now - LOOKBACK_MS) continue;              // recent only
    const cents = Math.round(Number(m.amount || 0) * 100);
    if (cents < MIN_CENTS) continue;                          // no $1 tests
    if (isTest(m.name)) continue;                             // no owner test payments

    // Already announced (by the instant siren or a prior sweep)? skip — never double-text.
    let already = null;
    try { already = await crud.searchOne(crud.TABLES.event_log, { action: 'cash_in_ping_' + jobId }, { id: 'desc' }); } catch (_) {}
    if (already) continue;

    const amt = Number(m.amount || 0);
    const nm = String(m.name || 'a customer');
    const appl = String(m.machine || 'appliance');
    const town = m.town ? (' · ' + m.town) : '';
    const msg = '💰 CASH IN — $' + amt + ' · ' + nm + ' · ' + appl + town
      + ' · job #' + jobId + '. Paid online ✅  Set up the TDR → ' + SITE + '/teddy-tdr-tool.html?job_id=' + jobId;

    if (!dry) {
      try { await sendSms(OWNER, msg, 'owner', 'cash_in'); } catch (_) {}
      try { await crud.logEvent('cash_in_ping_' + jobId, { amount: amt, name: nm, machine: appl, source: 'sweep', at_ms: now }); } catch (_) {}
    }
    pinged.push({ job_id: jobId, amount: amt, name: nm, would_send: dry });
  }

  return j(200, { ok: true, pinged: pinged.length, jobs: pinged, dry });
};

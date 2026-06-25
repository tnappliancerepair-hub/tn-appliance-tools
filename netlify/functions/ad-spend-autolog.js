// ad-spend-autolog — logs the recurring Google Ads spend as a Books expense once
// per month, so the P&L always reflects ad cost without anyone remembering. The
// amount is the budgeted figure (vault AD_SPEND_MONTHLY, default $500); adjust a
// month's actual via the "Log expense" button if it differs.
//
// Dedup: one ad-spend log per calendar month (CT). Kill switch: AD_SPEND_AUTOLOG=false.
// Scheduled monthly in netlify.toml.
//   GET ?dryrun=1   show what it would log
//   GET ?force=1    log now even if this month already logged (manual catch-up)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctMonth() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 7); } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  const force = q.force === '1';
  if (String(await getSecret('AD_SPEND_AUTOLOG') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });

  const month = ctMonth();                       // e.g. "2026-06"
  const amount = parseFloat(await getSecret('AD_SPEND_MONTHLY') || '500') || 500;
  const markerAction = 'ad_spend_logged_' + month;

  // dedup: already logged this month?
  if (!force) {
    try {
      const seen = await crud.searchOne(crud.TABLES.event_log, { action: markerAction }, { id: 'desc' });
      if (seen) return json(200, { ok: true, skipped: 'already logged ' + month });
    } catch (_) {}
  }

  if (dry) return json(200, { ok: true, mode: 'dryrun', would_log: { category: 'ads', amount: amount.toFixed(2), label: 'Google Ads', month } });

  // log the expense via record-expense (same path the office "Log expense" uses)
  let logged = false;
  try {
    const r = await fetch('https://tnapplianceexchange.net/.netlify/functions/record-expense', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'ads', label: 'Google Ads', amount: amount.toFixed(2), scope: 'monthly', note: 'Auto-logged monthly ad spend (' + month + ')', logged_by: 'ad-spend-autolog', date_ms: Date.now() }),
      signal: AbortSignal.timeout(12000),
    });
    logged = r.ok;
  } catch (_) {}

  // marker so we don't double-log this month
  try { await crud.logEvent(markerAction, { amount: amount.toFixed(2), month, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, logged, month, amount: amount.toFixed(2) });
};

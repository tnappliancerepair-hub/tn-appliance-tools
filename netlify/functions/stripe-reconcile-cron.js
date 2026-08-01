// stripe-reconcile-cron — scheduled trigger for the payment reconciler. A schedule-
// registered fn is 403 on direct HTTP (and that would break the cash board's POST
// "assign payment" button), so the logic stays in the HTTP-callable stripe-reconcile
// core and this wrapper just invokes it a few times a day.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/stripe-reconcile?secret=${encodeURIComponent(admin)}&days=45`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String(e && e.message || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, matched: out && out.matched_count, unmatched: out && out.unmatched_count, err }) };
};

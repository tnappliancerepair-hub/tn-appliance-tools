// pm-approve — the PM taps the approve link from pm-charge (over-threshold hold). The TOKEN
// authorizes it (no admin secret needed — it's a one-time tokenized link, like a payment
// link). GET shows the pending charge; POST approves it and runs the charge server-side
// (via pm-charge with the server's own admin secret + approved=true), then marks it used.
//
//   GET  ?token=<token>        -> { ok, status:'pending'|'used'|'not_found', company, amount_cents, job_id }
//   POST { token }             -> charges the card; { ok, status:'charged'|... }
'use strict';
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const SITE = 'https://tnapplianceexchange.net';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v) => String(v == null ? '' : v).trim();
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
async function findByAction(action, perPage) {
  const r = await fetch(`${META}/table/3/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { action }, sort: { id: 'desc' }, per_page: perPage || 300 }) });
  if (!r.ok) return [];
  return ((await r.json()).items) || [];
}
async function logRow(action, metadata) { try { await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action, metadata }) }); } catch (_) {} }

async function lookup(token) {
  const pend = (await findByAction('pm_charge_pending')).map((r) => r.metadata || {}).find((m) => m.token === token);
  if (!pend) return { status: 'not_found' };
  const used = (await findByAction('pm_charge_approved')).some((r) => (r.metadata || {}).token === token);
  return { status: used ? 'used' : 'pending', pending: pend };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'GET') {
      const token = s((event.queryStringParameters || {}).token);
      if (!token) return json(400, { ok: false, error: 'token required' });
      const r = await lookup(token);
      if (r.status === 'not_found') return json(200, { ok: true, status: 'not_found' });
      const p = r.pending;
      return json(200, { ok: true, status: r.status, company: p.company, amount_cents: p.amount_cents, job_id: p.job_id, description: p.description });
    }
    if (event.httpMethod === 'POST') {
      let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
      const token = s(b.token);
      if (!token) return json(400, { ok: false, error: 'token required' });
      const r = await lookup(token);
      if (r.status === 'not_found') return json(404, { ok: false, error: 'not_found' });
      if (r.status === 'used') return json(200, { ok: true, status: 'already_charged' });
      const p = r.pending;
      // Run the charge with approved=true using the server's own admin secret.
      const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
      const cr = await fetch(`${SITE}/.netlify/functions/pm-charge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: admin, pm_key: p.pm_key, amount_cents: p.amount_cents, job_id: p.job_id, description: p.description, actor: 'pm_approved', approved: true }) });
      const cd = await cr.json();
      if (cd && cd.status === 'charged') { await logRow('pm_charge_approved', { token, pm_key: p.pm_key, job_id: p.job_id, amount_cents: p.amount_cents, payment_intent_id: cd.payment_intent_id, at_ms: Date.now() }); }
      return json(200, cd);
    }
    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err) { return json(500, { ok: false, error: err.message }); }
};

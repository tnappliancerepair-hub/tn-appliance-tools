// batch-return-labels — the tap that emails Teddy every open SquareTrade return label.
// Counts what's open, kicks the background worker (which pulls each prepaid label PDF from
// the RMA emails and sends them in printable batches grouped by distributor), and returns
// right away. Phone-friendly: a plain GET with the admin secret works from a text link.
//   GET/POST ?secret=<admin>[&to=you@email&distributor=ENCOMPASS&tech_id=4&limit=50]
'use strict';
const { getSecret } = require('./_lib/secrets');
const { loadOpenReturns } = require('./_lib/returns');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if ((q.secret || b.secret) !== admin) return json(401, { error: 'unauthorized' });

  const to = String(q.to || b.to || process.env.RETURNS_CC_EMAIL || 'tnappliancerepair@gmail.com').trim();
  const distributor = String(q.distributor || b.distributor || '').trim();
  const tech_id = q.tech_id || b.tech_id || null;
  const limit = q.limit || b.limit || null;

  // Count what's open so the reply is honest, then fire the heavy worker in the background.
  let open = [];
  try { const res = await loadOpenReturns({ max: 500, resolveTech: false }); open = (res && res.returns) || []; } catch (_) {}
  if (distributor) open = open.filter((o) => String(o.distributor || '').toUpperCase() === String(distributor).toUpperCase());
  const byDist = open.reduce((a, o) => { const g = (o.distributor || 'OTHER').toUpperCase(); a[g] = (a[g] || 0) + 1; return a; }, {});

  const payload = { to, distributor, tech_id, limit, max_per_email: (q.max_per_email || b.max_per_email) };
  try {
    await fetch(`${SITE}/.netlify/functions/batch-return-labels-background`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (_) {}

  return json(200, {
    ok: true,
    emailing_to: to,
    open_returns: open.length,
    by_distributor: byDist,
    note: `Pulling the prepaid label PDFs and emailing them to ${to} now — grouped by distributor, most-urgent first. They land in a couple minutes; a text confirms the count.`,
  });
};

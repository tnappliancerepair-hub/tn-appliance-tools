// platform-lead — THE intake endpoint for the Ant platform. Any lead source (Ann's
// phone tool, a web form, an office quick-add) posts a lead here and it becomes a real
// JOB on that shop's Supabase board, with a customer portal link minted back.
//
//   POST { slug, name, phone, what, detail, city, source }
//   GET  ?slug=demo&name=Test%20Caller&phone=6155551234&what=Whirlpool%20dryer&detail=Not%20heating
//        (easy browser test — fires a lead into the shop with that slug)
//
// `what`  = the appliance ("Whirlpool dryer") or vehicle ("2015 Honda Accord")
// `detail`= what's wrong. Returns { ok, job_id, portal_url } — the job shows on the
// office board + tech app instantly, and portal_url is the customer's link.
//
// Optional ?k=<TELNYX_TOOL_SECRET> gate (matches the Ann tools); ungated if unset.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { createLeadJob } = require('./_lib/platform-db');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);

  const slug = String(p.slug || '').toLowerCase().trim();
  if (!slug) return json(200, { ok: false, error: 'need slug (the shop)' });

  // Tool-key gate for REAL shops; the 'demo' sandbox tenant is open so the bridge is
  // easy to test (it only ever writes throwaway demo data).
  if (slug !== 'demo') {
    const key = await getSecret('TELNYX_TOOL_SECRET');
    if (key && q.k !== key && p.k !== key) return json(403, { ok: false, error: 'forbidden' });
  }

  const res = await createLeadJob({
    slug,
    name: p.name || '',
    phone: p.phone || '',
    what: p.what || p.appliance || p.vehicle || '',
    detail: p.detail || p.problem || p.issue || '',
    city: p.city || '',
    source: p.source || 'platform_lead',
  });
  return json(200, res);
};

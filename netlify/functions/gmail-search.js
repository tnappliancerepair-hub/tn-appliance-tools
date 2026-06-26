// gmail-search — owner-gated admin tool to search the Gmail inbox with an arbitrary
// query and see matching emails (Subject/From/To/Date/snippet). Built to FIND a past
// thread — e.g. "where/who did we email about Amazon Business API access?" — without
// having to dig through the inbox by hand. Reuses the pollers' Gmail OAuth.
//
//   GET ?secret=<admin>&q=<gmail query>[&max=20][&full=1]
//   q defaults to an Amazon-Business-API correspondence search.
//   &full=1 also pulls the To/Cc headers + a longer snippet.
'use strict';
const { getSecret } = require('./_lib/secrets');
const { searchAll } = require('./_lib/gmail-accounts');

const DEFAULT_Q = '("amazon business" OR amazon.com OR amazonaws.com OR amazonservices.com) '
  + '(api OR "ordering api" OR "business api" OR "selling partner" OR "solution provider" '
  + 'OR developer OR credentials OR application OR "api access" OR onboarding OR integration) '
  + 'newer_than:400d';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q0 = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q0.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const query = String(q0.q || DEFAULT_Q);
  const max = Math.min(parseInt(q0.max, 10) || 20, 50);
  const full = q0.full === '1';
  const want = full ? ['Subject', 'From', 'To', 'Cc', 'Date'] : ['Subject', 'From', 'Date'];

  let res;
  try {
    res = await searchAll(query, { max, headers: want });
  } catch (e) {
    return json(200, { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) });
  }
  if (!res.accounts.length) return json(200, { ok: false, error: 'no connected gmail accounts' });

  return json(200, { ok: true, query, accounts: res.accounts, count: res.matches.length, matches: res.matches });
};

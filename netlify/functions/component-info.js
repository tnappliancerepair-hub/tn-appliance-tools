// component-info — serves curated tech knowledge for a part/component: failure
// SYMPTOMS, how to TEST it, safety flags, and links to our /fix pages. Ground-truth
// content (not a prediction), so it's reliable + on-brand. Powers the fits widget,
// storefront listings, Amazon A+, and the QR-in-box card.
//   GET/POST { q | component | part_description }
//   -> { ok, found, component:{ key, appliance, symptoms, how_to_test, safety, links } }
'use strict';
const kb = require('./_lib/ant/component-knowledge');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let p = {};
  if (event.httpMethod === 'POST') { try { p = JSON.parse(event.body || '{}'); } catch (_) {} }
  else { p = event.queryStringParameters || {}; }

  const q = p.q || p.component || p.part_description || p.symptom || '';
  const c = kb.match(q);
  if (!c) return json(200, { ok: true, found: false, query: q, note: 'No curated knowledge for that component yet.' });
  return json(200, { ok: true, found: true, query: q, component: kb.withLinks(c) });
};

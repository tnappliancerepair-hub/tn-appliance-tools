// set-part-location — stamps a CLEAR destination on a job's parts so the tech opens the
// job and knows exactly where each part is, no searching (Teddy 2026-07-16: "the tech
// should have no doubt where the parts are so they can just work"). Andre spent this
// morning hunting MeisterTask for 3 parts — this closes that gap.
//
// Office picks the destination when logging the order; the tech can confirm "got it" in
// the field. Writes `where_kind` into each parts_orders row's notes JSON (read by
// job-parts.js). Pure Netlify — no Mac/XS deploy.
//
//   POST { job_id, where_kind, part?, in_hand?, by?, tech_id? }
//     where_kind: home | shop | truck | willcall   (in_hand=true overrides to a confirmed grab)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function parseNotes(n) { try { return JSON.parse(n || '{}'); } catch (_) { return {}; } }

const VALID = new Set(['home', 'shop', 'truck', 'willcall']);

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  const inHand = !!b.in_hand;
  let kind = String(b.where_kind || '').toLowerCase().trim();
  if (inHand) kind = 'in_hand';
  if (!inHand && !VALID.has(kind)) return j(400, { ok: false, error: 'where_kind must be home | shop | truck | willcall' });

  const part = String(b.part || '').trim();
  let rows = [];
  try { rows = await crud.searchPage(PARTS_ORDERS, { job_id: jobId }, { ordered_at: 'desc' }, 50) || []; } catch (_) {}
  // don't relocate parts already marked arrived/returned; and if a specific part was named, only that one
  const targets = rows.filter((r) => {
    const st = String(r.order_status || '').toLowerCase();
    if (st === 'arrived' || st === 'returned' || st === 'received') return false;
    if (part && String(r.part_number || '').trim() !== part) return false;
    return true;
  });
  if (!targets.length) return j(200, { ok: true, updated: 0, note: 'no matching parts to locate' });

  let updated = 0;
  for (const r of targets) {
    const m = parseNotes(r.notes);
    m.where_kind = kind;
    m.where_by = String(b.by || (b.tech_id ? ('tech ' + b.tech_id) : 'office')).slice(0, 40);
    m.where_at = Date.now();
    // keep ship_to consistent so any older reader still resolves sanely
    m.ship_to = (kind === 'home') ? 'customer' : 'shop';
    try { await crud.update(PARTS_ORDERS, r.id, { notes: JSON.stringify(m) }); updated++; } catch (_) {}
  }
  try { await crud.logEvent('part_location_set', { job_id: jobId, where_kind: kind, part: part || 'all', updated, by: b.by || (b.tech_id ? ('tech ' + b.tech_id) : 'office') }); } catch (_) {}
  return j(200, { ok: true, updated, where_kind: kind });
};

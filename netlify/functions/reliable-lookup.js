// reliable-lookup — live Reliable Parts pricing + stock, our SECOND OEM source
// (catches Samsung / superseded numbers Marcone misses). Mirrors marcone-lookup
// so the tech tool + Teddy Tool render both sources symmetrically. Internal use
// only (never expose cost to customers — standing rule).
//
//   POST { part_number, brand? }             -> one part
//   POST { part_numbers: ["..","..", ...] }  -> batch (deduped, parallel)
// → { ok, configured, results: [{ part_number, found, description, make, cost,
//      list, in_stock, total_qty, eta_days, source }] }
//
// Returns configured:false (with a note) until the Reliable creds/endpoints are
// vaulted (RELIABLE_* via admin-secrets.html) — then it lights up with no code
// change, exactly like the Amazon Business tier.
'use strict';

const reliable = require('./_lib/reliable');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

async function one(partNumber) {
  const pn = String(partNumber || '').trim();
  if (!pn) return { part_number: pn, found: false, error: 'empty' };
  try {
    const r = await reliable.lookupPart(pn);
    if (!r.ok) return { part_number: pn, found: false, error: (r.error && (r.error.message || r.error)) || 'not found', status: r.status };
    const p = (r.results || [])[0];
    if (!p) return { part_number: pn, found: false };
    return {
      part_number: p.part_number || pn, found: true, description: p.description, make: p.brand,
      cost: p.cost, list: p.list_price,
      in_stock: p.in_stock, total_qty: p.quantity, eta_days: p.eta_days != null ? p.eta_days : null,
      source: 'reliable',
    };
  } catch (e) { return { part_number: pn, found: false, error: String((e && e.message) || e) }; }
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const list = Array.isArray(body.part_numbers) ? body.part_numbers : (body.part_number ? [body.part_number] : []);
  const uniq = [...new Set(list.map((p) => String(p || '').trim()).filter(Boolean))].slice(0, 10);
  if (!uniq.length) return json(400, { ok: false, error: 'pass part_number or part_numbers[]' });

  // Not live yet — say so cleanly so the UI can show "connect Reliable" instead
  // of a scary error.
  const configured = await reliable.isConfigured();
  if (!configured) {
    return json(200, { ok: true, configured: false, note: 'Reliable not connected yet — vault RELIABLE_* creds from the spec (admin-secrets.html).', results: uniq.map((p) => ({ part_number: p, found: false, not_configured: true })) });
  }

  try {
    const results = await Promise.all(uniq.map((p) => one(p)));
    return json(200, { ok: true, configured: true, results });
  } catch (e) {
    return json(200, { ok: false, configured: true, error: String((e && e.message) || e) });
  }
};

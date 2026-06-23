// marcone-lookup — live Marcone (mSupply) part pricing + stock for the tech tool
// and cash-TDR. Internal use only (never expose cost to customers — standing rule).
//
//   POST { part_number, make? }              -> one part
//   POST { part_numbers: ["..","..", ...] }  -> batch (deduped, parallel)
// → { ok, results: [{ part_number, found, description, make, cost, list, dealer,
//                      in_stock, total_qty, eta_days, in_stock_at, discontinued }] }
//
// `cost` is YOUR account net price (account 99202). Looks up by part number and
// omits make so Marcone resolves it under whatever brand code carries it (the make
// field is a code like WPL = Whirlpool).
'use strict';

const msupply = require('./_lib/msupply');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

async function one(partNumber, make) {
  const pn = String(partNumber || '').trim();
  if (!pn) return { part_number: pn, found: false, error: 'empty' };
  try {
    const r = await msupply.lookupPart(pn, make, {});
    if (!r.ok) return { part_number: pn, found: false, error: r.error || 'not found' };
    return {
      part_number: r.part_number || pn, found: true, description: r.description, make: r.make,
      cost: r.cost, list: r.list, dealer: r.dealer, retail: r.retail,
      in_stock: r.in_stock, total_qty: r.total_qty, eta_days: r.eta_days, in_stock_at: r.in_stock_at,
      discontinued: r.discontinued, drop_ship_only: r.drop_ship_only, hazmat: r.hazmat,
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

  try {
    const results = await Promise.all(uniq.map((p) => one(p, body.make)));
    return json(200, { ok: true, results });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};

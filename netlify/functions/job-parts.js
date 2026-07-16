// job-parts — answers ONE question for a job: "where are the parts?" Combines the
// parts WE order (parts_orders) into a clean, tech-readable location so the field
// guy knows whether to swing by Marcone / Ideal's to pick them up, or they're already
// shipped to the customer's home. The warranty-SUPPLIED parts (ServicePower/AHS) live
// on warranty-parts.js — those ship to the customer's home and are shown there.
//
//   GET ?job_id=   -> { ok, parts:[{ part, name, supplier, supplier_nice, status,
//                         tracking, eta, ship_to, where, where_icon, pickup }] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function parseNotes(n) { try { return JSON.parse(n || '{}'); } catch (_) { return {}; } }

// distributor key → how the tech says it
const SUPPLIER_NICE = { marcone: 'Marcone', ideal: "Ideal's", ideals: "Ideal's", 'ideal appliance': "Ideal's", amazon: 'Amazon', encompass: 'Encompass', reliable: 'Reliable', tribles: 'Tribles', msupply: 'Marcone' };
function nice(s) { const k = String(s || '').toLowerCase().trim(); if (SUPPLIER_NICE[k]) return SUPPLIER_NICE[k]; return k ? k.replace(/\b\w/g, (c) => c.toUpperCase()) : 'the distributor'; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};

  // Admin-gated ops probe: list recent parts orders across all jobs (read-only) so we
  // can find a job that has one. ?recent=1&secret=<admin>[&n=]
  if (q.recent) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
    let rows = [];
    try { rows = await crud.searchPage(PARTS_ORDERS, {}, { ordered_at: 'desc' }, parseInt(q.n, 10) || 30) || []; } catch (_) {}
    const list = rows.map((r) => { const m = parseNotes(r.notes); return { order_id: r.id, job_id: r.job_id, part: r.part_number, supplier: r.supplier, status: r.order_status, ship_to: (m.ship_to || 'customer') }; });
    return j(200, { ok: true, count: list.length, orders: list });
  }

  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  let rows = [];
  try { rows = await crud.searchPage(PARTS_ORDERS, { job_id: jobId }, { ordered_at: 'desc' }, 50) || []; } catch (_) {}

  const parts = rows.map((r) => {
    const m = parseNotes(r.notes);
    const supplier = String(r.supplier || '').toLowerCase();
    const supplier_nice = nice(supplier);
    const status = String(r.order_status || '');
    const tracking = r.order_reference || '';
    const eta = r.parts_eta_date || m.eta || '';
    const shipTo = (m.ship_to || 'customer').toLowerCase();
    const placed = status !== 'to_order';
    const customerBound = shipTo === 'customer';

    // Build the human "where is it / where do I get it" line. An EXPLICIT destination
    // (notes.where_kind, set by the office at order time or the tech's "got it") wins;
    // otherwise fall back to inferring from ship_to. `ready` = the tech can act on it now
    // (in hand / shipped / at the shop); `pickup` = he has to go grab it somewhere.
    const kind = String(m.where_kind || '').toLowerCase();
    const etaTxt = eta ? ` · ETA ${eta}` : '';
    const trkTxt = tracking ? ` · track ${tracking}` : '';
    let where, where_icon, pickup = false, ready = false;
    if (kind === 'truck') {
      where = `On your truck already`; where_icon = '🚚'; ready = true;
    } else if (kind === 'in_hand') {
      where = `In hand — you've got it`; where_icon = '✅'; ready = true;
    } else if (kind === 'shop') {
      where = (placed ? `At our shop — grab it before you head out` : `Coming to our shop — grab it before you head out`) + etaTxt;
      where_icon = '🏢'; pickup = true; ready = placed;
    } else if (kind === 'willcall') {
      where = (placed ? `Will-call pickup at ${supplier_nice}` : `To order — will-call pickup at ${supplier_nice}`) + (tracking ? ` · ref ${tracking}` : '') + (eta ? ` · ready ${eta}` : '');
      where_icon = '🏬'; pickup = true; ready = placed;
    } else if (kind === 'home') {
      where = (placed ? `Shipped to the customer's home` : `Will ship to the customer's home`) + etaTxt + (placed ? trkTxt : '');
      where_icon = '🏠'; ready = placed;
    } else if (!placed) {
      where = customerBound ? `Not ordered yet — will ship to the customer's home` : `Not ordered yet — will be picked up at ${supplier_nice}`;
      where_icon = '⏳'; pickup = !customerBound;
    } else if (customerBound) {
      where = `Shipped to the customer's home` + etaTxt + trkTxt; where_icon = '🏠'; ready = true;
    } else {
      where = `Pick up at ${supplier_nice}` + (tracking ? ` · ref ${tracking}` : '') + (eta ? ` · ready ${eta}` : ''); where_icon = '🏬'; pickup = true; ready = placed;
    }

    return {
      order_id: r.id, part: r.part_number, name: r.part_name || '',
      supplier, supplier_nice, status, tracking, eta, ship_to: shipTo,
      placed, where, where_icon, pickup, ready, where_kind: kind,
    };
  }).filter((p) => p.part && p.part !== 'TBD' || p.name);

  const pickups = parts.filter((p) => p.pickup).length;
  const ready = parts.filter((p) => p.ready).length;
  return j(200, { ok: true, count: parts.length, pickups, ready, parts });
};

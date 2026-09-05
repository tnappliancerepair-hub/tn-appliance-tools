// service-mode-lookup — how to enter a brand+appliance's built-in diagnostic /
// service / test mode. Reads the curated reference (_lib/ant/service-modes.json).
// Reuses fault-code-lookup's family alias map so any brand badge resolves.
//
//   GET  ?brand=whirlpool&appliance=washer
//   POST { brand, appliance? }
//   -> { ok, found, family, modes? } | { ok, found:false, family, available:[appliances] }

'use strict';
const DB = require('./_lib/ant/service-modes.json');
const { familyOf } = require('./fault-code-lookup');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

function lookup(brand, appliance) {
  const fam = familyOf(brand);
  const ap = String(appliance || '').toLowerCase().trim();
  const all = (DB.modes || []).filter((m) => m.family === fam);
  // When an appliance is given, never cross into another appliance's procedure.
  const modes = ap ? all.filter((m) => m.appliance === ap) : all;
  return { fam, modes, all };
}

function respond(brand, appliance) {
  if (!brand) return { ok: false, error: 'brand required' };
  const { fam, modes, all } = lookup(brand, appliance);
  if (modes.length) return { ok: true, found: true, family: fam, modes };
  return { ok: true, found: false, family: fam, available: all.map((m) => m.appliance) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let brand = '', appliance = '';
  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    brand = b.brand; appliance = b.appliance;
  } else {
    const q = event.queryStringParameters || {};
    brand = q.brand; appliance = q.appliance;
  }
  const out = respond(brand, appliance);
  return { statusCode: out.ok ? 200 : 400, headers: CORS, body: JSON.stringify(out) };
};

// reused in-process (no HTTP hop)
module.exports.lookup = lookup;

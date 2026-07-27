// fault-code-lookup — meaning + likely causes + confirming test for a brand's
// error code. Reads the curated IP-clean fault-code DB (_lib/ant/fault-codes.json).
// Part numbers come from the live parts lookup + TDR history, never from here.
//
//   GET  ?brand=samsung&code=4C[&appliance=washer]
//   POST { brand, code, appliance? }
//   -> { ok, found, match?, brand_codes? }

'use strict';
const DB = require('./_lib/ant/fault-codes.json');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

// brand string -> family key (whirlpool/maytag/kitchenaid -> 'whirlpool', etc.)
function familyOf(brand) {
  const b = String(brand || '').toLowerCase().trim();
  if (!b) return '';
  for (const [fam, aliases] of Object.entries(DB.families || {})) {
    if (fam === b) return fam;
    if ((aliases || []).some((a) => b.includes(a) || a.includes(b))) return fam;
  }
  return b;
}
// normalize a code for comparison: strip spaces/dashes, uppercase ("F5 E2"->"F5E2")
function normCode(c) { return String(c || '').toUpperCase().replace(/[\s\-_.]/g, ''); }

// collapse a trailing E/C so Samsung's "4E" (older display) == "4C" (newer) — but
// NOT so "84C" collapses into "4C". "4E"->"4", "84C"->"84", "21C"->"21".
function canonCode(c) { const n = normCode(c); return n.replace(/[EC]$/, ''); }

function lookup(brand, code, appliance) {
  const fam = familyOf(brand);
  const nc = normCode(code);
  const ap = String(appliance || '').toLowerCase().trim();
  const all = (DB.codes || []).filter((r) => r.family === fam);
  // When an appliance is given, NEVER cross into another appliance's codes — a fridge
  // question must never answer with a washer code (that was the 84C->4C bug).
  const codes = ap ? all.filter((r) => r.appliance === ap) : all;
  const cn = canonCode(code);
  let match = codes.find((r) => normCode(r.code) === nc);                    // exact
  if (!match && cn) match = codes.find((r) => canonCode(r.code) === cn);     // E/C suffix equivalence only
  return { fam, match, brand_codes: all.map((r) => ({ code: r.code, appliance: r.appliance, meaning: r.meaning })) };
}

function respond(brand, code, appliance) {
  if (!brand && !code) return { ok: false, error: 'brand + code required' };
  const { fam, match, brand_codes } = lookup(brand, code, appliance);
  if (match) return { ok: true, found: true, family: fam, match };
  return { ok: true, found: false, family: fam, brand_codes: brand_codes.slice(0, 60) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let brand = '', code = '', appliance = '';
  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    brand = b.brand; code = b.code; appliance = b.appliance;
  } else {
    const q = event.queryStringParameters || {};
    brand = q.brand; code = q.code; appliance = q.appliance;
  }
  const out = respond(brand, code, appliance);
  return { statusCode: out.ok ? 200 : 400, headers: CORS, body: JSON.stringify(out) };
};

// reused by ant-troubleshoot.js (in-process, no HTTP hop)
module.exports.lookup = lookup;
module.exports.familyOf = familyOf;
module.exports.normCode = normCode;

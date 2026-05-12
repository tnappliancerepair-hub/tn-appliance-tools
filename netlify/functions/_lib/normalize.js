// Shared normalization helpers for vendor email parsers.
// Used by:
//   - servicepower-gmail-poller.js (via parsers/servicepower.js)
//   - future AHS / NSA / SquareTrade parsers
//
// Underscore-prefixed directory so Netlify function discovery skips it
// (Netlify only deploys files in netlify/functions/ that don't start
// with an underscore).
//
// Approval ref: Phase A1 architecture — Amendment 1 dedup edge cases,
// Option A for address suffix expansion.

// ─── PHONE NORMALIZATION ────────────────────────────────────────────
// Strip all non-digits. If result is 11 digits with leading "1", strip
// the "1". Return the 10-digit string OR null if the result isn't
// exactly 10 digits.
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.substring(1);
  if (digits.length === 10) return digits;
  return null;
}

// ─── ADDRESS NORMALIZATION ──────────────────────────────────────────
//
// Returns "{street}|{city}|{state2}|{zip5}" OR null if any component
// fails to normalize.
//
// Strategy (Option A — suffix expansion at any token position):
//   1. Lowercase, strip commas + periods, collapse whitespace, trim
//   2. Drop unit specifiers (Apt 4B, Suite 200, # 12) and their following token
//   3. Expand directionals (N→north, NE→northeast, etc.) in any position
//   4. Expand street suffixes (St→street, Ave→avenue, etc.) in any position
//
// Option A rationale: applying suffix expansion only at the LAST token
// would break "1708 12th Ave N" (last token is `n`, a directional, not
// the suffix). The suffix-map is a closed set of short tokens that don't
// collide with typical non-suffix uses (e.g. street name "Saint Street"
// has `saint` which isn't in the map).
//
// TODO: ordinal-street tokens like "1st", "12th", "21st" aren't currently
// normalized. Machine-generated dispatch emails are consistent enough
// that "1st Ave" stays "1st avenue" without issue. If real-world variance
// appears (e.g. some emails use "First Avenue" instead), revisit and add
// an ordinal map.

const STREET_SUFFIX_MAP = {
  st: 'street',          'st.': 'street',          street: 'street',
  ave: 'avenue',         'ave.': 'avenue',         avenue: 'avenue',
  blvd: 'boulevard',     'blvd.': 'boulevard',     boulevard: 'boulevard',
  rd: 'road',            'rd.': 'road',            road: 'road',
  ln: 'lane',            'ln.': 'lane',            lane: 'lane',
  dr: 'drive',           'dr.': 'drive',           drive: 'drive',
  ct: 'court',           'ct.': 'court',           court: 'court',
  pl: 'place',           'pl.': 'place',           place: 'place',
  cir: 'circle',         'cir.': 'circle',         circle: 'circle',
  pkwy: 'parkway',       'pkwy.': 'parkway',       parkway: 'parkway',
  hwy: 'highway',        'hwy.': 'highway',        highway: 'highway',
  ter: 'terrace',        'ter.': 'terrace',        terrace: 'terrace',
  trl: 'trail',          trail: 'trail',
  sq: 'square',          square: 'square',
  way: 'way',
};

const DIRECTION_MAP = {
  // Two-letter compounds checked first (handled in the loop order — see below)
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  n: 'north',  s: 'south',  e: 'east',  w: 'west',
  'n.': 'north', 's.': 'south', 'e.': 'east', 'w.': 'west',
  north: 'north', south: 'south', east: 'east', west: 'west',
};

// Drop these tokens AND their immediately-following token (the unit number/letter)
const UNIT_PREFIXES = new Set(['apt', 'apt.', 'apartment', 'unit', 'suite', 'ste', 'ste.', 'no', 'no.', 'rm', 'room']);

// State name → 2-letter code. Only states TN Appliance serves; expand if we cross borders.
const STATE_NAME_TO_CODE = {
  tennessee: 'tn', tn: 'tn',
  louisiana: 'la', la: 'la',
};

function normalizeStreet(raw) {
  if (!raw) return null;
  let s = String(raw).toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const tokens = s.split(' ');
  const kept = [];
  let skipNext = false;
  for (const tok of tokens) {
    if (skipNext) { skipNext = false; continue; }
    if (UNIT_PREFIXES.has(tok)) { skipNext = true; continue; }
    if (tok.startsWith('#')) continue;
    kept.push(tok);
  }
  if (!kept.length) return null;
  // Expand directionals and street-suffixes at any position
  const expanded = kept.map((tok) => {
    if (DIRECTION_MAP[tok]) return DIRECTION_MAP[tok];
    if (STREET_SUFFIX_MAP[tok]) return STREET_SUFFIX_MAP[tok];
    return tok;
  });
  return expanded.join(' ').trim();
}

function normalizeCity(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

function normalizeState(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[,.]/g, '').trim();
  return STATE_NAME_TO_CODE[s] || (s.length === 2 ? s : null);
}

function normalizeZip(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 5) return null;
  return digits.substring(0, 5);
}

function normalizeAddress(street, city, state, zip) {
  const ns = normalizeStreet(street);
  const nc = normalizeCity(city);
  const nst = normalizeState(state);
  const nz = normalizeZip(zip);
  if (!ns || !nc || !nst || !nz) return null;
  return `${ns}|${nc}|${nst}|${nz}`;
}

// ─── COMPOSITE DEDUP SIGNATURE ─────────────────────────────────────
// Returns { signature, status } where status is one of:
//   "OK"                  — both phone + address normalized
//   "PARTIAL_PHONE_ONLY"  — phone OK, address failed
//   "PARTIAL_ADDR_ONLY"   — address OK, phone failed
//   "FAILED"              — both failed
function buildDedupSignature(rawPhone, rawStreet, rawCity, rawState, rawZip) {
  const phone10 = normalizePhone(rawPhone);
  const addrNorm = normalizeAddress(rawStreet, rawCity, rawState, rawZip);
  if (phone10 && addrNorm) return { signature: `${phone10}|${addrNorm}`, status: 'OK', phone10, addrNorm };
  if (phone10 && !addrNorm) return { signature: `${phone10}|NOADDR`, status: 'PARTIAL_PHONE_ONLY', phone10, addrNorm: null };
  if (!phone10 && addrNorm) return { signature: `NOPHONE|${addrNorm}`, status: 'PARTIAL_ADDR_ONLY', phone10: null, addrNorm };
  return { signature: null, status: 'FAILED', phone10: null, addrNorm: null };
}

// ─── NAME PARSING ──────────────────────────────────────────────────
// Split "First Last" or "First Middle Last" into { first_name, last_name }.
// Last token = last_name; everything before = first_name. Single-token
// names go entirely into first_name (last_name = ""). Title-cases each
// token. Handles ALL-CAPS, mixed-case, and apostrophes/hyphens gracefully.
function parseName(raw) {
  if (!raw) return { first_name: '', last_name: '', full_name: '' };
  const cleaned = String(raw).trim().replace(/\s+/g, ' ');
  if (!cleaned) return { first_name: '', last_name: '', full_name: '' };
  const tokens = cleaned.split(' ').map(titleCaseToken);
  const full = tokens.join(' ');
  if (tokens.length === 1) return { first_name: tokens[0], last_name: '', full_name: full };
  return {
    first_name: tokens.slice(0, -1).join(' '),
    last_name: tokens[tokens.length - 1],
    full_name: full,
  };
}

function titleCaseToken(tok) {
  if (!tok) return tok;
  // Lowercase, then uppercase the first char and any char after a hyphen/apostrophe.
  const lower = tok.toLowerCase();
  return lower.replace(/(^|[-'])(.)/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// ─── DATE PARSING ──────────────────────────────────────────────────
// ServicePower dates are MM/DD/YYYY. Returns ISO date string "YYYY-MM-DD"
// OR null if input doesn't match.
function parseDateMDY(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, dd, yy] = m;
  return `${yy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

module.exports = {
  normalizePhone,
  normalizeStreet,
  normalizeCity,
  normalizeState,
  normalizeZip,
  normalizeAddress,
  buildDedupSignature,
  parseName,
  parseDateMDY,
  titleCaseToken,
  // Exposed for tests
  STREET_SUFFIX_MAP,
  DIRECTION_MAP,
  UNIT_PREFIXES,
  STATE_NAME_TO_CODE,
};

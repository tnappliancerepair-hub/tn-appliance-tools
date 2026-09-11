// part-match — "is this existing job_part row the same physical part as X?"
//
// One copy on purpose. The legacy email parser writes DESCRIPTIVE JUNK into job_part.number:
//
//   "THERMOSTAT HI LIMIT WE04X30381\nPart #WE04X30381"   (name NULL)
//   "Drum Front Bearing Assembly, Upper WE03X25576"
//   "AKC72949319 : LG Refrigerator Ice Maker & Bucket"
//
// so a vendor feed that compares its clean part number against that column matches NOTHING and
// happily inserts a duplicate of a part the job already has. Matching must EXTRACT a part
// number from the text on both sides. platform-sp-parts-sync proved this shape against the real
// rows; ahs-returns-watch needs the identical rule, and a second copy would drift the way the
// two pasted copies of the old portal part key did (see 068_part_key).
'use strict';

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// A part number is a 5+ char token that is either alphanumeric (WE04X30381, DC97-16350U) or
// purely numeric but long enough not to be a quantity/year/price (8583165300010, 316530001).
function looksLikePartNo(t) {
  if (t.length < 5) return false;
  if (!/\d/.test(t)) return false;                 // must contain a digit
  if (/^\d+$/.test(t)) return t.length >= 6;       // pure numbers: Whirlpool/Frigidaire style
  return true;
}

// When a row says "Part #X", X is the authoritative part for that row -- and anything after
// "Replaces #" is a SUPERSEDED number, not this row's identity. Honoring that keeps ship info
// from being attached to the wrong row.
function extractPartNos(text) {
  const raw = String(text || '');
  const explicit = [];
  const re = /part\s*#\s*([A-Za-z0-9-]{5,})/gi;
  let m; while ((m = re.exec(raw))) explicit.push(m[1].replace(/-+$/, ''));
  if (explicit.length) return explicit.filter(looksLikePartNo);
  const out = [];
  for (const tok of raw.split(/[^A-Za-z0-9-]+/)) {
    const t = tok.replace(/-+$/, '');
    if (looksLikePartNo(t)) out.push(t);
  }
  return out;
}

// Does this existing job_part row refer to the vendor's part number?
function rowMatches(row, vendorPart) {
  const target = norm(vendorPart);
  if (!target) return false;
  if (norm(row.number) === target) return true;
  for (const cand of extractPartNos(row.number)) if (norm(cand) === target) return true;
  for (const cand of extractPartNos(row.name)) if (norm(cand) === target) return true;
  return false;
}

module.exports = { norm, looksLikePartNo, extractPartNos, rowMatches };

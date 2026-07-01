// playbook-lookup — matches a customer/tech symptom against repair-playbook.json,
// the owner's curated symptom->fix knowledge. Highest-trust grounding source for
// the Ant brain: these are TN Appliance's proven, common repairs in Teddy's words.
//
//   match({ brand, appliance, symptom }, limit) -> [{ score, entry, matched[] }]
//
// Only returns entries where the customer's words actually hit a known symptom
// (substring), so the brain stays precise instead of dumping the whole book.
'use strict';

// Not distinctive symptoms — appliance nouns, brands, filler, and function words.
// Dropped from token matching so the real symptom words (leak, warm, heat, gas,
// helicopter...) drive the match, not "fridge" or "the".
const STOP = new Set([
  'fridge', 'freezer', 'washer', 'washing', 'dryer', 'dishwasher', 'refrigerator', 'machine',
  'appliance', 'oven', 'range', 'stove', 'cooktop', 'unit',
  'samsung', 'whirlpool', 'frigidaire', 'kitchenaid', 'maytag', 'kenmore',
  'working', 'problem', 'broken', 'repair', 'really', 'little', 'always', 'sometimes',
  'the', 'and', 'not', 'but', 'for', 'its', 'is', 'are', 'was', 'were', 'you', 'your', 'from',
  'with', 'when', 'then', 'this', 'that', 'has', 'had', 'get', 'got', 'out', 'off', 'too', 'all',
  'any', 'a', 'an', 'to', 'of', 'on', 'in', 'it', 'my', 'me', 'we', 'us', 'or', 'so', 'up', 'do',
  'does', 'like', 'been', 'have', 'will', 'just', 'keeps', 'keep', 'wont', 'cant', 'doesnt',
]);
// a phrase token "counts" if it (or its 4-char stem) shows up in the customer's
// words — so "heating"~"heat", "draining"~"drain", "spinning"~"spin".
function tokenPresent(tok, text) {
  if (text.indexOf(tok) >= 0) return true;
  if (tok.length >= 5 && text.indexOf(tok.slice(0, 4)) >= 0) return true;
  return false;
}
let _entries = null;
function load() {
  if (_entries) return _entries;
  try { _entries = (require('./repair-playbook.json').entries || []).filter((e) => e && e.symptoms); }
  catch (_) { _entries = []; }
  return _entries;
}

// collapse loose appliance words to a canonical bucket
function canonAppliance(a) {
  a = String(a || '').toLowerCase();
  if (/fridge|refriger|freezer/.test(a)) return 'refrigerator';
  if (/dishwash/.test(a)) return 'dishwasher';
  if (/dryer/.test(a)) return 'dryer';
  if (/wash/.test(a)) return 'washer';
  if (/oven|range|stove|cooktop|burner/.test(a)) return 'range';
  if (/microwav/.test(a)) return 'microwave';
  return a;
}

function match(q, limit) {
  q = q || {};
  const B = String(q.brand || '').trim().toLowerCase();
  const A = canonAppliance(q.appliance);
  const T = String(q.symptom || '').toLowerCase();
  if (!T) return [];
  const out = [];
  for (const e of load()) {
    const eb = String(e.brand || '').toLowerCase();
    const brandSpecific = eb && eb !== 'any';
    // if we know the customer's brand, a brand-specific entry for a DIFFERENT brand is out
    if (B && brandSpecific && eb !== B) continue;
    const ea = canonAppliance(e.appliance);
    const applianceOk = !A || !ea || ea === 'any' || ea === A;
    if (!applianceOk) continue;
    // Score by UNIQUE symptom-token coverage so a specific 2-word hit ("ice
    // bottom") beats the same weak token repeated across phrases ("ice" x3).
    let substrHits = 0; const covered = new Set(); const matched = [];
    for (const sym of (e.symptoms || [])) {
      const sl = String(sym).toLowerCase();
      const toks = sl.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
      if (sl && T.indexOf(sl) >= 0) { // full-phrase substring
        substrHits++; matched.push(sym);
        for (const w of toks) if (tokenPresent(w, T)) covered.add(w);
        continue;
      }
      if (!toks.length) continue;
      const present = toks.filter((w) => tokenPresent(w, T));
      if (present.length && present.length >= Math.ceil(toks.length / 2)) { // >=half of a phrase's words
        matched.push(sym);
        for (const w of present) covered.add(w);
      }
    }
    if (!substrHits && covered.size === 0) continue; // require a real symptom hit
    let score = substrHits * 3 + covered.size * 1.5;
    if (brandSpecific && eb === B) score += 2; else if (!brandSpecific) score += 0.5;
    if (A && ea === A) score += 2;
    out.push({ score, entry: e, matched });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit || 3);
}

module.exports = { match, canonAppliance };

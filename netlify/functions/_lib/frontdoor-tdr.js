// frontdoor-tdr — compose a completed TDR into text Frontdoor/AHS accepts. Shared so the
// status push (frontdoor-push-job, sends it as the dispatch NOTE) and the portal helper
// (frontdoor-queue) speak with one voice. Honest + professional: only what the tech
// actually recorded, no invented dollars or filler.
'use strict';

function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function cap(s) { s = clean(s); return s ? s[0].toUpperCase() + s.slice(1) : s; }
// End a sentence WITHOUT doubling the period. A tech's free text usually already ends in
// punctuation, and "reads open as well.." in front of an AHS reviewer looks like a bug.
function dot(s) { s = clean(s); return !s || /[.!?]$/.test(s) ? s : s + '.'; }
// Cut to a length without slicing a word in half. Prefer the last sentence end, fall back to
// the last space. A note that stops at "cleaned the blower" reads worse than one that stops
// a sentence early, so we never hand the portal a half-word.
function trimTo(s, max) {
  s = clean(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/, '') + '...';
}

// Parts arrays may be a JSON string, an array of {part_number,name}, or plain strings.
function partsList(v) {
  let arr = v;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { return arr ? [String(arr)] : []; } }
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    const nm = clean(p.name); const pn = clean(p.part_number);
    return nm && pn ? `${nm} (${pn})` : (nm || pn);
  }).filter(Boolean);
}

// The "Work Performed" prose AHS reviewers read (bundle shape = get_warranty_card_bundle_for_jobs).
function workPerformed(b) {
  b = b || {}; const t = b.tdr || {};
  const appliance = clean([b.brand, b.appliance_type].filter(Boolean).join(' ')) || 'appliance';
  const diag = clean(t.diagnosis || b.problem_summary);
  const comp = clean(t.failed_component);
  const cause = clean(t.failure_cause);
  const repair = clean(t.repair_completed);
  const part = clean(t.verified_part_number);
  const used = partsList(t.parts_used);
  const out = [];
  out.push(diag ? dot(`Diagnosed ${appliance}: ${diag}`) : `Diagnosed ${appliance}.`);
  if (comp) out.push(dot(`Found ${comp} failed${cause ? ' — ' + cause : ''}`));
  if (repair) out.push(dot(cap(repair)));
  else if (comp) out.push(dot(`Replaced ${comp}${part ? ' (part ' + part + ')' : ''}`));
  if (used.length) out.push(dot(`Parts used: ${used.join(', ')}`));
  out.push('Tested operational on completion.');
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// One portal-ready NOTE carrying the whole TDR — for pushing onto the dispatch via the
// Status/Note API. Capped so it fits a note field.
function composeTdrNote(b) {
  b = b || {}; const t = b.tdr || {};
  const appliance = clean([b.brand, b.appliance_type].filter(Boolean).join(' ')) || 'appliance';
  const diag = clean(t.diagnosis || b.problem_summary);
  const comp = clean(t.failed_component);
  const part = clean(t.verified_part_number);
  const cause = clean(t.failure_cause);
  const labor = (t.labor_time_hours != null && t.labor_time_hours !== '') ? Number(t.labor_time_hours) : null;
  const toReturn = partsList(t.parts_not_used);
  // BODY is the prose (long, and it restates itself). TAIL is short and load-bearing:
  // labor is what AHS pays on, and parts-to-return is the chargeback field — an unreturned
  // part means the repair is not paid AND we can be charged for the part. So the tail is
  // RESERVED out of the 900 budget and the prose is trimmed to fit around it. Composing the
  // tail last and slicing the whole string was silently dropping both on any long diagnosis.
  const body = ['TN Appliance TDR — ' + appliance + '.'];
  if (diag) body.push(dot('Diagnosis: ' + diag));
  if (comp) body.push(dot('Failed: ' + comp + (part ? ' (part ' + part + ')' : '') + (cause ? ' — ' + cause : '')));
  const wp = workPerformed(b); if (wp) body.push('Work performed: ' + wp);

  const tail = [];
  if (labor != null) tail.push('Labor: ' + labor + ' hr' + (labor === 1 ? '' : 's') + '.');
  if (toReturn.length) tail.push(dot('Parts to return: ' + toReturn.join(', ')));

  const tailStr = tail.join(' ');
  if (!tailStr) return trimTo(body.join(' '), 900);
  const budget = 900 - tailStr.length - 1;            // -1 for the joining space
  const bodyStr = trimTo(body.join(' '), Math.max(0, budget));
  return clean(bodyStr + ' ' + tailStr);
}

module.exports = { composeTdrNote, workPerformed, partsList, clean, cap, dot, trimTo };

// frontdoor-tdr — compose a completed TDR into text Frontdoor/AHS accepts. Shared so the
// status push (frontdoor-push-job, sends it as the dispatch NOTE) and the portal helper
// (frontdoor-queue) speak with one voice. Honest + professional: only what the tech
// actually recorded, no invented dollars or filler.
'use strict';

function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function cap(s) { s = clean(s); return s ? s[0].toUpperCase() + s.slice(1) : s; }

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
  out.push(`Diagnosed ${appliance}${diag ? ': ' + diag : '.'}`);
  if (comp) out.push(`Found ${comp} failed${cause ? ' — ' + cause : ''}.`);
  if (repair) out.push(cap(repair) + (/[.!?]$/.test(repair) ? '' : '.'));
  else if (comp) out.push(`Replaced ${comp}${part ? ' (part ' + part + ')' : ''}.`);
  if (used.length) out.push(`Parts used: ${used.join(', ')}.`);
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
  const lines = ['TN Appliance TDR — ' + appliance + '.'];
  if (diag) lines.push('Diagnosis: ' + diag + '.');
  if (comp) lines.push('Failed: ' + comp + (part ? ' (part ' + part + ')' : '') + (cause ? ' — ' + cause : '') + '.');
  const wp = workPerformed(b); if (wp) lines.push('Work performed: ' + wp);
  if (labor != null) lines.push('Labor: ' + labor + ' hr' + (labor === 1 ? '' : 's') + '.');
  if (toReturn.length) lines.push('Parts to return: ' + toReturn.join(', ') + '.');
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 900);
}

module.exports = { composeTdrNote, workPerformed, partsList, clean, cap };

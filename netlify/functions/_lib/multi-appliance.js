// multi-appliance — does this ONE job's intake text actually describe MORE THAN ONE machine?
//
// WHY IT IS THIS FUSSY. Measured 2026-09-12 against 90 days of real platform intake: a naive
// "the text names two appliances" read produced 119 hits, and reading all of them showed
// roughly three quarters were phantom. Each false-positive class below cost a real row:
//
//   119  naive: any two appliance words anywhere in job.problem
//    42  after dropping everything past "||" — the platform appends an AI CALL SUMMARY to
//        problem, and a narrative that merely mentions a dishwasher is not a dishwasher job
//   ~11  after the rules below
//
// THE FIVE TRAPS, every one taken from a live row:
//
//   1. FREEZER IS PART OF THE FRIDGE.  "Fridge not cooling - freezer works fine",
//      "FRIDGE AND FREEZER STOPPED WORKING", "Other lights on freezer side". Thirteen of the
//      42 were this. A freezer only counts as its own machine when NO refrigerator is named.
//   2. "STRANGE" CONTAINS "RANGE".  "MAKING A STRANGE NOISE" read as a range four times.
//      Substring matching is fine for classifying a short clean label; it is wrong for
//      scanning free text. Every keyword is word-boundary matched here.
//   3. "DISH WASHER" CONTAINS "WASHER".  Four rows double-counted one dishwasher. Matched
//      text is MASKED OUT before the next keyword is tried, longest keyword first.
//   4. COMBO UNITS ARE ONE MACHINE.  "WASHER AND DRYER COMBO", "MICROWAVE OVEN COMBO",
//      "It's a dual washer and dryer machine". One unit, one report, one claim.
//   5. NEGATION.  A real unit label on this board reads "Washer not a fridge I added that on
//      accident". Anything after "not a" / "not an" is what it ISN'T.
//
// Even after all of it this FLAGS — it never creates. ~11 real candidates in 90 days is about
// one a week; a human clears that in seconds, and a phantom machine on a ticket nobody is
// servicing is the expensive direction.
//
//   detect(label, problem) -> { multi, appliances:[canon], primary, extra:[canon], why, text }
'use strict';

const { APPLIANCES } = require('./appliance-vocab');

// One unit sold as two things. "dual"/"combo"/"all in one" describe a single machine.
const COMBO = /\bcombo\b|\bdual\b|all[\s-]?in[\s-]?one|\b1\s*pc\b|one\s*piece|\bstackable\b|\bstacked\b/i;
// A reference to some OTHER job, not a second machine on this one.
const REFERENCE = /\brecall of job\b|\btrip w\/\b|\bprior repair\b|\bsame problem as before\b/i;
// The platform appends an AI call summary after this marker. Everything past it is narrative.
const SUMMARY_MARK = /\|\|/;

// Longest keyword first so "dish washer" is consumed before "washer" can see it, and
// "washing machine" before "washer".
const KEYWORDS = (function () {
  const out = [];
  for (const a of APPLIANCES) for (const k of a.kw) out.push({ canon: a.canon, kw: k });
  return out.sort((x, y) => y.kw.length - x.kw.length);
})();

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Strip the call summary, then blank out what a phrase says the machine is NOT. Both are
// removals, so a keyword can never be found inside text we have already ruled out.
function intakeText(label, problem) {
  let t = String(problem || '');
  const cut = t.search(SUMMARY_MARK);
  if (cut >= 0) t = t.slice(0, cut);
  return (String(label || '') + ' — ' + t).replace(/\bnot\s+an?\s+[a-z ]{0,24}/gi, ' ');
}

// Every DISTINCT appliance named in the text, masking each match so one phrase is counted once.
function appliancesIn(text) {
  let t = ' ' + String(text || '').toLowerCase() + ' ';
  const found = [];
  for (const { canon, kw } of KEYWORDS) {
    const re = new RegExp('(^|[^a-z])' + esc(kw) + '(?![a-z])', 'g');
    let hit = false;
    t = t.replace(re, (m, pre) => { hit = true; return pre + ' '.repeat(kw.length); });
    if (hit && found.indexOf(canon) < 0) found.push(canon);
  }
  return found;
}

// Two DIFFERENT problems hide in the same signal, and calling both "a second machine" would
// assert something untrue. Reading the 17 live hits, roughly ten were a genuine extra
// appliance and seven were a job whose LABEL disagrees with its own dispatch text — a ticket
// that says washer while the dispatch says the DRYER won't turn on. Both need a human; only
// one of them means "add a machine to this stop". The tell is whether the label's appliance
// is mentioned in the dispatch text at all.
function detect(label, problem) {
  const text = intakeText(label, problem);
  let appliances = appliancesIn(text);
  // what the DISPATCH says, with the label's own word excluded from the evidence
  let inProblem = appliancesIn(intakeText('', problem));

  // the freezer compartment of a refrigerator is not a second machine
  const dropFreezer = (list) => (list.indexOf('refrigerator') >= 0 ? list.filter((a) => a !== 'freezer') : list);
  appliances = dropFreezer(appliances);
  inProblem = dropFreezer(inProblem);

  const labelled = appliancesIn(String(label || ''))[0] || null;
  const primary = labelled || appliances[0] || null;
  const extra = appliances.filter((a) => a !== primary);

  let why = '';
  if (appliances.length < 2) why = 'one machine';
  else if (COMBO.test(text)) why = 'combo unit — sold as one machine';
  else if (REFERENCE.test(text)) why = 'names another job, not a second machine';

  // label says X, the dispatch never mentions X -> the ticket is on the wrong appliance,
  // which is NOT the same claim as "there is also a dryer here".
  const mismatch = !!(labelled && inProblem.length && inProblem.indexOf(labelled) < 0);
  const kind = why ? '' : (mismatch ? 'label_mismatch' : 'second_machine');

  return { multi: appliances.length >= 2 && !why, kind, appliances, in_problem: inProblem, primary, extra, why, text: text.trim() };
}

module.exports = { detect, appliancesIn, intakeText, COMBO, REFERENCE };

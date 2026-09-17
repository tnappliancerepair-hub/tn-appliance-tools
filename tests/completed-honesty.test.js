// A job must not read Complete until it IS complete.
//
// Danielle, 2026-09-16: "some jobs were mistakenly being added as job completed whenever it
// was not completed... yesterday she was dealing with jobs that were saying that they were
// completed and they were not."
//
// Two separate mechanisms were doing it, and both are covered here by LIFTING THE REAL RULE
// OUT OF THE SHIPPED FILE and executing it, so this test cannot drift from what runs:
//
//   1. THE DAY LIST IGNORED THE PART PICKER. tech-job.html has always decided the landing
//      status from the outcome AND the part status; platform/tech.html looked only at the
//      outcome. The same two taps -- "Job complete" + "Office needs to order it" -- landed
//      awaiting_parts on the job page and COMPLETED on the day list.
//
//   2. THE MIRROR CARRIED A STALE XANO COMPLETION. Xano's office_set_job_status writes
//      scheduling_status alone, with no timestamp and no reset, so a job closed on visit one
//      stays 'completed' forever while the office books visit two. The existing calendar
//      guard only fires on a booking TODAY OR LATER, so a return trip booked for yesterday
//      slipped straight through. The office's own filing (office_stage) is the tell that
//      does not decay.
const assert = require('assert');
const fs = require('fs');

const TECH   = fs.readFileSync(__dirname + '/../platform/tech.html', 'utf8');
const JOB    = fs.readFileSync(__dirname + '/../platform/tech-job.html', 'utf8');
const MIRROR = fs.readFileSync(__dirname + '/../netlify/functions/platform-tn-mirror.js', 'utf8');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — the day list's finish rule, lifted and executed
// ─────────────────────────────────────────────────────────────────────────────
const DAY_SRC = (TECH.match(/function finishStatusFor\(id\)\{[\s\S]*?\n {2}\}/) || [])[0];
assert.ok(DAY_SRC, 'could not lift finishStatusFor from platform/tech.html');

// Fake just enough DOM: the outcome radios and the part-status <select>.
function dayRule(outcome, partStatus) {
  const doc = {
    getElementsByName: (nm) => (nm === 'o7'
      ? [{ checked: outcome === 'fixed', value: 'fixed' },
         { checked: outcome === 'return_needed', value: 'return_needed' },
         { checked: outcome === 'not_fixable', value: 'not_fixable' }]
      : []),
    getElementById: (id) => (id === 'tps7' ? { value: partStatus } : null),
  };
  const OUTCOME_OF = (TECH.match(/function outcomeOf\(id\)\{[\s\S]*?\n {2}\}/) || [])[0];
  assert.ok(OUTCOME_OF, 'could not lift outcomeOf from platform/tech.html');
  return new Function('document', `${OUTCOME_OF}\n${DAY_SRC}\nreturn finishStatusFor(7);`)(doc);
}

console.log('\nthe day list lands the same status as the job page\n');

t('"Job complete" + "Office needs to order it" HOLDS the job open', () => {
  assert.strictEqual(dayRule('fixed', 'please_order'), 'awaiting_parts');
});

t('"Job complete" + "Not here / discrepancy" HOLDS the job open', () => {
  assert.strictEqual(dayRule('fixed', 'missing'), 'awaiting_parts');
});

t('a genuine finish still finishes', () => {
  assert.strictEqual(dayRule('fixed', 'used'), 'completed');
  assert.strictEqual(dayRule('fixed', 'none'), 'completed');
  assert.strictEqual(dayRule('fixed', 'truck'), 'completed');
  assert.strictEqual(dayRule('fixed', ''), 'completed');
});

t('a return trip holds the job open on the outcome alone', () => {
  assert.strictEqual(dayRule('return_needed', ''), 'awaiting_parts');
  assert.strictEqual(dayRule('return_needed', 'used'), 'awaiting_parts');
});

t('an unpicked outcome is UNANSWERED, never a silent completion', () => {
  assert.strictEqual(dayRule('', ''), 'unanswered');
  assert.strictEqual(dayRule('', 'used'), 'unanswered');
});

t('an old part going back does not hold the job open', () => {
  // 'return' is the tech sending the OLD part back -- the repair is done.
  assert.strictEqual(dayRule('fixed', 'return'), 'completed');
});

// The two surfaces must agree on every combination, or the bug is back.
t('the day list and the job page agree on all 18 combinations', () => {
  const JOB_SRC = (JOB.match(/function finishStatus\(\)\{[\s\S]*?\n {2}\}/) || [])[0];
  assert.ok(JOB_SRC, 'could not lift finishStatus from platform/tech-job.html');
  const jobRule = (outcomeSel, partStatus) =>
    new Function('outcomeSel', 'partStatus', `${JOB_SRC}\nreturn finishStatus();`)(outcomeSel, partStatus);
  const outcomes = ['', 'fixed', 'return_needed', 'not_fixable'];
  const parts = ['', 'none', 'used', 'truck', 'please_order', 'return', 'missing'];
  let checked = 0;
  outcomes.forEach((o) => parts.forEach((p) => {
    // 'reassign' is a job-page-only outcome; every shared one must match.
    assert.strictEqual(dayRule(o, p), jobRule(o, p), 'disagree on outcome=' + (o || '(none)') + ' part=' + (p || '(none)'));
    checked++;
  }));
  assert.strictEqual(checked, outcomes.length * parts.length);
});

// A button that promises a finish it will not do is the bug this repo already paid for once.
t('the button names the state the save will actually land', () => {
  const LBL = (TECH.match(/function finishLabel\(id\)\{[\s\S]*?\n {2}\}/) || [])[0];
  assert.ok(LBL, 'could not lift finishLabel');
  assert.ok(/finishStatusFor\(id\)/.test(LBL), 'the label must come from the one rule, not from the raw outcome');
  const label = (o, p) => {
    const doc = {
      getElementsByName: () => [{ checked: !!o, value: o || 'x' }],
      getElementById: (id) => (id === 'tps9' ? { value: p } : null),
    };
    const OUTCOME_OF = (TECH.match(/function outcomeOf\(id\)\{[\s\S]*?\n {2}\}/) || [])[0];
    return new Function('document', `${OUTCOME_OF}\n${DAY_SRC}\n${LBL}\nreturn finishLabel(9);`)(doc);
  };
  assert.ok(/stays OPEN/.test(label('fixed', 'please_order')), 'a held job must not read "finish the job"');
  assert.ok(/finish the job/.test(label('fixed', 'used')));
});

// WIRING: both pickers have to repaint the button, or the label lies until the next tap.
t('the part-status picker repaints the finish button', () => {
  const src = TECH.replace(/\/\/[^\n]*/g, '');   // comments stripped so a note cannot satisfy this
  assert.ok(/select\[id\^="tps"\][\s\S]{0,260}paintFinishBtn/.test(src),
    'changing the part status must repaint the finish button');
});

// Every write of the landing status must go through the one rule.
t('no status write bypasses the one rule', () => {
  const src = TECH.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/outcome === 'return_needed' \?/.test(src),
    'a status write still branches on the outcome alone');
  const writes = src.match(/(?:var qs|var newStatus) = [^\n;]+/g) || [];
  assert.ok(writes.length >= 2, 'expected both status writes to still exist');
  writes.forEach((w) => assert.ok(/finishStatusFor\(/.test(w), 'bypassed the rule: ' + w.trim()));
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — the mirror's office-filing gate, lifted and executed
// ─────────────────────────────────────────────────────────────────────────────
const RANK_SRC  = (MIRROR.match(/const RANK = \{[^}]*\};/) || [])[0];
const CLOCK_SRC = (MIRROR.match(/const CT_DAY = new Intl\.DateTimeFormat[\s\S]*?const isTodayCT = [^\n]*\n/) || [])[0];
const SET_SRC   = (MIRROR.match(/const OFFICE_ACTIVE_STAGE = new Set\(\[[^\]]*\]\);/) || [])[0];
// Anchored on the stable comment header, never on the condition -- so a mutation of the
// condition fails an ASSERTION rather than breaking the lift and reading as a crash.
const GATE_SRC  = (MIRROR.match(/The office filed this card as still-to-do[\s\S]*?\n( {6}const os = officeStage[\s\S]*?\n {6}\}\n)/) || [])[1];

assert.ok(RANK_SRC,  'could not lift RANK from the mirror');
assert.ok(CLOCK_SRC, 'could not lift the CT clock helpers from the mirror');
assert.ok(SET_SRC,   'could not lift OFFICE_ACTIVE_STAGE from the mirror');
assert.ok(GATE_SRC,  'could not lift the office-filing gate from the mirror');

// Run the real gate exactly as the mirror runs it inside its per-job loop.
const applyGate = new Function('jr', 'ex', 'stage', 'doneStamp', `
  ${RANK_SRC}
  ${CLOCK_SRC}
  ${SET_SRC}
  const officeStage = new Map([[Number(jr.xano_id), { stage: stage, doneStamp: doneStamp }]]);
  let keptFiled = 0;
  ${GATE_SRC}
  return { status: jr.status, keptFiled };
`);

const XANO_DONE = () => ({ xano_id: 22041, status: 'completed' });
const PLAT = (over) => Object.assign({ status: 'completed', completed_at: null, started_at: null, en_route_at: null }, over || {});

console.log('\nthe office\'s own filing outranks a stale Xano completion\n');

t("a card Danielle filed in Scheduled is not a finished job", () => {
  const r = applyGate(XANO_DONE(), PLAT(), 'scheduled', false);
  assert.strictEqual(r.status, 'scheduled');
  assert.strictEqual(r.keptFiled, 1);
});

t('Needs Scheduled and Waiting Parts reopen it too', () => {
  assert.strictEqual(applyGate(XANO_DONE(), PLAT(), 'schedule', false).status, 'scheduled');
  assert.strictEqual(applyGate(XANO_DONE(), PLAT(), 'parts', false).status, 'scheduled');
});

t('this catches what the calendar guard cannot: a return trip booked for YESTERDAY', () => {
  // No scheduled_day at all, so bookedAhead is structurally false. The filing still speaks.
  const r = applyGate(XANO_DONE(), PLAT({ scheduled_day: null }), 'scheduled', false);
  assert.strictEqual(r.status, 'scheduled');
});

t('a REAL Xano completion timestamp beats a card nobody moved', () => {
  const r = applyGate(XANO_DONE(), PLAT(), 'scheduled', true);
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptFiled, 0);
});

t('a tech who finished it HERE can never have it undone', () => {
  const r = applyGate(XANO_DONE(), PLAT({ completed_at: '2026-09-15T18:00:00.000Z' }), 'scheduled', false);
  assert.strictEqual(r.status, 'completed');
  assert.strictEqual(r.keptFiled, 0);
});

t('the money and done folders never reopen anything', () => {
  ['paid', 'done', 'needinv', 'inv-4', 'inv-2', 'followup', 'rep-4', ''].forEach((stage) => {
    const r = applyGate(XANO_DONE(), PLAT(), stage, false);
    assert.strictEqual(r.status, 'completed', 'stage ' + (stage || '(none)') + ' must not reopen');
    assert.strictEqual(r.keptFiled, 0);
  });
});

t('a canceled job is left alone', () => {
  const r = applyGate(XANO_DONE(), PLAT({ status: 'canceled' }), 'scheduled', false);
  assert.strictEqual(r.status, 'completed');   // gate skipped; the RANK guard owns cancels
  assert.strictEqual(r.keptFiled, 0);
});

t('it prefers what the platform already knows over guessing', () => {
  const r = applyGate(XANO_DONE(), PLAT({ status: 'awaiting_parts' }), 'scheduled', false);
  assert.strictEqual(r.status, 'awaiting_parts');
});

// 19:00Z is 2pm CDT / 1pm CST -- the same CT calendar day either side of the DST flip.
// ANCHORED ON THE CENTRAL calendar day, never the UTC one: after 7pm CT the UTC date has already
// rolled over, so a UTC-anchored stamp landed on TOMORROW in Central and isTodayCT() correctly
// said no. That made these tests fail only in the evening and pass again after midnight.
const ctStamp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T19:00:00.000Z';

t('a tech who tapped Start today reads in_progress, not scheduled', () => {
  const r = applyGate(XANO_DONE(), PLAT({ started_at: ctStamp() }), 'scheduled', false);
  assert.strictEqual(r.status, 'in_progress');
});

t('en route is driving, not arrived', () => {
  const r = applyGate(XANO_DONE(), PLAT({ en_route_at: ctStamp() }), 'scheduled', false);
  assert.strictEqual(r.status, 'scheduled');
});

// ── WHY current_status IS NOT THE SIGNAL (the measurement that shaped this) ──
t('the gate does not key on current_status', () => {
  assert.ok(!/current_status/.test(GATE_SRC),
    'current_status is stale on 60% of definitively-finished jobs -- keying on it reopens ~200 closed jobs');
});

t('the mirror still builds the filing map from the Xano row', () => {
  assert.ok(/officeStage\.set\(/.test(MIRROR), 'the office_stage map must be built');
  assert.ok(/office_stage/.test(MIRROR), 'the mirror must read office_stage off the Xano job');
  assert.ok(/job_completed_at/.test(MIRROR), 'the gate reads the Xano completion stamp');
});

t('both extra gates are on a live line, not commented out', () => {
  const live = GATE_SRC.replace(/\/\/[^\n]*/g, '');
  assert.ok(/!ex\.completed_at/.test(live), 'the platform completion stamp must gate it');
  assert.ok(/!os\.doneStamp/.test(live), "Xano's completion stamp must gate it");
  assert.ok(/OFFICE_ACTIVE_STAGE\.has\(os\.stage\)/.test(live), 'the filing must gate it');
});

console.log('\n' + n + '/' + n + ' passed\n');

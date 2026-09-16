// The finish button has to name what the save will actually do.
//
// Jimmy, 2026-09-16: "Still won't complete it out, it's saving but not closing the job out."
// His job (Randi Graham, AHS dishwasher) is a RETURN TRIP: the report was written on the
// first visit with outcome=return_needed, and the picker re-selected that stale answer when
// he came back with the parts. He filled the report, every field said "Saved ✓", the pill
// said "Report 100%", he tapped a button reading "Save report + finish" -- and the job went
// back to awaiting_parts, because the status is derived from that picker.
//
// Two lies were in play, and these tests pin both:
//   1. the button promised a finish for outcomes that do not finish
//   2. the stale outcome was re-applied silently, so a return trip's DEFAULT was "stay open"
//
// Every function below is lifted out of the shipped page and EXECUTED. Pattern-matching the
// source would only prove the words are there.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB  = fs.readFileSync(path.join(__dirname, '..', 'platform', 'tech-job.html'), 'utf8');
const LIST = fs.readFileSync(path.join(__dirname, '..', 'platform', 'tech.html'), 'utf8');

// ── lift a named function out of the page by balancing its braces ──
function lift(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  assert.ok(m, 'could not find function ' + name + ' -- the lift is broken, not the page');
  const start = m.index;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}

// strip comments so an assertion can never be satisfied by a code comment
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function fakeEl() {
  const cls = new Set();
  return {
    textContent: '',
    _cls: cls,
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); }
    },
    closest: function () { return this._card || null; },
    querySelector: function () { return this._hint || null; },
    scrollIntoView: () => {}
  };
}

// ── sandbox for the job page ───────────────────────────────────────
function jobEnv() {
  const saveBtn = fakeEl();
  const ostat = fakeEl();
  const card = fakeEl();
  const hint = fakeEl();
  ostat._card = card;
  card._hint = hint;   // needOutcome asks the CARD for .fld-hint, not the picker
  const ctx = {
    outcomeSel: 'fixed',
    partStatus: '',
    saveBtn, ostat, card, hint,
    document: {
      getElementById: (id) => (id === 'saveTdr' ? saveBtn : id === 'ostat' ? ostat : null)
    }
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(JOB, 'finishStatus') + '\n' + lift(JOB, 'paintFinishBtn') + '\n' + lift(JOB, 'needOutcome'),
    ctx
  );
  return ctx;
}

// ── sandbox for the day list ───────────────────────────────────────
// partStatus is the second half of the rule: the day list used to read the outcome alone,
// so "Job complete" + "Office needs to order it" finished a job whose part was not ordered
// (Danielle, 2026-09-16). finishStatusFor owns both pickers now, so the lift carries it.
function listEnv(checkedValue, partStatus) {
  const btn = fakeEl();
  const radios = ['fixed', 'return_needed', 'not_fixable'].map((v) => ({
    value: v, checked: v === checkedValue, name: 'oJOB1'
  }));
  const ctx = {
    btn,
    document: {
      getElementsByName: (n) => (n === 'oJOB1' ? radios : []),
      getElementById: (id) => (id === 'tpsJOB1' ? { value: partStatus || '' } : null),
      querySelector: (sel) => (sel.indexOf('data-savetdr') >= 0 ? btn : null)
    }
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(LIST, 'outcomeOf') + '\n' + lift(LIST, 'finishStatusFor') + '\n'
      + lift(LIST, 'finishLabel') + '\n' + lift(LIST, 'paintFinishBtn'),
    ctx
  );
  return ctx;
}

// ══ the job page ═══════════════════════════════════════════════════

test('a return visit does NOT promise a finish', () => {
  const e = jobEnv();
  e.outcomeSel = 'return_needed';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'awaiting_parts');
  vm.runInContext('paintFinishBtn()', e);
  assert.match(e.saveBtn.textContent, /stays OPEN/i);
  assert.doesNotMatch(e.saveBtn.textContent, /finish the job/i);
});

test('THE INVISIBLE ONE: "Job complete" + a part to order still does not finish', () => {
  // The status line is (outcome==='return_needed' || part is please_order/missing).
  // A tech can pick "Job complete" and STILL leave the job open by tapping Please order --
  // and nothing on screen used to say so.
  const e = jobEnv();
  e.outcomeSel = 'fixed';
  e.partStatus = 'please_order';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'awaiting_parts');
  vm.runInContext('paintFinishBtn()', e);
  assert.match(e.saveBtn.textContent, /stays OPEN/i);
  assert.doesNotMatch(e.saveBtn.textContent, /finish the job/i);
});

test('a missing part also keeps the job open, and the button says so', () => {
  const e = jobEnv();
  e.outcomeSel = 'fixed';
  e.partStatus = 'missing';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'awaiting_parts');
  vm.runInContext('paintFinishBtn()', e);
  assert.match(e.saveBtn.textContent, /stays OPEN/i);
});

test('a real finish still reads as a finish', () => {
  const e = jobEnv();
  e.outcomeSel = 'fixed';
  e.partStatus = '';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'completed');
  vm.runInContext('paintFinishBtn()', e);
  assert.match(e.saveBtn.textContent, /finish the job/i);
  assert.strictEqual(e.saveBtn._cls.has('staysopen'), false);
});

test('not fixable finishes the job too', () => {
  const e = jobEnv();
  e.outcomeSel = 'not_fixable';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'completed');
});

test('used / truck-stock parts do not hold a finished job open', () => {
  for (const ps of ['used', 'truck', 'none', 'return']) {
    const e = jobEnv();
    e.outcomeSel = 'fixed';
    e.partStatus = ps;
    assert.strictEqual(vm.runInContext('finishStatus()', e), 'completed', ps + ' should finish');
  }
});

test('reassign keeps its own words', () => {
  const e = jobEnv();
  e.outcomeSel = 'reassign';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'reassign');
  vm.runInContext('paintFinishBtn()', e);
  assert.match(e.saveBtn.textContent, /back to the office/i);
});

test('an unanswered picker is its own state, not a silent finish', () => {
  const e = jobEnv();
  e.outcomeSel = '';
  assert.strictEqual(vm.runInContext('finishStatus()', e), 'unanswered');
});

test('the amber class rides exactly the stays-open case', () => {
  const e = jobEnv();
  e.outcomeSel = 'return_needed';
  vm.runInContext('paintFinishBtn()', e);
  assert.ok(e.saveBtn._cls.has('staysopen'), 'stays-open save must not look like a finish');
  e.outcomeSel = 'fixed';
  vm.runInContext('paintFinishBtn()', e);
  assert.strictEqual(e.saveBtn._cls.has('staysopen'), false, 'and must clear when it does finish');
});

test('the re-ask paints the card and puts the question ON it', () => {
  const e = jobEnv();
  vm.runInContext('needOutcome()', e);
  assert.ok(e.card._cls.has('needs'), 'the job-status card has to go red');
  assert.match(e.hint.textContent, /THIS time/i);
});

// ── the stale-outcome carry-forward, run as the page runs it ───────
test('a return trip is asked fresh; every other prior answer is kept', () => {
  const m = JOB.match(/var priorOutcome\s*=[\s\S]{0,260}?outcomeSel\s*=[^\n]*\n/);
  assert.ok(m, 'could not lift the outcome pre-select');
  const code = m[0];
  const run = (prior) => {
    const ctx = { outcomeSel: 'SENTINEL', tdr: () => (prior === null ? null : { outcome: prior }) };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx.outcomeSel;
  };
  assert.strictEqual(run('return_needed'), '', 'last visit said "coming back" -- ask again');
  assert.strictEqual(run('fixed'), 'fixed');
  assert.strictEqual(run('not_fixable'), 'not_fixable');
  assert.strictEqual(run(null), 'fixed', 'a brand new report still opens on Job complete');
});

// ── the gate has to sit in front of every write, on a live line ────
test('saveTdr refuses to write anything until the picker is answered', () => {
  const body = stripComments(lift(JOB, 'saveTdr'));
  const gate = body.indexOf('if(!outcomeSel)');
  assert.ok(gate > 0, 'the unanswered-outcome gate is gone');
  assert.doesNotMatch(
    body.slice(Math.max(0, gate - 40), gate),
    /(false|0)\s*&&\s*$/,
    'the gate must not be short-circuited dead'
  );
  const firstWrite = body.search(/putTdr\(\)|AntSave\.write/);
  assert.ok(firstWrite > 0, 'could not find the write');
  assert.ok(gate < firstWrite, 'the gate must come BEFORE anything is written');
});

test('the job-status card stops reading as 100% when nothing is picked', () => {
  const body = stripComments(lift(JOB, 'paintFlds'));
  assert.match(body, /data-always[\s\S]{0,400}#ostat[\s\S]{0,200}outcomeSel/,
    'an unanswered picker must not count as a filled field');
});

// ══ the day list ═══════════════════════════════════════════════════

test('day list: a return visit does not promise a finish either', () => {
  const e = listEnv('return_needed');
  assert.strictEqual(vm.runInContext('outcomeOf("JOB1")', e), 'return_needed');
  vm.runInContext('paintFinishBtn("JOB1")', e);
  assert.match(e.btn.textContent, /stays OPEN/i);
  assert.doesNotMatch(e.btn.textContent, /finish the job/i);
  assert.ok(e.btn._cls.has('staysopen'));
});

test('day list: THE INVISIBLE ONE — "Job complete" + a part to order does NOT finish', () => {
  // The bug Danielle hit: this surface read the outcome alone, so these two taps landed
  // COMPLETED here while the same two taps landed awaiting_parts on the job page.
  const e = listEnv('fixed', 'please_order');
  assert.strictEqual(vm.runInContext('finishStatusFor("JOB1")', e), 'awaiting_parts');
  vm.runInContext('paintFinishBtn("JOB1")', e);
  assert.match(e.btn.textContent, /stays OPEN/i);
  assert.ok(e.btn._cls.has('staysopen'));
});

test('day list: a real finish reads as a finish', () => {
  const e = listEnv('fixed');
  vm.runInContext('paintFinishBtn("JOB1")', e);
  assert.match(e.btn.textContent, /finish the job/i);
  assert.strictEqual(e.btn._cls.has('staysopen'), false);
});

test('day list: nothing checked reports nothing, never a silent "fixed"', () => {
  const e = listEnv(null);
  assert.strictEqual(vm.runInContext('outcomeOf("JOB1")', e), '',
    'defaulting to fixed here would CLOSE a job that still needs a part');
});

test('day list: the stale "needs a return" radio is never re-checked', () => {
  const m = LIST.match(/value="return_needed"[^\n]*Needs a return/);
  assert.ok(m, 'could not find the return_needed radio');
  assert.doesNotMatch(m[0], /checked/,
    're-checking last visit’s answer is what sent finished return trips back to Awaiting parts');
});

test('day list: saveTdr gates on an unanswered picker before it writes', () => {
  const body = stripComments(lift(LIST, 'saveTdr'));
  assert.doesNotMatch(body, /var outcome\s*=\s*'fixed'/,
    'the silent fixed default is the dangerous direction -- it closes open jobs');
  const gate = body.indexOf('if(!outcome)');
  assert.ok(gate > 0, 'the unanswered-outcome gate is gone');
  const firstWrite = body.search(/AntSave\.write|saveDraft\(/);
  assert.ok(firstWrite > 0 && gate < firstWrite, 'the gate must come BEFORE anything is written');
});

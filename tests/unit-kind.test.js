// Pins the rule that lets a unit say what MACHINE it is.
//
// The bug this replaces: platform-tn-mirror hardcoded `kind: 'appliance'` on every unit it
// wrote, every 5 minutes -- while `attributes.appliance` sat on the same row holding the real
// answer for 1,260 of 1,438 units. Measured 2026-09-18:
//
//     unit.kind     1,372  "appliance"   <- the placeholder, 95% of the table
//                      22  refrigerator
//                      14  washer
//                      12  dishwasher
//
// That blank type is the dead tier in brain_lookup (model -> family -> brand -> TYPE ->
// trade) and the reason the repair corpus can report "compressor, 7 times" without naming
// what it was in. It was never an inference problem. It was a discard.
//
// Two things are pinned here, because either one alone is theater:
//   1. the RULE (unitKind) -- executed, against the real shapes on the live table
//   2. the WIRING -- that the mirror computes it instead of a constant, and that keepTyped
//      guards it. Without the guard, one feed run with a blank appliance field stomps a
//      known machine back to the placeholder and the backfill has to be re-run forever.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { unitKind, isPlaceholderKind } = require('../netlify/functions/_lib/multi-appliance');
const MIRROR = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'platform-tn-mirror.js'), 'utf8');
// Comments describe the fix; only live code counts as the fix.
const MIRROR_CODE = MIRROR.replace(/^\s*\/\/.*$/gm, '');

// ── 1. the rule, against values actually on the live table ──────────────────────────────
test('the appliance field decides when it has one', () => {
  assert.equal(unitKind({ appliance: 'washer' }), 'washer');
  assert.equal(unitKind({ appliance: 'dryer' }), 'dryer');
  assert.equal(unitKind({ appliance: 'refrigerator' }), 'refrigerator');
});

test('"refrigerator ice maker" is a refrigerator, not an unknown', () => {
  // 26 live rows carry exactly this string.
  assert.equal(unitKind({ appliance: 'refrigerator ice maker' }), 'refrigerator');
});

test('a dishwasher never reads as a washer', () => {
  // The substring trap the shared vocabulary is ordered to defeat. 12 live dishwashers.
  assert.equal(unitKind({ appliance: 'dishwasher' }), 'dishwasher');
  assert.equal(unitKind({ label: 'Samsung dishwasher' }), 'dishwasher');
  assert.equal(unitKind({ appliance: 'dish washer' }), 'dishwasher');
});

test('the brand is not the identity', () => {
  assert.equal(unitKind({ label: 'Samsung dryer' }), 'dryer');
  assert.equal(unitKind({ label: 'Whirlpool refrigerator' }), 'refrigerator');
  // brand alone names no machine
  assert.equal(unitKind({ label: 'Samsung' }), null);
});

test('"other" is a placeholder, not a machine', () => {
  // 45 live rows say "other". Treating it as a type would be a lie with a name on it.
  assert.equal(unitKind({ appliance: 'other' }), null);
  assert.equal(unitKind({ appliance: 'other', label: 'Samsung dishwasher' }), 'dishwasher');
  assert.ok(isPlaceholderKind('appliance') && isPlaceholderKind('other') && isPlaceholderKind(''));
  assert.ok(!isPlaceholderKind('washer'));
});

test('free text goes through the word-boundary matcher, never a substring', () => {
  // "makes a STRANGE noise" contains "range". A substring match reads it as a stove.
  assert.equal(unitKind({ problem: 'makes a strange noise when it spins' }), null);
  assert.equal(unitKind({ problem: 'the dryer will not heat' }), 'dryer');
});

test('two appliances in the text refuses to pick a winner', () => {
  // That is a real multi-machine question for a human, not a coin flip.
  assert.equal(unitKind({ problem: 'washer is leaking and the dryer will not heat' }), null);
});

test('the model speaks only when nothing else can', () => {
  assert.equal(unitKind({ model: 'WTW5000DW1' }), 'washer');
  // and never overrides a witness that already spoke
  assert.equal(unitKind({ appliance: 'dryer', model: 'WTW5000DW1' }), 'dryer');
  // an unknown prefix invents nothing
  assert.equal(unitKind({ model: 'ZZQ9999X' }), null);
});

test('knowing nothing returns null, so the caller writes the placeholder', () => {
  assert.equal(unitKind({}), null);
  assert.equal(unitKind({ appliance: '', label: '', problem: '', model: '' }), null);
});

// ── 2. the wiring ───────────────────────────────────────────────────────────────────────
test('the mirror computes the kind instead of hardcoding it', () => {
  assert.ok(/kind:\s*unitKind\(/.test(MIRROR_CODE), 'mirror must compute kind via the shared rule');
  assert.ok(!/kind:\s*'appliance',/.test(MIRROR_CODE), 'the hardcoded constant must be gone');
});

test('the mirror feeds the rule every signal the row carries', () => {
  const call = (MIRROR_CODE.match(/kind:\s*unitKind\(\{[^}]*\}/) || [''])[0];
  assert.ok(call, 'expected a unitKind call on the unit row');
  for (const f of ['appliance:', 'label:', 'problem:', 'model:']) {
    assert.ok(call.includes(f), 'unitKind call is missing ' + f);
  }
  // The feed field is problem_summary. `j.problem` is undefined on this row, so naming it
  // would silently kill the free-text tier while still looking wired.
  assert.ok(/problem:\s*j\.problem_summary/.test(call), 'must read j.problem_summary, not j.problem');
});

test('keepTyped guards kind, so a blank feed run cannot un-name a machine', () => {
  assert.ok(
    /keepTyped\('unit',\s*unitRows,\s*\[[^\]]*'kind'[^\]]*\]\)/.test(MIRROR_CODE),
    'kind must be in the unit keepTyped guard',
  );
});

test('the guard treats a placeholder kind as blank', () => {
  // Without this the guard is inert for kind: the incoming 'appliance' is a non-empty string,
  // so it would sail through and overwrite the real type every single run.
  assert.ok(
    /k === 'kind' && isPlaceholderKind\(inStr\)/.test(MIRROR_CODE),
    'keepTyped must count a placeholder kind as blank',
  );
});

test('the frozen-unit backfill exists, pages, and is blank-only', () => {
  assert.ok(/async function backfillKinds\(/.test(MIRROR_CODE), 'backfillKinds must exist');
  const fn = MIRROR_CODE.slice(MIRROR_CODE.indexOf('async function backfillKinds('));
  const body = fn.slice(0, fn.indexOf('\nasync function '));
  // The mirror only walks ACTIVE statuses, so completed jobs' units never get revisited.
  assert.ok(/offset \+= 1000/.test(body), 'must page: PostgREST caps at 1,000 rows silently');
  // A loop that EXISTS is not a loop that CONTINUES. It must only stop on a SHORT page --
  // an unconditional break reads exactly 1,000 units and leaves the rest unnamed forever,
  // with no error anywhere to say so. Same off-by-one that once served 1,000 of 1,129.
  assert.ok(
    /if \(rows\.length < 1000\) break;/.test(body),
    'must keep paging until a page comes back short',
  );
  assert.ok(!/\n\s*break;\s*\n\s*\}/.test(body), 'no unconditional break inside the page loop');
  assert.ok(/isPlaceholderKind\(u\.kind\)/.test(body), 'must only touch units still on the placeholder');
  assert.ok(/backfill_kinds === '1'/.test(MIRROR_CODE), 'must be reachable from the handler');
});

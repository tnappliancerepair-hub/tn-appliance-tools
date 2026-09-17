// Pins the TDR note we push onto an AHS dispatch.
//
// This file had NO test until 2026-09-17, while composing the exact text an AHS reviewer
// reads on a completed claim. Probing a realistic note (the 900-char cap, not the 30-char
// "Ant connectivity test" every prior probe used) surfaced three defects at once:
//
//   1. DOUBLE PERIODS -- "reads open as well.." because a tech's free text usually already
//      ends in punctuation and the composer appended another. One branch already guarded
//      with /[.!?]$/ and the other five did not.
//   2. MID-WORD TRUNCATION -- .slice(0, 900) cut "cleaned the blower housing" to
//      "cleaned the blower".
//   3. THE ONE THAT COSTS MONEY -- Labor and Parts-to-return were composed LAST, so a long
//      diagnosis pushed them past 900 and they vanished silently. Labor is what AHS pays
//      on. Parts-to-return is the chargeback field: SquareTrade/AHS policy is that an
//      unreturned part means the repair is not paid AND the part can be charged back. A
//      claim note that drops it is a direct money leak.
//
// So the tail is now RESERVED out of the budget and the prose is trimmed around it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const tdrLib = require('../netlify/functions/_lib/frontdoor-tdr.js');

const MAX = 900;

// A real-shaped report: free text that already ends in periods, and long enough that the
// naive slice-at-900 dropped the tail. This is the case that was broken in production.
function longBundle() {
  return {
    brand: 'Whirlpool',
    appliance_type: 'Dryer',
    tdr: {
      diagnosis: 'No heat on any cycle. Drum turns, blower ok, airflow at vent is strong so not a restriction. Ohmed the heating element open at both terminals, and the thermal cutoff reads open as well.',
      failed_component: 'Heating element and thermal cutoff kit',
      failure_cause: 'Element burned open, taking the thermal cutoff with it. Lint build-up in the blower housing contributed to the overheat.',
      verified_part_number: 'W10724237',
      repair_completed: 'installed new heating element and thermal cutoff kit, cleaned the blower housing and lint chute, reassembled and ran a full timed dry cycle',
      labor_time_hours: 1.5,
      parts_used: [{ name: 'Heating element kit', part_number: 'W10724237' }],
      parts_not_used: [{ name: 'Cycling thermostat', part_number: 'WP8577274' }],
    },
  };
}

test('the note never exceeds the 900-char field budget', () => {
  const n = tdrLib.composeTdrNote(longBundle());
  assert.ok(n.length <= MAX, `note is ${n.length} chars, cap is ${MAX}`);
});

test('LABOR survives a long diagnosis -- it is what AHS pays on', () => {
  const n = tdrLib.composeTdrNote(longBundle());
  assert.match(n, /Labor: 1\.5 hrs\./, 'labor was dropped by truncation');
});

test('PARTS TO RETURN survives a long diagnosis -- it is the chargeback field', () => {
  const n = tdrLib.composeTdrNote(longBundle());
  assert.match(n, /Parts to return: Cycling thermostat \(WP8577274\)\./,
    'the return obligation was dropped by truncation -- unreturned parts are charged back');
});

test('no doubled periods when the tech free text already ends in punctuation', () => {
  const n = tdrLib.composeTdrNote(longBundle());
  assert.equal((n.match(/\.\./g) || []).length, 0, `doubled periods in: ${n}`);
});

test('truncation never cuts a word in half', () => {
  // Force truncation with prose far past the cap, and no tail to reserve.
  const b = longBundle();
  b.tdr.diagnosis = ('The customer reports intermittent failure across multiple cycles. ').repeat(30);
  delete b.tdr.labor_time_hours;
  delete b.tdr.parts_not_used;
  const n = tdrLib.composeTdrNote(b);
  assert.ok(n.length <= MAX, 'still within budget');
  // Either it ended a sentence, or it ended with the explicit ellipsis -- never a bare
  // half-word like "cleaned the blower".
  assert.ok(/[.!?]$/.test(n) || /\.\.\.$/.test(n), `note ends mid-word: ${JSON.stringify(n.slice(-40))}`);
});

test('a short note is left completely alone (no truncation, no ellipsis)', () => {
  const n = tdrLib.composeTdrNote({
    brand: 'GE', appliance_type: 'Dishwasher',
    tdr: { diagnosis: 'Drain pump seized', repair_completed: 'replaced drain pump', labor_time_hours: 1 },
  });
  assert.ok(n.length < 400, 'short report should stay short');
  assert.ok(!n.includes('...'), 'short note must not be ellipsised');
  assert.match(n, /Labor: 1 hr\./, 'singular hour');
});

test('dot() adds a period only when one is missing', () => {
  assert.equal(tdrLib.dot('no trailing punctuation'), 'no trailing punctuation.');
  assert.equal(tdrLib.dot('already ends here.'), 'already ends here.');
  assert.equal(tdrLib.dot('a question?'), 'a question?');
  assert.equal(tdrLib.dot(''), '');
});

test('trimTo prefers a sentence boundary and never emits a half word', () => {
  const s = 'First sentence here. Second sentence runs considerably longer than the budget allows.';
  const out = tdrLib.trimTo(s, 40);
  assert.ok(out.length <= 40, `got ${out.length}`);
  assert.ok(/[.!?]$/.test(out) || /\.\.\.$/.test(out), `bad ending: ${JSON.stringify(out)}`);
  assert.ok(!/\ban?\s*$/.test(out), 'ends on a dangling word');
});

test('the tail is reserved even when the prose alone would fill the whole budget', () => {
  const b = longBundle();
  b.tdr.diagnosis = ('Extremely verbose diagnostic narrative that keeps going. ').repeat(40);
  const n = tdrLib.composeTdrNote(b);
  assert.ok(n.length <= MAX, `over budget at ${n.length}`);
  assert.match(n, /Labor: 1\.5 hrs\./, 'labor lost when prose is enormous');
  assert.match(n, /Parts to return:/, 'return obligation lost when prose is enormous');
});

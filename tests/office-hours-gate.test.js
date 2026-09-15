// Unit test for the office-texml OFF-HOURS RING GATE (Teddy 2026-09-15:
// "close that after-hours hole on the ring group - Ann only before 9 am and after 5 pm").
//
// This is LIVE CALL ROUTING. A wrong gate either (a) rings a dispatcher's personal cell at
// 2am - the exact thing Danielle reported - or (b) silently kills every business-hours
// transfer, which is far worse. So the decision is extracted verbatim from office-texml.js
// and exercised against the hours that actually matter.
'use strict';
const assert = require('assert');
const fs = require('fs');

const SRC = fs.readFileSync(__dirname + '/../netlify/functions/office-texml.js', 'utf8');

// Pull the REAL lines out of the shipped file so this test can never drift from the code.
function lift(re, label) {
  const m = SRC.match(re);
  assert.ok(m, 'could not find ' + label + ' in office-texml.js - gate may have been renamed');
  return m[0];
}
const body = [
  lift(/const hoursGateOn = [^\n]+/, 'hoursGateOn'),
  lift(/let openHour = [^\n]+/, 'openHour'),
  lift(/let closeHour = [^\n]+/, 'closeHour'),
  lift(/const clockUnknown = [^\n]+/, 'clockUnknown'),
  lift(/const officeOpen = [^\n]+/, 'officeOpen'),
  'return { blocked: hoursGateOn && !officeOpen, openHour, closeHour };',
].join('\n');
// eslint-disable-next-line no-new-func
const decide = new Function('hoursGateRaw', 'hoursOpenRaw', 'hoursCloseRaw', '_ct', body);

const wd = (h) => ({ h, weekday: true });   // a weekday at hour h
const we = (h) => ({ h, weekday: false });  // a weekend at hour h
const blocked = (ct, gate, open, close) => decide(gate, open, close, ct).blocked;

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// ── the window Teddy asked for: humans 9:00am - 4:59pm CT, Ann owns everything else.
ok(blocked(wd(8)) === true,  'weekday 8am is BLOCKED (before 9)');
ok(blocked(wd(9)) === false, 'weekday 9am RINGS (open hour, Danielle-first)');
ok(blocked(wd(12)) === false, 'weekday noon RINGS');
ok(blocked(wd(16)) === false, 'weekday 4pm RINGS (last human hour)');
ok(blocked(wd(17)) === true, 'weekday 5pm is BLOCKED - Ann owns 5:00 on');
ok(blocked(wd(18)) === true, 'weekday 6pm is BLOCKED - this is Danielle\'s exact complaint');
ok(blocked(wd(21)) === true, 'weekday 9pm is BLOCKED');
ok(blocked(wd(2)) === true,  'weekday 2am is BLOCKED');
ok(blocked(wd(0)) === true,  'midnight is BLOCKED (hour 0 must not read as falsy-open)');

// ── weekends: nobody rings, any hour.
ok(blocked(we(12)) === true, 'weekend noon is BLOCKED');
ok(blocked(we(10)) === true, 'weekend 10am is BLOCKED');

// ── FAIL-SAFE: an unknown clock must never silence the phones.
ok(blocked({ h: -1, weekday: false }) === false, 'ctNow() failure (h:-1) RINGS - never kill transfers on a broken clock');

// ── FAIL-SAFE: a blank/timed-out vault read leaves the gate ON but cannot block business hours.
ok(blocked(wd(12), '') === false, 'blank vault read still RINGS at noon');
ok(blocked(wd(22), '') === true,  'blank vault read still BLOCKS at 10pm (gate defaults ON)');
ok(blocked(wd(22), undefined) === true, 'undefined vault read still BLOCKS');

// ── the kill switch, and only the exact word.
ok(blocked(wd(22), 'off') === false, 'OFFICE_HOURS_GATE=off reverts instantly');
ok(blocked(wd(22), ' OFF ') === false, 'kill switch is trimmed + case-insensitive');
ok(blocked(wd(22), 'on') === true, "'on' does NOT disable the gate");
ok(blocked(wd(22), 'false') === true, "a near-miss value ('false') does NOT disable the gate");

// ── window is vault-tunable, and garbage falls back to 9/17.
ok(blocked(wd(17), '', '9', '18') === false, 'OFFICE_HOURS_CLOSE=18 puts 5pm back in the window');
ok(blocked(wd(7), '', '7', '17') === false, 'OFFICE_HOURS_OPEN=7 opens 7am');
ok(blocked(wd(8), '', 'banana', 'banana') === true, 'garbage hours fall back to the 9/17 default');
ok(decide('', '99', '-4', wd(12)).openHour === 9, 'out-of-range OPEN clamps back to 9');
ok(decide('', '99', '-4', wd(12)).closeHour === 17, 'out-of-range CLOSE clamps back to 17');
ok(decide('', '0', '0', wd(12)).openHour === 0, 'hour 0 is a legal configured value, not garbage');

console.log('office-hours-gate: ' + n + '/' + n + ' pass');

// ── FIRST LEG ONLY. A ?leg=2+ request is the action webhook for a ring that already
// happened; gating it would discard that call's answered/missed outcome and text a caller
// "we're closed" right after they hung up with a human (4:59 ring, 5:00 callback).
const legSrc = lift(/const firstLeg = [^\n]+/, 'firstLeg');
// eslint-disable-next-line no-new-func
const isFirstLeg = new Function('qs', legSrc + '\nreturn firstLeg;');
ok(isFirstLeg({}) === true, 'no ?leg= is the first leg (gate applies)');
ok(isFirstLeg({ leg: '1' }) === true, '?leg=1 is the first leg (gate applies)');
ok(isFirstLeg({ leg: '2' }) === false, '?leg=2 is an action callback (gate must NOT apply)');
ok(isFirstLeg({ leg: '3' }) === false, '?leg=3 is an action callback (gate must NOT apply)');
ok(isFirstLeg({ leg: 'banana' }) === true, 'garbage ?leg= falls back to first-leg semantics');
console.log('first-leg guard: 5/5 pass');

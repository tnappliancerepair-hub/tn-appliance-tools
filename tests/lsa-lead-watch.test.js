// lsa-lead-watch — the clock + label helpers, LIFTED OUT OF THE SHIPPED FILE so the test
// can never drift from what actually texts Teddy.
//
// The clock is the load-bearing part. Google writes local_services_lead.creation_date_time
// in the ACCOUNT timezone, which for the LSA customer (8532272803) is America/Chicago --
// verified live 2026-09-15. So the stamp is ALREADY Central and must be read as a wall
// clock, never shifted through UTC. Shift it and a 2:49 PM lead reads 7:49 PM on his
// phone and the "3h unanswered" nag fires five hours early.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const SRC = fs.readFileSync(require.resolve('../netlify/functions/lsa-lead-watch.js'), 'utf8');

// Lift each helper by name, anchored to the function, never to a character count.
function lift(name) {
  const re = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
  const m = re.exec(SRC);
  assert.ok(m, `could not lift ${name}() out of lsa-lead-watch.js`);
  return m[0];
}
const H = (() => {
  const src = [lift('ctParts'), lift('clockCT'), lift('minsSinceCT'), lift('serviceLabel')].join('\n')
    + "\nconst ord = " + (/const ord = ([^;]+);/.exec(SRC) || [])[1] + ';'
    + '\nreturn { ctParts, clockCT, minsSinceCT, serviceLabel, ord };';
  return new Function(src)();
})();

test('a Central stamp is read as a wall clock, not shifted through UTC', () => {
  assert.strictEqual(H.clockCT('2026-09-15 14:49:03'), '2:49 PM');
  assert.strictEqual(H.clockCT('2026-09-15 10:24:26'), '10:24 AM');
  assert.strictEqual(H.clockCT('2026-09-15 15:47:17'), '3:47 PM');
});

test('midnight and noon do not collapse to 0', () => {
  assert.strictEqual(H.clockCT('2026-09-15 00:05:00'), '12:05 AM');
  assert.strictEqual(H.clockCT('2026-09-15 12:00:00'), '12:00 PM');
});

test('an unparseable stamp yields blank, never a wrong time', () => {
  assert.strictEqual(H.clockCT(''), '');
  assert.strictEqual(H.clockCT('not a date'), '');
  assert.strictEqual(H.clockCT(null), '');
});

test('minsSinceCT measures against the same Central clock in both directions', () => {
  // Build "45 minutes ago" in Central and assert the helper agrees within a minute.
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(Date.now() - 45 * 60000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const stamp = `${f.year}-${f.month}-${f.day} ${f.hour === '24' ? '00' : f.hour}:${f.minute}:00`;
  const got = H.minsSinceCT(stamp);
  assert.ok(Math.abs(got - 45) <= 1, `expected ~45 min, got ${got}`);
});

test('minsSinceCT crosses midnight without going negative', () => {
  // 11:50 PM yesterday, Central -> well over an hour ago, never a negative number.
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() - 86400000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const got = H.minsSinceCT(`${f.year}-${f.month}-${f.day} 23:50:00`);
  assert.ok(got > 0, `yesterday must be in the past, got ${got}`);
});

test('an unparseable stamp is 0 minutes old, so it can never trip the nag', () => {
  // 0 is below RENAG_H*60, so garbage never nags -- it only ever looks brand new, and
  // the first-touch path is deduped by the ledger. Failing the other way would let a
  // malformed stamp nag forever.
  assert.strictEqual(H.minsSinceCT('garbage'), 0);
});

test('service ids read like something a human says out loud', () => {
  assert.strictEqual(H.serviceLabel('repair_refrigerator'), 'refrigerator repair');
  assert.strictEqual(H.serviceLabel('repair_dryer'), 'dryer repair');
  assert.strictEqual(H.serviceLabel('repair_washer'), 'washer repair');
  assert.strictEqual(H.serviceLabel('repair_garbage_disposal'), 'garbage disposal repair');
});

test('a missing service id never renders blank on his phone', () => {
  // Real data: 3 of the 6 leads on 2026-09-15 came back with no serviceId at all.
  assert.strictEqual(H.serviceLabel(''), 'appliance repair');
  assert.strictEqual(H.serviceLabel(null), 'appliance repair');
  assert.strictEqual(H.serviceLabel(undefined), 'appliance repair');
});

test('an unmapped service id is shown, not swallowed', () => {
  assert.strictEqual(H.serviceLabel('install_dishwasher'), 'install dishwasher');
});

test('ordinals read correctly for a realistic days worth of leads', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 6].map(H.ord), ['1st', '2nd', '3rd', '4th', '6th']);
});

test('the owner gate: the tag is allowlisted to Teddy and nobody else', () => {
  const gate = require('../netlify/functions/_lib/office-gate');
  const tag = /const TAG\s*=\s*'([a-z_]+)'/.exec(SRC);
  assert.ok(tag, 'could not lift TAG out of lsa-lead-watch.js');
  assert.strictEqual(gate.officeBlocked('+16154855795', tag[1]), false, 'Teddy must receive it');
  for (const other of ['+16154850713', '+16292594602', '+12258035669']) {
    assert.strictEqual(gate.officeBlocked(other, tag[1]), true, `${other} must never receive it`);
  }
});

test('forward-only floor and the run cap are real, not aspirational', () => {
  const maxH = Number((/const FIRST_TOUCH_MAX_H\s*=\s*(\d+)/.exec(SRC) || [])[1]);
  const cap  = Number((/const MAX_PER_RUN\s*=\s*(\d+)/.exec(SRC) || [])[1]);
  assert.ok(maxH > 0 && maxH <= 6, `first-touch floor must bound the first run, got ${maxH}`);
  assert.ok(cap > 0 && cap <= 10, `per-run cap must bound a burst, got ${cap}`);
  // A lead older than the floor must not qualify as a first touch.
  assert.ok(H.minsSinceCT('2020-01-01 09:00:00') > maxH * 60, 'an old lead must be past the floor');
});

test('it never texts the customer and never names the office crew', () => {
  assert.ok(!/OFFICE_CELL|6154850713|6292594602|2258035669/.test(SRC), 'no office cells in this file');
  assert.ok(!/sendSms\(\s*(?!OWNER)/.test(SRC.replace(/sendSmsDetailed/g, 'X')), 'only the owner is texted');
});

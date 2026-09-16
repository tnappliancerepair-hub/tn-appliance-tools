// Jimmy, 2026-09-16: "part numbers are not showing in the office."
//
// partsByJob feeds the office tile's 🔧 part-number chip. It was built through
// partOnThisJob() -- the INVOICE rule (don't bill a part we never got, sent back, or
// kept). So the moment a tech marked a part "never came", its NUMBER disappeared from
// the office tile, leaving Danielle a red "❌ 2 PARTS NEVER CAME" chip and nothing to
// chase the vendor with. Same class as the 2026-09-15 fix that moved the tile's COUNTING
// ahead of that guard; the counting was corrected then, the display was not.
//
// Both rules are lifted OUT of the shipped page and EXECUTED so this cannot drift.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const HTML = fs.readFileSync(__dirname + '/../platform/office-board.html', 'utf8');

const ruleSrc = (HTML.match(/function partOnThisJob\(disp\)\{[\s\S]*?\n  \}/) || [])[0];
assert.ok(ruleSrc, 'partOnThisJob() must exist');
const partOnThisJob = new Function(ruleSrc + '\nreturn partOnThisJob;')();

// NOTE: there are TWO `(pr.data || []).forEach(...)` blocks -- the one above builds
// partsShipByJob (the COUNTER, which correctly ignores the money rule already). Anchor on the
// body that pushes into partsByJob, and keep it single-line so it cannot wander into the other.
const BUILDER_RE = /\(pr\.data \|\| \[\]\)\.forEach\((function \(p\) \{[^\n]*partsByJob\[p\.job_id\][^\n]*\})\);/;
const cbSrc = (HTML.match(BUILDER_RE) || [])[1];
assert.ok(cbSrc, 'the partsByJob builder must exist');
const makeCb = new Function('partsByJob', 'return ' + cbSrc + ';');

function build(rows) {
  const bucket = {};
  rows.forEach(makeCb(bucket));
  return bucket;
}

const JOB = 'j1';
const row = (number, disposition) => ({ job_id: JOB, number, name: 'PART', disposition });

// ── THE BUG ────────────────────────────────────────────────────────────────────────
test('a part marked never-came still shows its number to the office', () => {
  const b = build([row('WE04X25194', 'not_here')]);
  assert.ok(b[JOB] && b[JOB].length === 1, 'the office must still see the part');
  assert.strictEqual(b[JOB][0].number, 'WE04X25194');
});

test('owed-back and shelved parts keep their numbers too', () => {
  for (const d of ['return', 'shelf']) {
    const b = build([row('W11483553', d)]);
    assert.ok(b[JOB] && b[JOB].length === 1, d + ' must still display');
  }
});

test('every disposition reaches the office tile', () => {
  const all = ['', 'used', 'return', 'shelf', 'not_here', null, undefined];
  const b = build(all.map((d, i) => row('P' + i, d)));
  assert.strictEqual(b[JOB].length, all.length);
});

// ── what must NOT change ───────────────────────────────────────────────────────────
test('the MONEY rule is untouched: those three stay off the invoice', () => {
  assert.strictEqual(partOnThisJob('return'), false);
  assert.strictEqual(partOnThisJob('not_here'), false);
  assert.strictEqual(partOnThisJob('shelf'), false);
  assert.strictEqual(partOnThisJob('used'), true);
  assert.strictEqual(partOnThisJob(''), true);
});

test('the invoice worksheet still applies the money rule', () => {
  assert.ok(
    /var parts=\(r\.data\|\|\[\]\)\.filter\(function\(p\)\{ return partOnThisJob\(p\.disposition\); \}\);/.test(HTML),
    'billing must keep filtering by partOnThisJob -- only the DISPLAY list was freed'
  );
});

test('the display list must not run the invoice rule', () => {
  const builder = (HTML.match(BUILDER_RE) || [])[1] || '';
  assert.ok(builder, 'builder found');
  assert.ok(!/partOnThisJob/.test(builder), 'partOnThisJob must not gate the tile part-number list');
});

// ── a blank number is still skipped: there is nothing to show or copy ──────────────
test('rows with no part number are still skipped', () => {
  const b = build([row('', 'used'), row('   ', 'used'), row(null, 'used')]);
  assert.strictEqual(b[JOB], undefined);
});

// ── a 5-part job must not read as a 1-part job ────────────────────────────────────
test('the chip says how many more parts there are', () => {
  assert.ok(
    /pmore\s*=\s*\(partsByJob\[j\.id\] && partsByJob\[j\.id\]\.length > 1\)/.test(HTML),
    'tile computes the extra-part count'
  );
  assert.ok(/\+'\+pmore/.test(HTML) || /pmore\?' \+'\+pmore/.test(HTML), 'chip renders +N');
});

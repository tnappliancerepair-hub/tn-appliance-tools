// Office-notes merge guard (Danielle + Jimmy, 2026-09-15 — "notes are not saving").
//
// One bug, reported from both ends. The tech's note appends after a FRESH read; the office's
// Save wrote the whole field from the textarea as it looked when the drawer was RENDERED. She
// keeps a job open while she works, so anything a tech sent in between was gone the second she
// saved. Last write wins, and the office is nearly always last.
//
// mergeNotes is regex-LIFTED OUT OF THE SHIPPED PAGE, so this cannot drift from what she taps.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'platform', 'office-board.html'), 'utf8');

const m = src.match(/\n  function mergeNotes\(base, typed, live\)\{[\s\S]*?\n  \}\n/);
if (!m) throw new Error('could not lift mergeNotes out of platform/office-board.html');
const ctx = {};
new Function('exports', m[0] + 'exports.mergeNotes = mergeNotes;')(ctx);
const { mergeNotes } = ctx;

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + '\n         got  ' + a + '\n         want ' + b); }
};

console.log('nothing moved under her — a plain save stays a plain save');
eq('unchanged field writes exactly what she typed',
  mergeNotes('gate code 1234', 'gate code 1234\nbringing a hose', 'gate code 1234'),
  { text: 'gate code 1234\nbringing a hose', merged: false });
eq('empty to empty', mergeNotes('', '', ''), { text: '', merged: false });
eq('first note on a blank job', mergeNotes('', 'call before 3', ''), { text: 'call before 3', merged: false });
eq('she cleared the box on purpose', mergeNotes('old note', '', 'old note'), { text: '', merged: false });

console.log('\nthe field moved under her — BOTH survive, his first');
eq('the real 9/15 case: Jimmy appended while her drawer sat open',
  mergeNotes('Pump at Marcones for pick up',
             'Pump at Marcones for pick up\ncustomer wants a call first',
             'Pump at Marcones for pick up\n— Jimmy · Sep 15 9:20am: picked it up'),
  { text: 'Pump at Marcones for pick up\n— Jimmy · Sep 15 9:20am: picked it up\ncustomer wants a call first', merged: true });
eq('she added nothing, his note is kept as-is',
  mergeNotes('a', 'a', 'a\nfrom the field'),
  { text: 'a\nfrom the field', merged: true });
eq('she rewrote the box — we cannot tell what is new, so keep both',
  mergeNotes('a', 'totally different', 'a\nfrom the field'),
  { text: 'a\nfrom the field\ntotally different', merged: true });
eq('a note arrived on a job that had none',
  mergeNotes('', 'mine', 'theirs'),
  { text: 'theirs\nmine', merged: true });

console.log('\nno double blank lines, no lost words');
eq('trailing whitespace on the live copy is trimmed before joining',
  mergeNotes('a', 'a\nmine', 'a\ntheirs\n\n  '),
  { text: 'a\ntheirs\nmine', merged: true });
eq('her leading newlines are not doubled',
  mergeNotes('a', 'a\n\n\nmine', 'a\ntheirs'),
  { text: 'a\ntheirs\nmine', merged: true });

console.log('\nnull / undefined never throw and never write "null"');
eq('null base', mergeNotes(null, 'x', ''), { text: 'x', merged: false });
eq('null live with a base', mergeNotes('a', 'a\nb', null), { text: '\nb', merged: true });
eq('all null', mergeNotes(null, null, null), { text: '', merged: false });

console.log('\nthe page actually uses it, and reads live before writing');
const ok = (l, c) => eq(l, !!c, true);
ok('Save re-reads office_notes before writing', /sb\.from\('job'\)\.select\('office_notes'\)\.eq\('id',job\.id\)/.test(src));
ok('Save calls mergeNotes', /var mg = mergeNotes\(notesBase, typed, live\)/.test(src));
ok('the baseline is snapshotted when the drawer renders', /var notesBase = String\(job\.office_notes \|\| ''\)/.test(src));
ok('she is told when a merge happened', src.includes('came in from the field while you had this open'));
ok('"request report" also reads live before appending', /var line='📋 Tech report requested[\s\S]{0,400}?sb\.from\('job'\)\.select\('office_notes'\)\.eq\('id',id\)/.test(src));
ok('a zero-row write is still never called saved', src.includes("btn.textContent='Did NOT save'"));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);

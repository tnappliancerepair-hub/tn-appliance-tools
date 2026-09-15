// office-callout.test.js — WHOSE PHONE RINGS.
//
// Sofia, 2026-09-15 12:24 PM: "The office phone won't let me call out."
//
// She was right, and the bug was not in the phone system. The click-to-call bridge
// rings an office person's CELL first and only then dials the customer, and the seat
// was a two-way branch — 'teddy', else Danielle. Sofia signs in as "Sofia"
// (office-identity.js exists specifically so she does), so every call she placed rang
// DANIELLE'S phone on another desk. The page cheerfully said "Answer your phone."
// Hers never rang. Nothing in the response said why.
//
// The anchors below are the four things that make that impossible to repeat:
//   1. the server knows every seat that HAS a cell, by name
//   2. an unknown seat is REFUSED, never quietly redirected to someone else
//   3. both front-ends send the seat that is actually signed in
//   4. the refusal reaches the human instead of a generic "failed"
//
// Rule 2 is the load-bearing one. Ringing the wrong person is worse than not ringing:
// the customer leg dials the moment that wrong phone is answered, so a misrouted
// callout doesn't just fail, it can connect a customer to someone who wasn't calling
// them — while the person who tapped the button learns nothing.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const FN    = read('netlify/functions/office-callout.js');
const BOARD = read('office-board.html');
const CALLB = read('callbacks.html');

console.log('\n— the server knows the seats —');
// Lift the real SEATS map out of the shipped function so this test runs the table
// the office actually gets, and cannot drift from it.
const seatBlock = FN.match(/const SEATS = \{[\s\S]*?\n  \};/);
t('ANCHOR: the SEATS table still lifts out of the shipped function', !!seatBlock);
const seats = seatBlock ? (seatBlock[0].match(/^\s{4}([a-z]+):/gm) || []).map((s) => s.trim().replace(':', '')) : [];
['teddy', 'danielle', 'sofia', 'carrie'].forEach(function (who) {
  t(who + ' is a seat the server can ring', seats.indexOf(who) >= 0, seats);
});
t('Sofia specifically reads her OWN vault key, not Danielle\'s',
  !!seatBlock && /sofia:\s*\{\s*key:\s*'OFFICE_CELL_SOFIA'/.test(seatBlock[0]));
// The exact shape of the old bug: a ternary that collapses everyone-not-teddy onto
// one cell. If that pattern ever comes back, this fails on purpose.
t('the two-way teddy-else-danielle branch is GONE',
  !/who === 'teddy'[\s\S]{0,200}OFFICE_CELL_DANIELLE/.test(FN));

console.log('\n— an unknown seat is refused, never redirected —');
t('an unrecognised seat returns no_cell_for_seat',
  /const seat = SEATS\[who\];[\s\S]{0,260}error:\s*'no_cell_for_seat'/.test(FN));
t('a seat with a blank cell is ALSO refused (Carrie has no number yet)',
  (FN.match(/error:\s*'no_cell_for_seat'/g) || []).length === 2,
  (FN.match(/error:\s*'no_cell_for_seat'/g) || []).length);
t('the refusal names the person, so the office knows who to fix',
  /No cell is set up for ' \+ \(b\.who \|\| who\)/.test(FN));
// Both refusals must happen BEFORE the call is originated, or we ring first and
// explain afterwards — which is the failure we are removing.
const originateAt = FN.indexOf('texml/calls/');
const lastRefusal = FN.lastIndexOf("error: 'no_cell_for_seat'");
t('both refusals come BEFORE anything is dialed', lastRefusal > 0 && lastRefusal < originateAt);
t('the cell is normalized to E.164 before dialing', /const cell = e164\(/.test(FN));

console.log('\n— the pages send the seat that is signed in —');
t('office-board resolves the signed-in seat', /function officeSeat\(\)/.test(BOARD));
t('office-board sends it', /who:\s*who/.test(BOARD) && /var who=officeSeat\(\);/.test(BOARD));
t('callbacks resolves the signed-in seat',
  /OfficeStaff\.name\(\)[\s\S]{0,180}split\(\/\\s\+\/\)\[0\]\.toLowerCase\(\)/.test(CALLB));
// The giveaway that the old branch was pasted back into a page.
[['office-board', BOARD], ['callbacks', CALLB]].forEach(function (pair) {
  t(pair[0] + ' no longer hardcodes everyone-but-teddy to danielle',
    !/if\s*\(\/teddy\/i\.test\([^)]*\)\)\s*who\s*=\s*'teddy'/.test(pair[1]));
});

console.log('\n— the human is told, not left guessing —');
[['office-board', BOARD], ['callbacks', CALLB]].forEach(function (pair) {
  t(pair[0] + " surfaces the server's plain-English reason",
    /error==='no_cell_for_seat'[\s\S]{0,200}alert\(d\.message/.test(pair[1]));
});

console.log('\n— the seat resolver, on the names the staff list really returns —');
// office-staff-verify?list=1 returns: Teddy, Danielle, Sofia, Alec, Alyse, Carrie.
// Lifted verbatim from office-board.html so the test runs the shipped rule.
const liftSeat = BOARD.match(/function officeSeat\(\)\{[\s\S]*?\n\}/);
t('ANCHOR: officeSeat still lifts out of the page', !!liftSeat);
const sb = {};
new Function('exports', 'var officeActor = exports.__actor;\n' + (liftSeat ? liftSeat[0] : 'function officeSeat(){}') +
  '\nexports.officeSeat = officeSeat;')(sb);
function seatOf(name) { sb.__actor = function () { return name; }; 
  const s2 = {}; new Function('exports', 'var officeActor = function(){ return ' + JSON.stringify(name) + '; };\n' +
    (liftSeat ? liftSeat[0] : '') + '\nexports.officeSeat = officeSeat;')(s2);
  return s2.officeSeat(); }
[['Sofia', 'sofia'], ['Sofia Mize', 'sofia'], ['Danielle', 'danielle'], ['Teddy', 'teddy'],
 ['Carrie', 'carrie'], ['  Sofia  ', 'sofia'], ['', 'danielle'], [null, 'danielle']]
  .forEach(function (c) { t(JSON.stringify(c[0]) + ' resolves to ' + c[1], seatOf(c[0]) === c[1], seatOf(c[0])); });
// Alec + Alyse have no cell in the vault. They must reach the server as THEMSELVES
// so it can refuse them by name — not be silently rewritten to Danielle.
['Alec', 'Alyse'].forEach(function (n) {
  t(n + ' is passed through as themselves (server refuses by name)', seatOf(n) === n.toLowerCase());
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

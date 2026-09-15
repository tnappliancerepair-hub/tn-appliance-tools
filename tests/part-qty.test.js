// Unit test for the TDR multi-part + quantity logic (Teddy 2026-09-15).
// The three pure functions are regex-LIFTED OUT OF THE SHIPPED PAGE at test time, so this
// can never drift from what the tech actually taps.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'platform', 'tech-job.html'), 'utf8');

function lift(name) {
  const re = new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}\\n');
  const m = src.match(re);
  if (!m) throw new Error('could not lift ' + name + ' out of platform/tech-job.html');
  return m[0];
}
const ctx = {};
new Function('exports', lift('partQty') + lift('splitPartText') + lift('partsSummary') +
  'exports.partQty=partQty; exports.splitPartText=splitPartText; exports.partsSummary=partsSummary;')(ctx);
const { partQty, splitPartText, partsSummary } = ctx;

let pass = 0, fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         got  ' + g + '\n         want ' + w); }
}

console.log('partQty — a count is never 0, never a fraction, never null');
eq('missing -> 1', partQty({}), 1);
eq('null -> 1', partQty({ qty: null }), 1);
eq('0 -> 1 (a 0 would read as "no part" downstream)', partQty({ qty: 0 }), 1);
eq('negative -> 1', partQty({ qty: -3 }), 1);
eq('"4" (string from a form) -> 4', partQty({ qty: '4' }), 4);
eq('2.7 -> 2 (no half a part)', partQty({ qty: 2.7 }), 2);
eq('4 -> 4', partQty({ qty: 4 }), 4);

console.log('splitPartText — what he typed -> name + part number');
eq('name then number', splitPartText('Heating element WPW10295370'), { name: 'Heating element', number: 'WPW10295370' });
eq('bare number', splitPartText('W10250000'), { name: '', number: 'W10250000' });
eq('name only', splitPartText('door gasket'), { name: 'door gasket', number: '' });
eq('number first', splitPartText('WPW10295370 heating element'), { name: 'heating element', number: 'WPW10295370' });
eq('hyphenated number', splitPartText('Thermal cutoff BT68-135'), { name: 'Thermal cutoff', number: 'BT68-135' });
eq('trailing punctuation stripped', splitPartText('Ice maker W10250000.'), { name: 'Ice maker', number: 'W10250000' });
eq('collapses runaway spaces', splitPartText('  Drain   pump   285753A '), { name: 'Drain pump', number: '285753A' });
eq('a plain word is never a part number', splitPartText('suspension rod'), { name: 'suspension rod', number: '' });
eq('a short digit run is not a part number', splitPartText('rod 4'), { name: 'rod 4', number: '' });
eq('empty', splitPartText('   '), { name: '', number: '' });

console.log('partsSummary — the joined text that lands in job_tdr.part_number');
eq('empty list', partsSummary([]), '');
eq('one part, one of them', partsSummary([{ number: 'W10250000', qty: 1 }]), 'W10250000');
eq('one part, four of them', partsSummary([{ number: 'W10250000', qty: 4 }]), 'W10250000 ×4');
eq('several parts', partsSummary([{ number: 'W10250000', qty: 2 }, { number: 'BT68-135', qty: 1 }]),
  'W10250000 ×2, BT68-135');
eq('falls back to the name when there is no number',
  partsSummary([{ name: 'door gasket', qty: 3 }]), 'door gasket ×3');
eq('a row with neither still reads as a part', partsSummary([{ qty: 1 }]), 'Part');
eq('a missing qty is one, not blank', partsSummary([{ number: 'ABC123' }]), 'ABC123');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

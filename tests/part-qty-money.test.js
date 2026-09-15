// Guard: every place that turns part prices into a TOTAL multiplies by the count.
//
// cost_cents / sell_cents on job_part are the UNIT price (072). A total that sums them
// straight under-bills the moment a tech taps the ticker past 1, and it fails SILENTLY --
// the invoice just comes out short. Writes of a unit price are correctly NOT multiplied, so
// this checks the totals by name rather than grepping every line that mentions money.
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log('  ok   ' + l); };
const bad = (l, d) => { fail++; console.log('  FAIL ' + l + (d ? '\n         ' + d : '')); };

// Each total is found by an anchor unique to it, then the statement that follows must carry
// a count. If an anchor stops matching the code moved -- that is a failure too, on purpose,
// because a silently-skipped check is how this rots.
const TOTALS = [
  ['platform/office-board.html', 'invoice: customer parts sum',        /var sumParts *= *function\(\)\{[^\n]*/],
  ['platform/office-board.html', 'invoice: pre-filled parts total',    /var pre=0; *parts\.forEach\([^\n]*/],
  ['platform/office-board.html', 'economics: what the shop spent',     /function partsCostCents\(\)\{[^\n]*/],
  ['platform/office-board.html', 'save: parts_cost_cents on the bill', /var partsCostC=0;[^\n]*/],
  ['platform/office-board.html', 'save: the invoice line for a part',  /kind:'part',description:p\.name[^\n]*/],
  ['platform/owner.html',        "P&L: parts revenue + cost",          /var partsRev=0, *partsCost=0;[^\n]*/],
  ['netlify/functions/platform-ant.js', 'brain: parts spend',          /let partsCost = 0;[^\n]*/],
  ['platform/tech-job.html',     'tech invoice seed: a part line',     /invItems\.push\(\{ desc:\(p\.name[^\n]*/],
  ['platform/tech-job.html',     'tech parts card: line total shown',  /'<span class="pretail"[^\n]*/],
];
const COUNTED = /\b(qty|partQty\(|rowQty\(|qtyOfInput\(|pq\(|\bq\b)/;

console.log('every part-money TOTAL multiplies by the count');
TOTALS.forEach(function ([rel, label, anchor]) {
  const m = read(rel).match(anchor);
  if (!m) return bad(rel + ' — ' + label + ': anchor no longer matches (the code moved — re-point this check)');
  if (!COUNTED.test(m[0])) return bad(rel + ' — ' + label + ': totals unit prices with no count', m[0].trim().slice(0, 150));
  ok(rel + ' — ' + label);
});

console.log('every priced job_part read asks for the count');
['platform/office-board.html', 'platform/owner.html', 'platform/tech-job.html', 'netlify/functions/platform-ant.js']
  .forEach(function (rel) {
    const sels = read(rel).match(/job_part\?*[^\n]*select[^\n]*?(cost_cents|sell_cents)[^\n]*/g) || [];
    if (!sels.length) return bad(rel + ' — no priced job_part read found (did the code move?)');
    const missing = sels.filter((s) => !/[,(']qty\b/.test(s));
    if (missing.length) return bad(rel + ' — a priced read omits qty', missing[0].trim().slice(0, 150));
    ok(rel + ' — ' + sels.length + ' priced read' + (sels.length > 1 ? 's' : ''));
  });

console.log('the count itself can never be 0, null or fractional');
['platform/tech-job.html', 'platform/office-board.html', 'platform/returns.html'].forEach(function (rel) {
  if (/function partQty\([\s\S]{0,180}?>=\s*1\s*\?/.test(read(rel))) ok(rel + ' — partQty floors at 1');
  else bad(rel + ' — partQty is missing or does not floor at 1');
});

console.log('the customer lens carries the count but still no price or part number');
(function () {
  const sql = read('docs/sql/072_part_qty.sql');
  if (/not null default 1/i.test(sql) && /qty *>= *1/.test(sql)) ok('072 declares NOT NULL DEFAULT 1 with a >= 1 check');
  else bad('072 no longer declares the floor');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

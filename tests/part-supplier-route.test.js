// "Pick up at servicepower_api" — John, 2026-09-16.
//
// His day list told him to drive to a place called `servicepower_api` for a WATER VALVE that
// FedEx was already carrying. Two separate lies in one line:
//
//   1. `job_part.source` answers WHO SUPPLIED IT. It was rendered as WHERE TO DRIVE.
//      `servicepower_api` is a provenance marker platform-sp-parts-sync stamps on every row
//      it writes (kept on purpose, so the API intake path stays measurable against the email
//      path). It is a system name. Nobody can drive to an API.
//   2. Those parts are SHIPPED. Measured live: 410 of 447 servicepower_api rows carry a real
//      carrier AND a tracking number.
//
// THE ANCHOR THAT MATTERS: partLabel (the day list) and shipLine (the job page) are BOTH
// lifted out of the shipped pages and EXECUTED against the same rows, and asserted to AGREE.
// The two surfaces saying opposite things about one row is the actual defect class here --
// the third time this month (the finish button, the completed status, now the parts route).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + '\n         got  ' + a + '\n         want ' + b); }
};
const ok = (l, cond) => eq(l, !!cond, true);
const no = (l, cond) => eq(l, !!cond, false);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── the REAL shipped catalog, loaded exactly as a browser loads it ──────────
const g = {};
new Function('window', R('platform/ant-part-route.js'))(g);
const AntPartRoute = g.AntPartRoute;

// ── lift partLabel out of the shipped day list and EXECUTE it ──────────────
const TECH = R('platform/tech.html');
function liftFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('could not find function ' + name);
  let i = src.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error('unbalanced ' + name);
  return src.slice(at, end);
}
const partLabel = new Function('window', 'fmtEta',
  liftFn(TECH, 'partLabel') + '; return partLabel;')(g, (d) => (d ? String(d).slice(0, 10) : ''));

// ── lift shipLine out of the shipped JOB PAGE and EXECUTE it ───────────────
const JOB = R('platform/tech-job.html');
const shipLine = new Function('window', 'esc', 'trackUrl',
  liftFn(JOB, 'shipLine') + '; return shipLine;')(g, (s) => String(s == null ? '' : s), () => '#');

// A real SquareTrade/ServicePower row, exactly as platform-sp-parts-sync writes it:
// source marker, NO ship_to, ordered, real carrier + tracking. (447 such rows live.)
const SP_SENT = {
  name: 'WATER VALVE', number: 'DA97-1234A', source: 'servicepower_api',
  ship_to: null, order_status: 'ordered', disposition: null,
  ship_tracking: '531794380608', ship_carrier: 'FedEx', ship_delivered: null, ship_status: null,
};

console.log('\nJohn\'s exact row — the day list stops inventing a place to drive');
const sent = partLabel(SP_SENT);
no('does NOT say "Pick up"', /pick\s*up/i.test(sent.t));
no('never shows him the raw marker servicepower_api', /servicepower_api/i.test(sent.t));
ok('says it is on its way', /sent/i.test(sent.t));
ok('names the carrier so the words match the tracking page', /FedEx/.test(sent.t));
ok('the part is still named', /WATER VALVE/.test(sent.t));

console.log('\nthe two tech surfaces AGREE on the same row (the actual defect class)');
const job = shipLine(SP_SENT);
const dayPickup = /pick\s*up/i.test(sent.t);
const jobPickup = /PICK THIS UP/i.test(job);
eq('day list and job page agree on pick-up-vs-shipped', dayPickup, jobPickup);
ok('the job page also reads it as sent', /Sent/i.test(job));
no('the job page no longer prints the raw marker either', /servicepower_api/i.test(job));

console.log('\na tracking number OUTRANKS every route guess');
// order_status/ship_to could say anything; a carrier has the box. Shipped wins.
ok('shipped beats a blank route', /sent/i.test(partLabel({ ...SP_SENT }).t));
ok('shipped beats an ordered status', !/not ordered/i.test(partLabel({ ...SP_SENT, order_status: 'to_order' }).t));
eq('delivered reads delivered, not "sent"',
  /delivered/i.test(partLabel({ ...SP_SENT, ship_delivered: true }).t), true);
// but a part already in his van is STILL his van — that outranks the shipment
ok('"On the truck" still wins over a stale tracking number',
  /already with you/i.test(partLabel({ ...SP_SENT, ship_to: 'On the truck' }).t));
ok('a part he already installed still reads installed',
  /installed/i.test(partLabel({ ...SP_SENT, disposition: 'used' }).t));

console.log('\nthe warranty company SHIPS its own parts — never "go get it"');
// same row minus the tracking number: the vendor has ordered it, it has not moved yet.
const SP_NOTRACK = { ...SP_SENT, ship_tracking: null, ship_carrier: null };
const nt = partLabel(SP_NOTRACK);
no('still never says pick up', /pick\s*up/i.test(nt.t));
ok('says the vendor is sending it', /sending it/i.test(nt.t));
ok('and names the vendor in words a tech knows', /ServicePower/.test(nt.t));
['ServicePower (warranty)', 'SquareTrade (warranty)', 'FrontDoor (warranty)',
 'AHS (warranty)', 'American Home Shield (warranty)', 'NSA (warranty)'].forEach((v) => {
  no('no pick-up instruction for ' + v,
    /pick\s*up/i.test(partLabel({ ...SP_NOTRACK, source: v }).t));
});

console.log('\na REAL parts house with a real will-call is untouched');
// Marcone genuinely has a counter. Flipping this to "on order" is the failed-visit direction.
ok('blank route + a parts house still reads pick up',
  /pick up at Marcone/i.test(partLabel({ ...SP_NOTRACK, source: 'Marcone' }).t));
ok('an explicit will-call route still reads PICK UP',
  /PICK UP/.test(partLabel({ ...SP_NOTRACK, source: 'Marcone', ship_to: 'Pickup — parts house' }).t));
ok('shipping to the customer still reads that way',
  /at the customer/i.test(partLabel({ ...SP_NOTRACK, ship_to: 'customer' }).t));

console.log('\nsupplierName — our own bookkeeping never reaches a tech');
eq('the marker becomes the real dispatcher name', AntPartRoute.supplierName('servicepower_api'), 'ServicePower');
eq('case drift is tolerated', AntPartRoute.supplierName('ServicePower_API'), 'ServicePower');
eq('a name a human wrote comes back untouched', AntPartRoute.supplierName('Marcone'), 'Marcone');
eq('blank stays blank', AntPartRoute.supplierName(null), '');

console.log('\nisVendorSupplied — who ships it');
[['servicepower_api', true], ['SquareTrade (warranty)', true], ['FrontDoor (warranty)', true],
 ['AHS (warranty)', true], ['American Home Shield (warranty)', true], ['NSA (warranty)', true],
 ['Marcone', false], ['Encompass', false], ['Marcone — pick up', false], ['', false], [null, false],
].forEach(([v, want]) => eq('isVendorSupplied(' + JSON.stringify(v) + ')', AntPartRoute.isVendorSupplied(v), want));

console.log('\nthe day list ASKS for the shipment (it was structurally blind before)');
// The deeper root cause: tech.html never selected ship_tracking, so no amount of label logic
// could have read it. A select is a fact about the SELECT, not about the row.
const sel = (stripComments(TECH).match(/parts:job_part\(([^)]*)\)/) || [])[1] || '';
ok('lifted the day-list parts select', sel.length > 10);
['ship_tracking', 'ship_carrier', 'ship_delivered', 'ship_status'].forEach((c) =>
  ok('day list selects ' + c, sel.split(',').map((x) => x.trim()).includes(c)));

console.log('\nevery surface that prints a supplier loads the catalog + busts its cache');
// A page that calls supplierName without the module throws; a page that loads a STALE cached
// module has isPickup but NOT supplierName, which throws the same way. Both are fatal on a
// phone in a driveway, so the tag and the ?v= are load-bearing, not hygiene.
['platform/tech.html', 'platform/tech-job.html', 'platform/office-board.html', 'platform/returns.html']
  .forEach((p) => {
    const src = R(p);
    if (/AntPartRoute\.(supplierName|isShipped|isVendorSupplied)/.test(stripComments(src))) {
      const tag = (src.match(/<script src="\/platform\/ant-part-route\.js([^"]*)"/) || [])[0];
      ok(p + ' loads ant-part-route.js', !!tag);
      ok(p + ' cache-busts it (?v=)', /\?v=/.test(tag || ''));
    }
  });

console.log('\nno surface prints the raw provenance marker any more');
['platform/tech.html', 'platform/tech-job.html', 'platform/office-board.html', 'platform/returns.html']
  .forEach((p) => {
    const clean = stripComments(R(p));
    // esc(p.source) straight into markup is the shape that leaked it
    no(p + ' has no unhumanized esc(p.source)', /esc\(\s*p\.source\s*\)/.test(clean));
  });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

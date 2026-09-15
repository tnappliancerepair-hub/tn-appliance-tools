// Part-route vocabulary guard (Danielle + Jimmy, 2026-09-15).
//
// job_part.ship_to carried TWO vocabularies that had never been introduced to each other:
// the office board's <select> knew 'distributor' | 'customer', while platform-tn-parts-migrate
// writes six human strings built from Xano's notes.where_kind. A mirrored row matched no
// <option>, so it read "Route…" ("it's not saving") and the row's next inline save wrote null
// over the real route.
//
// THE ANCHOR THAT MATTERS: every ship_to string the migrate can write is lifted OUT OF THE
// SHIPPED FUNCTION at test time and asserted against the catalog. Add a seventh string to the
// migrate without teaching the catalog and this FAILS on purpose — that is the whole point.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// load the shipped catalog exactly as a browser would
const g = {};
new Function('window', R('platform/ant-part-route.js'))(g);
const { OPTIONS, label, isPickup, selectHtml } = g.AntPartRoute;

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + '\n         got  ' + a + '\n         want ' + b); }
};
const ok = (l, cond) => eq(l, !!cond, true);

console.log('\nthe migrate and the catalog speak one language');
// lift parseNotes' ship strings straight out of the shipped migrate
const mig = R('netlify/functions/platform-tn-parts-migrate.js');
const migSection = mig.slice(mig.indexOf('function parseNotes'), mig.indexOf('function parseNotes') + 900);
const migValues = [...migSection.matchAll(/ship = '([^']+)'/g)].map((m) => m[1]);
ok('lifted the migrate ship_to strings (got ' + migValues.length + ')', migValues.length >= 6);
const known = new Set(OPTIONS.map((o) => o.value));
migValues.forEach((v) => ok('catalog knows the migrate value ' + JSON.stringify(v), known.has(v)));

console.log('\nthe office picker still offers its own two slugs');
ok("'distributor' is a known route", known.has('distributor'));
ok("'customer' is a known route", known.has('customer'));

console.log('\nisPickup — somebody has to go GET it');
eq('distributor', isPickup('distributor'), true);
eq('Pickup — parts house', isPickup('Pickup — parts house'), true);
eq('Pickup — shop/storage', isPickup('Pickup — shop/storage'), true);
eq('unknown free text that says pick up', isPickup('will call at Reliable'), true);
eq('On the truck is ALREADY WITH HIM, not a pickup', isPickup('On the truck'), false);
eq('In hand is not a pickup', isPickup('In hand'), false);
eq('customer is not a pickup', isPickup('customer'), false);
eq('Ship to customer is not a pickup', isPickup('Ship to customer'), false);
eq('blank is not a pickup', isPickup(''), false);
eq('null is not a pickup', isPickup(null), false);

console.log('\nlabel — never invents, never blanks');
eq('known slug gets its words', label('distributor'), '🏭 Pick up from the distributor');
eq('unknown value comes back as written', label('Somewhere Else'), 'Somewhere Else');
eq('blank stays blank', label(''), '');

console.log('\nselectHtml — an edit can never erase a route it did not recognise');
const unknown = selectHtml('Pickup — parts house', 'class="tp_ship"');
ok('a migrate value is SELECTED, not silently dropped', /value="Pickup — parts house" selected/.test(unknown));
const freeform = selectHtml('counter at Reliable, ask for Dave', 'class="tp_ship"');
ok('free text survives as its own option', /value="counter at Reliable, ask for Dave" selected/.test(freeform));
ok('free text is the selected one', freeform.indexOf('selected') > 0);
const empty = selectHtml('', 'class="tp_ship"');
ok('blank selects the Route… placeholder', /<option value="" selected>Route…<\/option>/.test(empty));
ok('carries the class it was handed', /class="tp_ship"/.test(empty));
const dq = selectHtml('he said "grab it"', '');
ok('quotes are escaped, not breaking the markup', dq.indexOf('&quot;') > 0);

console.log('\nevery surface reads the ONE catalog');
[
  ['platform/office-board.html', 'office board'],
  ['platform/tech-job.html', 'tech job card'],
  ['platform/tech.html', 'tech day list'],
].forEach(([f, name]) => {
  const src = R(f);
  ok(name + ' loads ant-part-route.js', src.includes('/platform/ant-part-route.js'));
  ok(name + ' calls AntPartRoute', /AntPartRoute\./.test(src));
});

console.log('\nthe tech is actually shown where the part is');
const tj = R('platform/tech-job.html');
ok('the part read asks for source + ship_to', /select\('id,name,number,qty[^']*source,ship_to/.test(tj));
ok('a will-call part says PICK THIS UP', tj.includes('🏬 PICK THIS UP'));
const th = R('platform/tech.html');
ok('the day list stopped sending him for a part on his own truck', th.includes("low==='on the truck'"));

console.log('\nthe office board stopped calling a will-call part unshipped');
const ob = R('platform/office-board.html');
ok('drawer says will-call instead of "Not shipped yet"', ob.includes('🏬 Will-call — pick up'));
ok('the tile has a PICK UP chip', ob.includes('🏬 PICK UP ('));
ok('shipSel delegates to the shared catalog', /function shipSel\(v\)\{ return window\.AntPartRoute\.selectHtml/.test(ob));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);

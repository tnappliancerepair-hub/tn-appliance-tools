// "My schedule is all out of order." -- Lee, 2026-09-17.
//
// He was right, and it was the same bug on two surfaces. Both his day list
// (platform/tech.html) and the office board (platform/dispatch.html) ordered a tech's day
// with routeOrder() -- a nearest-neighbour sweep over the 5-digit ZIP. That is a fact about
// the MAP. It says nothing whatever about the CLOCK, so the day came out shuffled:
// reproduced on his real Wed 2026-09-17, his 8-11 AM stop rendered FOURTH and an 11-2 stop
// rendered FIRST.
//
// THE RULE THIS PINS: the window is what the customer was TOLD, so it is the primary sort
// key. The route is only an optimisation and only gets to reorder stops that SHARE a window.
// A day runs by the clock; the map breaks ties.
//
// The anchor that matters is Lee's ACTUAL Wednesday, replayed through the shipped code --
// not a hand-made fixture that could drift away from what the board really holds.
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
new Function('window', R('platform/ant-windows.js'))(g);
const AntWindows = g.AntWindows;

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

// ── lift the day list's whole ordering cluster and EXECUTE it ──────────────
const TECH = R('platform/tech.html');
const DISPATCH = R('platform/dispatch.html');
const techEnv = new Function('window', 'AntWindows', [
  'var stopByJob={}, matesByJob={}, stopCount=0;',
  liftFn(TECH, 'zip5'), liftFn(TECH, 'jZip'), liftFn(TECH, 'routeOrder'),
  liftFn(TECH, 'stopKey'), liftFn(TECH, 'stopHour'), liftFn(TECH, 'routeSequence'),
  'return { routeSequence:routeSequence, routeOrder:routeOrder, stopHour:stopHour,',
  '         stopNo:function(id){ return stopByJob[id]; } };'
].join('\n'))(g, AntWindows);

// ── Lee's REAL Wednesday, 2026-09-17, exactly as the board holds it ────────
// (pulled live: 7 open stops, Clarksville 370xx, three windows)
const D = '2026-09-17';
const j = (id, cust, zip, win, start, sw) => ({
  id, scheduled_day: D, status: 'scheduled', time_window: win,
  scheduled_start: start, service_window: sw || null, customer: { zip }
});
const LEE_WED = [
  j('bartlett', 'Jon Bartlett',   '37043', '8-11', '2026-09-17T13:00:00Z'),
  j('brandt',   'Jason Brandt',   '37043', '8-11', '2026-09-17T13:00:00Z', '48 hours/2 business days'),
  j('fuss',     'Karla Fuss',     '37042', '11-2', '2026-09-17T16:00:00Z'),
  j('antonio',  'Blanca Antonio', '37040', '11-2', '2026-09-17T16:00:00Z', '2-6pm'),
  j('white',    'Lawrence White', '37042', '11-2', '2026-09-17T16:00:00Z', '48 hours/2 business days'),
  j('beaty',    'Sabine Beaty',   '37043', '2-5',  '2026-09-17T19:00:00Z', 'Within 48 hours/2 business days'),
  j('chang',    'Kenith Chang',   '37043', '2-5',  '2026-09-17T19:00:00Z', '48 hours / 2 business days')
];
const ids = (rows) => rows.map((r) => r.id);
const wins = (rows) => rows.map((r) => r.time_window);

console.log("\nLee's real Wednesday now runs by the clock");
const seq = techEnv.routeSequence(LEE_WED.slice());
eq('windows come out earliest-first', wins(seq), ['8-11', '8-11', '11-2', '11-2', '11-2', '2-5', '2-5']);
ok('his 8-11 AM stop is stop #1, not #4', techEnv.stopNo('bartlett') === 1 || techEnv.stopNo('brandt') === 1);
eq('no 11-2 stop is numbered ahead of an 8-11 stop',
  Math.max(techEnv.stopNo('bartlett'), techEnv.stopNo('brandt')) <
  Math.min(techEnv.stopNo('fuss'), techEnv.stopNo('antonio'), techEnv.stopNo('white')), true);
eq('the last stop of his day is a 2-5', seq[seq.length - 1].time_window, '2-5');

console.log('\nthe route still clusters -- but only INSIDE a window');
// His 11-2 block is 37042, 37040, 37042. Left alone that zig-zags; the sweep fixes it
// without ever lifting a stop out of its promised window.
const mid = seq.filter((r) => r.time_window === '11-2').map((r) => r.customer.zip);
eq('the 11-2 block sweeps low->high instead of zig-zagging', mid, ['37040', '37042', '37042']);
eq('every 11-2 stop stayed in the 11-2 block', mid.length, 3);

console.log('\nthe clock beats the map, and an untimed stop never jumps the queue');
const noTime = j('unknown', 'No Window', '37040', null, null, '48 hours/2 business days');
const withUnknown = techEnv.routeSequence(LEE_WED.concat([noTime]));
eq('a stop with no time at all sorts LAST', withUnknown[withUnknown.length - 1].id, 'unknown');
// the lowest ZIP on the day is 37040 -- under the old rule that alone won stop #1
no('the lowest ZIP no longer wins the day', withUnknown[0].customer.zip === '37040' && withUnknown[0].time_window !== '8-11');

console.log('\nstartHourFor reads the best honest signal, in order');
eq('time_window wins', AntWindows.startHourFor({ time_window: '2-5', scheduled_start: '2026-09-17T13:00:00Z' }), 14);
eq('...even against a conflicting scheduled_start (the customer heard the window)',
  AntWindows.startHourFor({ time_window: '8-11', scheduled_start: '2026-09-17T16:05:00Z' }), 8);
eq('scheduled_start fills in when there is no window', AntWindows.startHourFor({ scheduled_start: '2026-09-17T16:00:00Z' }), 11);
eq('scheduled_start is read on the CENTRAL clock, never UTC',
  AntWindows.startHourFor({ scheduled_start: '2026-09-17T13:00:00Z' }), 8);
eq('an evening stamp stays on the same Central day', AntWindows.startHourFor({ scheduled_start: '2026-09-18T01:00:00Z' }), 20);
eq('minutes survive so 11:05 sorts after 11:00',
  Math.round(AntWindows.startHourFor({ scheduled_start: '2026-09-17T16:05:00Z' }) * 60), 665);
eq('the vendor window is the last resort', AntWindows.startHourFor({ service_window: '2-6pm' }), 14);
eq('nothing to go on reads as unknown, not as midnight', AntWindows.startHourFor({}), null);

console.log("\nthe vendor's window is free text -- only read it when it names a clock");
// every one of these is a real value on TN's board today...
[['48 hours', null], ['48 hours/2 business days', null], ['Within 48 hours / 2 business days', null],
 ['within 48 hours/2 business days', null], ['09/16/2026', null],
 // ...and these are the ones that make the SLA guard load-bearing. A turnaround phrase can
 // carry a number RANGE, which reads as a clock time to any naive parser: without the guard
 // "2-3 business days" becomes 2 PM and silently drops that job into the afternoon.
 ['2-3 business days', null], ['1-2 days', null], ['3-5 business days', null],
 ['2 to 3 business days', null], ['24-48 hours', null],
 ['2-6pm', 14], ['8am-12pm', 8], ['8am-10am', 8], ['10am-2pm', 10], ['11am-1pm', 11],
 ['12-4pm', 12], ['12pm-5pm', 12], ['1-5pm', 13], ['4-6pm', 16], ['9-11am', 9],
 ['8:00 - 10:00', 8], ['13:00 - 15:00', 13], ['1:00 PM - 4:00 PM', 13], ['11 AM - 2 PM', 11],
 ['09/18/2026 8-10', 8], ['09/29/2026 15-17', 15], ['09/16/2026 12-17', 12], ['09/21/2026 13-15', 13]
].forEach(([txt, want]) => eq('  ' + JSON.stringify(txt), AntWindows.parseWindowText(txt), want));

console.log('\nseveral machines at one address is ONE stop at ONE time');
const A = { id: 'washer', stop_id: 'S1', scheduled_day: D, status: 'scheduled', time_window: '2-5', customer: { zip: '37040' }, unit: { label: 'washer' } };
const B = { id: 'dryer', stop_id: 'S1', scheduled_day: D, status: 'scheduled', time_window: '8-11', customer: { zip: '37040' }, unit: { label: 'dryer' } };
eq('the stop runs at the EARLIEST window of its machines, never the later one', techEnv.stopHour([A, B]), 8);
const combo = techEnv.routeSequence([j('late', 'Later', '37043', '11-2', null), A, B]);
eq('so the two-machine stop leads the day', combo[0].stop_id, 'S1');
eq('and its machines stay together', combo[1].stop_id, 'S1');

console.log('\nboth surfaces go through the ONE shared rule');
[['platform/tech.html', TECH], ['platform/dispatch.html', DISPATCH]].forEach(([p, src]) => {
  const clean = stripComments(src);
  ok(p + ' orders the day via AntWindows.orderDay', /AntWindows\.orderDay\s*\(/.test(clean));
  // presence is not reachability -- a dead-guarded call would still match the line above
  no(p + ' does not dead-guard that call', /(false|0|null|undefined)\s*&&\s*AntWindows\.orderDay/.test(clean));
  no(p + ' no longer route-orders the raw day', /=\s*routeOrder\(\s*(mine|reps)\s*\)/.test(clean));
  ok(p + ' selects scheduled_start so the fallback is not structurally dead', /select\([^)]*scheduled_start/.test(clean));
  ok(p + ' selects service_window too', /select\([^)]*service_window/.test(clean));
});

console.log('\nthe shared module is cache-busted on every page that loads it');
// netlify.toml no-caches /*.html only. A phone keeps its cached .js, so new HTML calling
// orderDay() against an old cached module throws and takes the whole day list down.
const tags = [];
fs.readdirSync(path.join(root, 'platform')).filter((f) => f.endsWith('.html')).forEach((f) => {
  const s = R('platform/' + f);
  const m = s.match(/<script src="\/platform\/ant-windows\.js([^"]*)"><\/script>/g) || [];
  m.forEach((t) => tags.push([f, t]));
});
ok('every page that loads the catalog was found', tags.length >= 6);
tags.forEach(([f, t]) => ok('  ' + f + ' carries a ?v=', /ant-windows\.js\?v=/.test(t)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

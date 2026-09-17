// "Yea its not right on my end either. Jobs are all mixed up." -- Danielle, 2026-09-17.
//
// She said it in the same thread where Lee said his schedule "looks wacky again like it had
// been thrown around every which way." Lee's half was fixed that morning (the day list and
// the dispatch week grid now run by the clock). Hers was not: platform/office-board.html
// loads its cards `created_at desc` and, with no column sort picked, THAT is the order they
// render -- so a column read in the order the rows happened to be WRITTEN.
//
// THE ANCHOR IS ANDRE'S REAL COLUMN, pulled live off the board on 2026-09-17, in the exact
// order the board hands it to the renderer. Read it: his TODAY stops sit at positions
// 5, 6, 8, 9 and 10 -- underneath work booked for the 21st and the 25th.
//
// THE RULE THIS PINS (the same one, from the same catalog): the window is a PROMISE, so it
// is the primary key. Soonest day first, then the hour the customer was told. An untimed
// stop sorts after every stop that has a time. Anything already done, and anything with no
// day at all, keeps the order it had -- Completed still reads newest-first.
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
const ok = (l, c) => eq(l, !!c, true);
const no = (l, c) => eq(l, !!c, false);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── the REAL shipped catalog + the REAL shipped board functions ────────────
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

const BOARD = R('platform/office-board.html');
const env = new Function('window', 'AntWindows', [
  liftFn(BOARD, 'dayClockKey'),
  liftFn(BOARD, 'defaultOrder'),
  liftFn(BOARD, 'sortList'),
  // jobSortVal reaches statusMeta/fullName; stub only what the 'due' branch cannot avoid.
  'function fullName(){ return ""; } function statusMeta(){ return {label:""}; }',
  liftFn(BOARD, 'jobSortVal'),
  'return { dayClockKey:dayClockKey, defaultOrder:defaultOrder, sortList:sortList, jobSortVal:jobSortVal };'
].join('\n'))(g, AntWindows);

// ── ANDRE'S REAL COLUMN, 2026-09-17, in the board's own `created_at desc` order ──
const ANDRE = [
  { id:'A21a', scheduled_day:'2026-09-21', time_window:'8-11', scheduled_start:'2026-09-21T13:00:00+00:00', service_window:'09/21/2026 8-10',        created_at:'2026-09-16T18:22:16Z', status:'scheduled' },
  { id:'A18a', scheduled_day:'2026-09-18', time_window:'8-11', scheduled_start:'2026-09-18T13:00:00+00:00', service_window:'48 hours',               created_at:'2026-09-16T17:06:14Z', status:'scheduled' },
  { id:'A21b', scheduled_day:'2026-09-21', time_window:'8-11', scheduled_start:'2026-09-21T13:00:00+00:00', service_window:'09/21/2026 13-15',       created_at:'2026-09-16T00:52:19Z', status:'scheduled' },
  { id:'A25',  scheduled_day:'2026-09-25', time_window:null,   scheduled_start:'2026-09-25T13:00:00+00:00', service_window:'09/25/2026 13-15',       created_at:'2026-09-15T17:21:18Z', status:'scheduled' },
  { id:'A17b', scheduled_day:'2026-09-17', time_window:'11-2', scheduled_start:'2026-09-17T16:00:00+00:00', service_window:'48 hours/2 business days',created_at:'2026-09-15T17:16:40Z', status:'scheduled' },
  { id:'A17c', scheduled_day:'2026-09-17', time_window:'11-2', scheduled_start:'2026-09-17T16:00:00+00:00', service_window:'48 hours / 2 business days',created_at:'2026-09-09T13:07:27Z', status:'scheduled' },
  { id:'A18b', scheduled_day:'2026-09-18', time_window:'2-5',  scheduled_start:'2026-09-18T19:00:00+00:00', service_window:'2-6pm',                  created_at:'2026-09-03T13:42:49Z', status:'scheduled' },
  { id:'A17a', scheduled_day:'2026-09-17', time_window:'8-11', scheduled_start:'2026-08-27T13:00:00+00:00', service_window:'8am-12pm',               created_at:'2026-09-03T13:42:48Z', status:'scheduled' },
  { id:'A17d', scheduled_day:'2026-09-17', time_window:'11-2', scheduled_start:'2026-08-31T19:00:00+00:00', service_window:'2-6pm',                  created_at:'2026-09-03T13:42:48Z', status:'scheduled' },
  { id:'A17e', scheduled_day:'2026-09-17', time_window:'2-5',  scheduled_start:'2026-09-17T19:00:00+00:00', service_window:'2-6pm',                  created_at:'2026-09-03T13:42:45Z', status:'scheduled' }
];
const ids = (l) => l.map((j) => j.id);

console.log("\n-- Danielle's board: Andre's real column --");

// What she sees today, before anything is picked: the shape of the complaint.
eq('the raw board order buries today under next week',
  ids(ANDRE).slice(0, 4), ['A21a', 'A18a', 'A21b', 'A25']);

const out = env.sortList(ANDRE, null);
eq("the column now reads by the clock, soonest first",
  ids(out), ['A17a', 'A17b', 'A17c', 'A17d', 'A17e', 'A18a', 'A18b', 'A21a', 'A21b', 'A25']);
eq('every stop booked for today comes first', ids(out).slice(0, 5).every((x) => x.startsWith('A17')), true);
eq("today's 8-11 leads the column, not an 11-2", ids(out)[0], 'A17a');
eq('the 2-5 closes the day', ids(out)[4], 'A17e');

// The promise outranks a stale routing stamp. A17a carries time_window 8-11 while its
// scheduled_start still says 2026-08-27 -- three weeks stale. The window is what the
// customer heard, so it wins; reading the stamp would drop him out of the morning.
eq('a promised window beats a stale scheduled_start', env.dayClockKey(ANDRE[7]), '2026-09-17 08.00');

// A25 has no window at all -- tier 2 reads the booked stamp on the CENTRAL clock.
eq('no window falls through to the booked stamp, read in Central', env.dayClockKey(ANDRE[3]), '2026-09-25 08.00');

// Tier 3 -- the vendor's own words -- and it fires on real data: with no window and no
// stamp, "09/25/2026 13-15" is a leading DATE followed by a real clock. The date has to be
// stripped or the 09 reads as 9am. (This is the tier that carries a windowless job.)
eq('the vendor window is read only when it names a real clock',
  env.dayClockKey({ scheduled_day:'2026-09-25', time_window:null, scheduled_start:null, service_window:'09/25/2026 13-15', status:'scheduled' }),
  '2026-09-25 13.00');
eq('a turnaround promise is refused -- "2-3 business days" is not 2 PM',
  env.dayClockKey({ scheduled_day:'2026-09-25', time_window:null, scheduled_start:null, service_window:'2-3 business days', status:'scheduled' }),
  '2026-09-25 99.99');

console.log('\n-- the rules that keep the rest of the board still --');

const mixed = [
  { id:'done_old', scheduled_day:'2026-09-01', time_window:'8-11', status:'completed', created_at:'2026-09-01T00:00:00Z' },
  { id:'no_day',   scheduled_day:null,         time_window:null,   status:'new',       created_at:'2026-09-16T00:00:00Z' },
  { id:'live',     scheduled_day:'2026-09-19', time_window:'8-11', status:'scheduled', created_at:'2026-09-02T00:00:00Z' },
  { id:'canceled', scheduled_day:'2026-09-02', time_window:'8-11', status:'canceled',  created_at:'2026-09-15T00:00:00Z' }
];
eq('done and day-less cards keep the order they had, under the live work',
  ids(env.sortList(mixed, null)), ['live', 'done_old', 'no_day', 'canceled']);
eq('a completed job is never pulled to the top by its old day', env.dayClockKey(mixed[0]), '');
eq('a canceled job is never pulled to the top by its old day', env.dayClockKey(mixed[3]), '');
eq('a card with no day has no clock key', env.dayClockKey(mixed[1]), '');

// An untimed stop must never jump ahead of a promised 8am.
const untimed = [
  { id:'unknown', scheduled_day:'2026-09-18', time_window:null, scheduled_start:null, service_window:'48 hours', status:'scheduled', created_at:'2026-09-16T00:00:00Z' },
  { id:'eight',   scheduled_day:'2026-09-18', time_window:'8-11', status:'scheduled', created_at:'2026-09-01T00:00:00Z' }
];
eq('an untimed stop sorts after every stop that has a time', ids(env.sortList(untimed, null)), ['eight', 'unknown']);
eq('an SLA phrase is not a clock time', env.dayClockKey(untimed[0]), '2026-09-18 99.99');

// Ties stay stable, so a column never reshuffles itself between renders.
// A MUTATION SURVIVED HERE and chasing it was worth it: breaking the comparator to
// `return ka<kb?-1:1` (never 0) left this green, because V8's binary insertion sort still
// places an "a is greater" tie AFTER -- which is the stable answer by accident. The
// mutation that genuinely reverses ties is `-1` on equal, and that one fails this. Noted
// so the next person doesn't read the easy mutation as proof.
eq('ties keep the order they arrived in (stable sort)',
  ids(env.sortList(ANDRE, null)).slice(1, 4), ['A17b', 'A17c', 'A17d']);
eq('ordering the same column twice gives the same answer',
  ids(env.sortList(env.sortList(ANDRE, null), null)), ids(env.sortList(ANDRE, null)));
eq('ordering does not mutate the board array', ids(ANDRE).slice(0, 3), ['A21a', 'A18a', 'A21b']);

console.log('\n-- the "Scheduled day" sort she can pick by hand --');

// Picking 📅 Scheduled day used to sort on the DATE STRING alone, so a day came back in
// arbitrary order -- the same complaint, one menu click away.
eq('the picked sort carries the clock, not just the date',
  ids(env.sortList(ANDRE, { by:'due', dir:'asc' })).slice(0, 5), ['A17a', 'A17b', 'A17c', 'A17d', 'A17e']);
ok('the picked sort still reads a completed job (it is a date column, not a queue)',
  env.jobSortVal({ scheduled_day:'2026-09-01', time_window:'8-11', status:'completed' }, 'due') === '2026-09-01 08.00');
eq('a card with no day still sorts to the bottom of the picked sort',
  env.jobSortVal({ scheduled_day:null }, 'due'), '');

console.log('\n-- the wiring, so this cannot quietly stop running --');

const SRC = stripComments(BOARD);
ok('the board reads the ONE shared catalog, not its own copy of the rule',
  /AntWindows\s*&&\s*AntWindows\.startHourFor/.test(SRC));
no('the board does not reimplement the window -> hour table',
  /['"]8-11['"]\s*:\s*8\b/.test(SRC) || /case\s*['"]8-11['"]/.test(SRC));
ok('office-board loads ant-windows.js', /ant-windows\.js\?v=/.test(BOARD));
ok('the default path is reachable -- no dead guard in front of it',
  /if\(!s\|\|!s\.by\)\s*return\s+defaultOrder\(list\)/.test(SRC));
no('the raw query order is no longer the default',
  /if\(!s\|\|!s\.by\)\s*return\s+list;/.test(SRC));
ok("'due' no longer sorts on the bare date string",
  !/case\s*'due':\s*return\s+j\.scheduled_day\s*\?\s*String\(j\.scheduled_day\)/.test(SRC));
// The board's own query is created_at desc -- that is WHY the default order has to exist.
ok('the board still loads newest-first (the order the default corrects)',
  /order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)/.test(SRC));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

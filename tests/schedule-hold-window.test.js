// schedule-hold-window.test.js — Teddy 2026-09-16: "Danielle needs the scheduling part for
// a held spot to show when and what time it's held for."
//
// She was holding a spot for a customer and the system remembered the DAY only. Worse than
// the display: BOTH boards threw the window away twice.
//
//   office-board.html  holdFromDrawer()      read schTech + schDay, ignored schPos entirely
//                      bookHoldConfirmed()   `const win='';` - literally hardcoded empty
//   new-scheduling     holdSlotBtn           ignored the window picker sitting beside it
//                      bookConfirmedHold()   appended as the next open stop, no window
//
// So the arrival window she had just agreed with the customer was dropped at hold time, and
// dropped AGAIN at the moment they said yes. A hold now carries `window` (the customer-facing
// label) + `hour` (the routing sort key), shows both, and books what it held.
//
// Lifted out of the shipped pages and executed - pattern-matching would pass against a call
// that no longer runs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const BOARD = R('office-board.html');
const SCHED = R('new-scheduling.html');
const HOLDFN = R('netlify/functions/schedule-hold.js');

function fnBody(name, src) {
  const a = src.indexOf('function ' + name + '(');
  assert.ok(a > -1, name + ' not found');
  const o = src.indexOf('{', a);
  let d = 0;
  for (let i = o; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (!d) return src.slice(a, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function run(code, ctx) { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; }

// ── the office board picks up the window it already had on screen ────────────
test('holding reads the SAME window control the real booking uses', () => {
  const ctx = run(fnBody('drawerWindowPick', BOARD) + '\n;this.out = drawerWindowPick();', {
    document: { getElementById: (id) => id === 'schPos' ? { value: '12', selectedOptions: [{ getAttribute: (a) => a === 'data-win' ? '12-4pm' : null }] } : null },
    parseInt: parseInt, out: null,
  });
  assert.equal(ctx.out.hour, 12, 'the routing hour');
  assert.equal(ctx.out.window, '12-4pm', 'the words the customer heard');
});

test('no window picked is not a crash — it degrades to the old next-open-stop behaviour', () => {
  const ctx = run(fnBody('drawerWindowPick', BOARD) + '\n;this.out = drawerWindowPick();', {
    document: { getElementById: () => ({ value: '', selectedOptions: [] }) }, parseInt: parseInt, out: null,
  });
  assert.equal(ctx.out.hour, 0);
  assert.equal(ctx.out.window, '');
});

test('the hold POST carries window + hour', () => {
  const b = fnBody('holdFromDrawer', BOARD);
  assert.match(b, /drawerWindowPick\(\)/, 'reads the picker');
  assert.match(b, /window:w\.window/, 'sends the label');
  assert.match(b, /hour:w\.hour/, 'sends the sort hour');
});

// ── it says when, in words ───────────────────────────────────────────────────
test('the day reads like a day, not like a database value', () => {
  const ctx = run(fnBody('holdDayLabel', BOARD) + '\n;this.a=holdDayLabel("2026-09-18");this.b=holdDayLabel("");', { a: null, b: null });
  assert.match(ctx.a, /Friday/, 'names the weekday — "2026-09-18" answers nothing');
  assert.match(ctx.a, /Sep/);
  assert.equal(ctx.b, 'no day');
});

test('a hold that has been sitting too long says so', () => {
  const now = Date.now();
  const c = run(fnBody('holdAgeLabel', BOARD) + '\n;this.m=holdAgeLabel(now-30*60000);this.h=holdAgeLabel(now-5*3600000);this.d=holdAgeLabel(now-3*86400000);this.z=holdAgeLabel(0);',
    { Date: Date, Math: Math, Number: Number, now: now, m: null, h: null, d: null, z: null });
  assert.equal(c.m, 'held 30m ago');
  assert.equal(c.h, 'held 5h ago');
  assert.match(c.d, /⚠ held 3d ago/, 'a forgotten hold has to jump out');
  assert.equal(c.z, 'held (time unknown)');
});

test('the drawer shows the day, the window, and how long it has been held', () => {
  const i = BOARD.indexOf('⏳ Held for ${esc(TECH_NAME');
  assert.ok(i > -1);
  const banner = BOARD.slice(i, i + 1400);
  assert.match(banner, /holdDayLabel\(HOLD_MAP\[jid\]\.date\)/, 'the day');
  assert.match(banner, /HOLD_MAP\[jid\]\.window\?/, 'the window');
  assert.match(banner, /holdAgeLabel\(HOLD_MAP\[jid\]\.at\)/, 'the age');
  assert.match(banner, /no window picked/, 'and says plainly when there is none');
});

test('the board tile answers "held for when?" without opening anything', () => {
  const i = BOARD.indexOf("if(HOLD_MAP[j.id]){");
  assert.ok(i > -1, 'the tile tag is a block now, not a bare push');
  const tag = BOARD.slice(i, i + 900);
  assert.match(tag, /holdDayShort\(_h\.date\)/);
  assert.match(tag, /_h\.window/);
  assert.match(tag, /HELD/);
});

// ── and it BOOKS what it held ────────────────────────────────────────────────
test('confirming books the window it was held for — office board', () => {
  const c = fnBody('confirmHoldFromDrawer', BOARD);
  assert.match(c, /bookHoldConfirmed\(id,h\.tech_id,h\.date,h\.window\|\|'',Number\(h\.hour\|\|0\)\)/);
  const bk = fnBody('bookHoldConfirmed', BOARD);
  assert.ok(!/const win='';/.test(bk), 'the hardcoded empty window is gone');
  assert.match(bk, /const win=heldWin\|\|'';/);
  assert.match(bk, /heldHour>=8&&heldHour<=21/, 'the held hour wins when there is one');
  assert.match(bk, /await appendHourForDay\(techId,date\)/, 'and the old behaviour is the fallback');
  assert.match(bk, /etaWindow:win/, 'the window reaches the save');
});

test('confirming books the window it was held for — scheduling grid', () => {
  const c = SCHED.slice(SCHED.indexOf('window.confirmHold = function'), SCHED.indexOf('window.releaseHold'));
  assert.match(c, /HOLDS\.filter\(/, 'looks the hold up');
  assert.match(c, /bookConfirmedHold\(jobId, techId, date, Number\(h\.hour \|\| 0\), String\(h\.window \|\| ''\)\)/);
  assert.match(c, /etaWindow: heldWin \|\| ''/, 'the window reaches the save');
  assert.match(c, /\(heldHour >= 8 && heldHour <= 21\) \? heldHour : nextStopHourCT/, 'falls back cleanly');
});

test('the grid hold sends the window picker sitting right next to the button', () => {
  const i = SCHED.indexOf("getElementById('holdSlotBtn').addEventListener");
  const b = SCHED.slice(i, i + 1400);
  assert.match(b, /hour: getRescheduleWinHour\(\)/);
  assert.match(b, /window: getRescheduleWinLabel\(\)/);
});

test('the grid window label matches the picker the office actually taps', () => {
  const picker = SCHED.slice(SCHED.indexOf('id="rescheduleWindow"'), SCHED.indexOf('id="rescheduleWindow"') + 500);
  const hours = [...picker.matchAll(/data-h="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(hours, ['8', '11', '14'], 'three windows on screen');
  const map = (SCHED.match(/const WIN_LABEL = \{([^}]*)\}/) || [])[1] || '';
  hours.forEach((h) => assert.ok(map.includes(h + ':'), 'every on-screen window has a label: ' + h));
});

test('the ghosted block on the grid says what it is holding', () => {
  const b = fnBody('renderHoldBlock', SCHED);
  assert.match(b, /const win = String\(h\.window \|\| ''\)\.trim\(\);/);
  assert.match(b, /held for \$\{escapeHtml\(win\)\}/);
});

// ── the store keeps it ───────────────────────────────────────────────────────
test('the hold record stores window + a sane hour, and hands both back', () => {
  assert.match(HOLDFN, /window: String\(b\.window \|\| ''\)\.slice\(0, 40\)/);
  assert.match(HOLDFN, /hour: \(hour >= 8 && hour <= 21\) \? hour : 0/, 'a junk hour is dropped, not stored');
  assert.match(HOLDFN, /window: String\(m\.window \|\| ''\), hour: Number\(m\.hour \|\| 0\)/, 'returned on GET');
});

test('the customer-request bar says the time too, not just the date', () => {
  const REQ = R('office-schedule-requests.js');
  assert.match(REQ, /var whenTime = r\.time_pref \|\| r\.window \|\| '';/);
  assert.match(REQ, /prettyDate\(r\.date\) \+ \(whenTime \?/);
});

// ── the round trip, executed against the REAL handler ────────────────────────
// Static assertions prove the right strings are in the file. This proves a hold placed with
// a window comes back OUT with that window — the thing Danielle actually needs — without
// writing a fake tentative block onto the live board.
test('a hold goes in with a window and comes back out with it', async () => {
  process.env.XANO_METADATA_TOKEN = 'test-token';
  const written = [];
  let feed = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('list_recent_event_log')) {
      const action = String(url).match(/action=([^&]+)/)[1];
      return { json: async () => ({ items: action === 'schedule_hold' ? feed : [] }) };
    }
    written.push(JSON.parse(opts.body));
    return { ok: true, text: async () => '' };
  };
  try {
    delete require.cache[require.resolve('../netlify/functions/schedule-hold.js')];
    const h = require('../netlify/functions/schedule-hold.js').handler;

    const post = await h({ httpMethod: 'POST', body: JSON.stringify({ action: 'hold', job_id: 20058, tech_id: 2, date: '2026-09-18', hour: 12, window: '12-4pm', customer: 'Cailin T', appliance: 'Dryer' }) });
    assert.equal(JSON.parse(post.body).ok, true);
    const m = written[0].metadata;
    assert.equal(m.window, '12-4pm', 'the window is stored');
    assert.equal(m.hour, 12, 'so is the routing hour');

    feed = [{ created_at: Date.now(), metadata: m }];
    const got = JSON.parse((await h({ httpMethod: 'GET' })).body).holds[0];
    assert.equal(got.window, '12-4pm', 'and it comes back');
    assert.equal(got.hour, 12);
    assert.equal(got.date, '2026-09-18');
    assert.equal(got.tech_id, 2);

    // A hold placed before this shipped has no window — it must still load, and the boards
    // fall back to the old next-open-stop behaviour rather than breaking.
    feed = [{ created_at: Date.now(), metadata: { job_id: 19999, tech_id: 4, date: '2026-09-19' } }];
    const old = JSON.parse((await h({ httpMethod: 'GET' })).body).holds[0];
    assert.equal(old.window, '');
    assert.equal(old.hour, 0);

    // A junk hour never reaches the record.
    written.length = 0;
    await h({ httpMethod: 'POST', body: JSON.stringify({ action: 'hold', job_id: 1, tech_id: 2, date: '2026-09-18', hour: 99, window: 'whenever' }) });
    assert.equal(written[0].metadata.hour, 0, 'out-of-range hour dropped');
  } finally {
    global.fetch = realFetch;
    delete process.env.XANO_METADATA_TOKEN;
  }
});
